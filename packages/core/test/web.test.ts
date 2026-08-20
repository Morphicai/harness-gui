/**
 * web channel 测试 —— 不开浏览器，用 fetch 直接扮演页面
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { WebChannel } from '../src/channels/web/index.js'

let ch: WebChannel | undefined
afterEach(async () => {
  await ch?.close()
  ch = undefined
})

function newChannel(graceMs = 40): WebChannel {
  // 宽限期在测试里压到 40ms —— 默认 5s 是给真人刷新页面用的，不是给测试等的
  ch = new WebChannel({ autoOpen: false, disconnectGraceMs: graceMs })
  return ch
}

/** 扮演页面：连 SSE，把收到的 interaction 事件推进数组 */
async function connectSse(base: URL, onInteraction: (i: any) => void) {
  const ac = new AbortController()
  const res = await fetch(new URL(`/events?t=${base.searchParams.get('t')}`, base), { signal: ac.signal })
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buf = ''
  ;(async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const ev = /^event: (.+)$/m.exec(chunk)?.[1]
          const data = /^data: (.+)$/m.exec(chunk)?.[1]
          if (ev === 'interaction' && data) onInteraction(JSON.parse(data))
        }
      }
    } catch {
      /* abort */
    }
  })()
  return ac
}

async function submit(base: URL, id: string, action: string, value?: unknown) {
  await fetch(new URL(`/submit?t=${base.searchParams.get('t')}`, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, action, value }),
  })
}

function waitFor<T>(get: () => T | undefined, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      const v = get()
      if (v !== undefined) return resolve(v)
      if (Date.now() - t0 > timeout) return reject(new Error('等待超时'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

describe('web channel · 安全约束', () => {
  it('只监听 127.0.0.1，端口由系统分配', async () => {
    const url = new URL(await newChannel().getUrl())
    expect(url.hostname).toBe('127.0.0.1')
    expect(Number(url.port)).toBeGreaterThan(0)
  })

  it('无 token 被拒，且不返回交互内容', async () => {
    const url = new URL(await newChannel().getUrl())
    const res = await fetch(new URL('/', url))
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain('<html')
  })

  it('错 token 被拒', async () => {
    const url = new URL(await newChannel().getUrl())
    const res = await fetch(new URL('/?t=deadbeef', url))
    expect(res.status).toBe(401)
  })

  it('页面自包含：不引任何外部域名资源', async () => {
    const url = new URL(await newChannel().getUrl())
    const html = await (await fetch(url)).text()
    expect(html).toContain('<!doctype html>')
    // 任何 src=/href= 指向 http(s) 外链都算违规
    const external = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) ?? []
    expect(external).toEqual([])
  })
})

describe('web channel · 交互往返', () => {
  it('confirm：页面提交 accept 后发起方拿到结果', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    let got: any
    const ac = await connectSse(url, i => (got = i))

    const p = c.present({ kind: 'confirm', title: '删除', message: '不可撤销' })
    const i = await waitFor(() => got)
    expect(i.kind).toBe('confirm')
    await submit(url, i.id, 'accept', true)

    expect(await p).toMatchObject({ action: 'accept', value: true })
    ac.abort()
  })

  it('select：回传选中的 value', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    let got: any
    const ac = await connectSse(url, i => (got = i))

    const p = c.present({
      kind: 'select',
      title: '选组织',
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    })
    const i = await waitFor(() => got)
    await submit(url, i.id, 'accept', 'b')
    expect(await p).toMatchObject({ action: 'accept', value: 'b' })
    ac.abort()
  })

  it('form：回传字段字典', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    let got: any
    const ac = await connectSse(url, i => (got = i))

    const p = c.present({
      kind: 'form',
      title: '验证码',
      fields: [{ name: 'code', label: '验证码', type: 'text' }],
    })
    const i = await waitFor(() => got)
    await submit(url, i.id, 'accept', { code: '123456' })
    const r = await p
    expect((r.value as { code: string }).code).toBe('123456')
    ac.abort()
  })

  it('页面点取消 → cancel', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    let got: any
    const ac = await connectSse(url, i => (got = i))
    const p = c.present({ kind: 'confirm', title: 't', message: 'm' })
    const i = await waitFor(() => got)
    await submit(url, i.id, 'cancel')
    expect((await p).action).toBe('cancel')
    ac.abort()
  })

  it('单向 notify 不阻塞，立即 accept', async () => {
    const c = newChannel()
    await c.getUrl()
    const r = await c.present({ kind: 'notify', title: 't', message: 'm' })
    expect(r.action).toBe('accept')
  })

  it('页面连上之前发起的交互会被补发', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    // 先发起，后连页面
    const p = c.present({ kind: 'confirm', title: '先发起', message: 'm' })
    let got: any
    const ac = await connectSse(url, i => (got = i))
    const i = await waitFor(() => got)
    expect(i.title).toBe('先发起')
    await submit(url, i.id, 'accept', true)
    expect((await p).action).toBe('accept')
    ac.abort()
  })

  it('超时返回 timeout', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    const ac = await connectSse(url, () => {})
    const r = await c.present({ kind: 'confirm', title: 't', message: 'm', timeoutMs: 80 })
    expect(r.action).toBe('timeout')
    ac.abort()
  })
})

describe('web channel · 生命周期', () => {
  it('连续两次交互复用同一个 server（同一 URL / 同一端口）', async () => {
    const c = newChannel()
    const u1 = await c.getUrl()
    const url = new URL(u1)
    let got: any
    const ac = await connectSse(url, i => (got = i))

    const p1 = c.present({ kind: 'confirm', title: '一', message: 'm' })
    const i1 = await waitFor(() => got)
    await submit(url, i1.id, 'accept', true)
    await p1

    got = undefined
    const p2 = c.present({ kind: 'confirm', title: '二', message: 'm' })
    const i2 = await waitFor(() => got)
    await submit(url, i2.id, 'accept', true)
    await p2

    expect(await c.getUrl()).toBe(u1)
    ac.abort()
  })

  it('页面关闭（SSE 断开）判定为 cancel，而不是超时', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    let got: any
    const ac = await connectSse(url, i => (got = i))
    const p = c.present({ kind: 'confirm', title: 't', message: 'm' })
    await waitFor(() => got)
    ac.abort() // 相当于用户关掉标签页
    expect((await p).action).toBe('cancel')
  })

  /*
   * 回归：有人在等答复时 server 必须是 ref 的，否则 node 会在弹出页面后直接退出
   * （pending 的 Promise 不维持事件循环）。这条只能看 handle 的 ref 状态——
   * vitest 自己在维持进程，从外部行为上抓不到。
   */
  it('等待答复期间 server 被 ref 住，答复后回到 unref', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    const handle = (c as unknown as { server: { _handle?: { hasRef?: () => boolean } } }).server?._handle
    if (!handle?.hasRef) return // Node 内部结构变了就跳过，不让测试变脆

    expect(handle.hasRef()).toBe(false) // 空闲时不该钉住进程

    let got: any
    const ac = await connectSse(url, i => (got = i))
    const p = c.present({ kind: 'confirm', title: 't', message: 'm' })
    const i = await waitFor(() => got)
    expect(handle.hasRef()).toBe(true) // 有人在等 → 必须钉住

    await submit(url, i.id, 'accept', true)
    await p
    expect(handle.hasRef()).toBe(false) // 等完了 → 放开，别拦着进程退出
    ac.abort()
  })

  it('页面上报可见性后，clientHidden 跟着变', async () => {
    /*
     * 「连着」和「看得见」必须分开：常驻宿主里窗口可以隐藏而页面继续活着。
     * 发起方靠这个信号决定还能不能指望人正好在看，看不见就得改用通知触达。
     */
    const c = newChannel()
    const url = new URL(await c.getUrl())
    const ac = await connectSse(url, () => {})
    await waitFor(() => (c.clientCount() > 0 ? true : undefined))

    const setHidden = (hidden: boolean) =>
      fetch(new URL(`/visibility?t=${url.searchParams.get('t')}`, url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hidden }),
      })

    expect(c.clientHidden()).toBe(false)
    await setHidden(true)
    expect(c.clientHidden()).toBe(true)
    await setHidden(false)
    expect(c.clientHidden()).toBe(false)
    ac.abort()
  })

  it('没有页面连着时不算「隐藏」——那是「没有界面」', async () => {
    // 两者要分开：没界面该走别的通道，藏起来的界面还能靠通知叫回来
    const c = newChannel()
    const url = new URL(await c.getUrl())
    const ac = await connectSse(url, () => {})
    await waitFor(() => (c.clientCount() > 0 ? true : undefined))
    await fetch(new URL(`/visibility?t=${url.searchParams.get('t')}`, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hidden: true }),
    })
    expect(c.clientHidden()).toBe(true)

    ac.abort()
    await waitFor(() => (c.clientCount() === 0 ? true : undefined))
    expect(c.clientHidden()).toBe(false)
  })

  it('/visibility 同样要 token', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    const res = await fetch(new URL('/visibility', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hidden: true }),
    })
    expect(res.status).toBe(401)
  })

  it('页面刷新：宽限期内重连，等待中的交互被重投而不是判死', async () => {
    /*
     * 这是断线恢复的核心用例。SSE 层面区分不了「关掉页面」和「刷新」，
     * 一断就判 cancel 会让一次误触刷新毁掉整串问答 —— 而发起方还在 await。
     */
    const c = newChannel(500)
    const url = new URL(await c.getUrl())
    let got: any
    const ac1 = await connectSse(url, i => (got = i))

    const p = c.present({ kind: 'confirm', title: '确认发布', message: 'm' })
    const first = await waitFor(() => got)

    // 页面掉线（刷新）
    got = undefined
    ac1.abort()
    await waitFor(() => (c.clientCount() === 0 ? true : undefined))

    // 宽限期内重新连上 —— 同一条交互必须被重投，id 保持不变
    const ac2 = await connectSse(url, i => (got = i))
    const again = await waitFor(() => got)
    expect(again.id).toBe(first.id)
    expect(again.kind).toBe('confirm')

    // 重投的那条能正常答复，发起方拿到结果
    await submit(url, again.id, 'accept', true)
    expect(await p).toMatchObject({ action: 'accept', value: true })
    ac2.abort()
  })

  it('宽限期到点仍没人回来才判 cancel', async () => {
    const c = newChannel(40)
    const url = new URL(await c.getUrl())
    const ac = await connectSse(url, () => {})
    const p = c.present({ kind: 'confirm', title: 't', message: 'm' })
    await waitFor(() => (c.clientCount() > 0 ? true : undefined))

    ac.abort()
    expect((await p).action).toBe('cancel')
  })

  it('单向交互不会在重连时重复弹 —— 过时的通知是打扰，不是恢复', async () => {
    const c = newChannel(500)
    const url = new URL(await c.getUrl())
    const seen: any[] = []
    const ac1 = await connectSse(url, i => seen.push(i))

    await c.present({ kind: 'notify', title: '构建完成', message: 'm' })
    await waitFor(() => (seen.length === 1 ? true : undefined))

    ac1.abort()
    await waitFor(() => (c.clientCount() === 0 ? true : undefined))
    const ac2 = await connectSse(url, i => seen.push(i))
    await new Promise(r => setTimeout(r, 120))

    expect(seen).toHaveLength(1)
    ac2.abort()
  })

  it('多条等待中的交互一起被重投', async () => {
    const c = newChannel(500)
    const url = new URL(await c.getUrl())
    const seen: any[] = []
    const ac1 = await connectSse(url, i => seen.push(i))

    const p1 = c.present({ kind: 'confirm', title: 'a', message: 'm' })
    const p2 = c.present({ kind: 'confirm', title: 'b', message: 'm' })
    await waitFor(() => (seen.length === 2 ? true : undefined))

    seen.length = 0
    ac1.abort()
    await waitFor(() => (c.clientCount() === 0 ? true : undefined))
    const ac2 = await connectSse(url, i => seen.push(i))
    await waitFor(() => (seen.length === 2 ? true : undefined))

    expect(seen.map(i => i.title).sort()).toEqual(['a', 'b'])
    await submit(url, seen[0].id, 'cancel')
    await submit(url, seen[1].id, 'cancel')
    await Promise.all([p1, p2])
    ac2.abort()
  })

  it('close() 释放端口，且把还等着的交互了结为 cancel', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    const ac = await connectSse(url, () => {})
    const p = c.present({ kind: 'confirm', title: 't', message: 'm' })
    await c.close()
    expect((await p).action).toBe('cancel')
    await expect(fetch(url, { signal: AbortSignal.timeout(800) })).rejects.toThrow()
    ac.abort()
    ch = undefined
  })
})

describe('探针注入（默认关闭）', () => {
  it('默认不注入任何东西 —— 页面自包含是常态', async () => {
    const c = newChannel()
    const url = new URL(await c.getUrl())
    const html = await (await fetch(url)).text()
    expect(html).not.toContain('__inst/')
    expect(html).not.toContain('<script type="module"')
  })

  it('显式开启后注入全局配置与本地脚本', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'))
    const probe = path.join(dir, 'p.js')
    fs.writeFileSync(probe, 'window.__probe_ran = true')

    ch = new WebChannel({
      autoOpen: false,
      instrument: { globals: { __HARNESS_FE__: { projectId: 'x' } }, scripts: [probe] },
    })
    const url = new URL(await ch.getUrl())
    const html = await (await fetch(url)).text()

    expect(html).toContain('__HARNESS_FE__')
    expect(html).toContain('/__inst/0.js')

    // 脚本由本 server 从自己的 origin 提供 —— 不引外部域名这条不因接探针而破例
    const js = await fetch(new URL(`/__inst/0.js?t=${url.searchParams.get('t')}`, url))
    expect(js.status).toBe(200)
    expect(await js.text()).toContain('__probe_ran')

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('探针脚本同样要 token —— 不能成为绕过鉴权的口子', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'))
    const probe = path.join(dir, 'p.js')
    fs.writeFileSync(probe, '// x')
    ch = new WebChannel({ autoOpen: false, instrument: { scripts: [probe] } })
    const url = new URL(await ch.getUrl())
    const res = await fetch(new URL('/__inst/0.js', url))
    expect(res.status).toBe(401)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('越界的脚本下标返回 404，不泄露任何文件', async () => {
    ch = new WebChannel({ autoOpen: false, instrument: { scripts: [] } })
    const url = new URL(await ch.getUrl())
    const res = await fetch(new URL(`/__inst/9.js?t=${url.searchParams.get('t')}`, url))
    expect(res.status).toBe(404)
  })

  it('全局配置被序列化而不是拼接 —— 页面持有 token，拼接会给出 XSS 面', async () => {
    ch = new WebChannel({
      autoOpen: false,
      instrument: { globals: { cfg: { evil: '</script><script>alert(1)</script>' } } },
    })
    const url = new URL(await ch.getUrl())
    const html = await (await fetch(url)).text()
    // 注入的值不能原样闭合掉 script 标签
    expect(html).not.toContain('</script><script>alert(1)')
  })
})
