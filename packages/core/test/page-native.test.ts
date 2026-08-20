/**
 * 页面的原生增强 —— 直接跑页面里那段 JS，不开浏览器也不开原生壳
 *
 * 这里测的是**同一份页面在两种宿主里的行为差异**：
 * 浏览器里没有 window.zero，整段增强必须自动跳过；原生壳里才多出系统通知。
 *
 * 之所以值得这么测：这段增强最容易坏的方式是有人删掉 window.zero 守卫，
 * 那样浏览器页面会当场抛异常，而单靠服务端 fetch 测试完全看不见。
 */
import { describe, it, expect } from 'vitest'
import { renderPage } from '../src/channels/web/page.js'

interface Call {
  kind: 'invoke' | 'notify'
  arg: any
  cmd?: string
}

/** 扮演宿主：把页面里的 IIFE 跑起来，返回 SSE 的 interaction 派发口 */
function runPage(opts: { bridge?: boolean; focused?: boolean; supports?: boolean; hidden?: boolean } = {}) {
  const html = renderPage('tok', 'title')
  const m = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('页面里找不到脚本块')

  const calls: Call[] = []
  const zero = {
    invoke(cmd: string, arg: any) {
      calls.push({ kind: 'invoke', cmd, arg })
      return Promise.resolve(opts.supports ?? true)
    },
    os: {
      showNotification(arg: any) {
        calls.push({ kind: 'notify', arg })
        return Promise.resolve(true)
      },
    },
  }

  const root = {
    innerHTML: '',
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null as unknown,
    appendChild: () => {},
  }
  const listeners: Record<string, () => void> = {}
  const doc = {
    getElementById: () => root,
    hasFocus: () => opts.focused ?? true,
    hidden: opts.hidden ?? false,
    addEventListener(name: string, fn: () => void) {
      listeners[name] = fn
    },
  }

  const posts: { url: string; body: any }[] = []
  const fakeFetch = (url: string, init?: { body?: string }) => {
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
    return Promise.resolve()
  }

  let onInteraction: ((e: { data: string }) => void) | undefined
  class FakeEventSource {
    addEventListener(name: string, fn: (e: { data: string }) => void) {
      if (name === 'interaction') onInteraction = fn
    }
    close() {}
  }

  const win = opts.bridge ? { zero } : {}
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'EventSource', 'fetch', m[1])
  fn(win, doc, FakeEventSource, fakeFetch)

  return {
    calls,
    root,
    posts,
    dispatch(i: unknown) {
      if (!onInteraction) throw new Error('页面没有订阅 interaction 事件')
      onInteraction({ data: JSON.stringify(i) })
    },
    /** 模拟窗口被隐藏 / 恢复 */
    setHidden(v: boolean) {
      doc.hidden = v
      listeners.visibilitychange?.()
    },
  }
}

/** 让 platform.supports 那条 promise 落地 */
const flush = () => new Promise(r => setTimeout(r, 0))

describe('页面的原生增强', () => {
  it('浏览器里没有 window.zero：整段跳过，交互照常渲染', async () => {
    const page = runPage({ bridge: false })
    await flush()

    expect(() => page.dispatch({ id: 'i1', kind: 'notify', title: '构建完成', message: '已完成' })).not.toThrow()
    expect(page.calls).toHaveLength(0)
    // 关键：没有 bridge 不等于不渲染，内容必须照常出现
    expect(page.root.innerHTML).toContain('构建完成')
  })

  it('原生壳里先探测能力，再发通知', async () => {
    const page = runPage({ bridge: true })
    await flush()

    const probe = page.calls.find(c => c.kind === 'invoke')
    expect(probe?.cmd).toBe('native-sdk.platform.supports')
    expect(probe?.arg).toEqual({ feature: 'notifications' })

    page.dispatch({ id: 'i1', kind: 'notify', title: '构建完成', message: '已完成' })
    const note = page.calls.find(c => c.kind === 'notify')
    expect(note?.arg).toEqual({ title: '构建完成', body: '已完成' })
  })

  it('宿主报告不支持通知时不发', async () => {
    const page = runPage({ bridge: true, supports: false })
    await flush()

    page.dispatch({ id: 'i1', kind: 'notify', title: '构建完成', message: '已完成' })
    expect(page.calls.filter(c => c.kind === 'notify')).toHaveLength(0)
  })

  it('窗口正被盯着时，问答类交互不打扰', async () => {
    const page = runPage({ bridge: true, focused: true })
    await flush()

    page.dispatch({ id: 'i1', kind: 'confirm', title: '确认发布', message: '不可撤销' })
    expect(page.calls.filter(c => c.kind === 'notify')).toHaveLength(0)
  })

  it('窗口没被盯着时，问答类交互要提醒', async () => {
    const page = runPage({ bridge: true, focused: false })
    await flush()

    page.dispatch({ id: 'i1', kind: 'confirm', title: '确认发布', message: '不可撤销' })
    const note = page.calls.find(c => c.kind === 'notify')
    expect(note?.arg.title).toBe('确认发布')
  })

  it('notify 一律提醒，哪怕窗口就在眼前 —— 它本身就是通知', async () => {
    const page = runPage({ bridge: true, focused: true })
    await flush()

    page.dispatch({ id: 'i1', kind: 'notify', title: '构建完成', message: '已完成' })
    expect(page.calls.filter(c => c.kind === 'notify')).toHaveLength(1)
  })

  it('页面一上来就上报可见性，之后每次变化都报', async () => {
    // 「连着」和「看得见」是两件事：常驻宿主里窗口能隐藏而页面继续活着，
    // 发起方要靠这个信号判断该不该改用通知触达。
    const page = runPage({ bridge: false })
    await flush()

    const first = page.posts.filter(p => p.url.startsWith('/visibility'))
    expect(first).toHaveLength(1)
    expect(first[0].body).toEqual({ hidden: false })

    page.setHidden(true)
    const after = page.posts.filter(p => p.url.startsWith('/visibility'))
    expect(after).toHaveLength(2)
    expect(after[1].body).toEqual({ hidden: true })
  })

  it('可见性上报与原生桥无关：浏览器里同样要报', async () => {
    // 这条防止有人把上报挪进 window.zero 的分支里 —— 浏览器标签页切走也是隐藏
    const page = runPage({ bridge: false, hidden: true })
    await flush()
    const posts = page.posts.filter(p => p.url.startsWith('/visibility'))
    expect(posts[0].body).toEqual({ hidden: true })
  })

  it('没有 message 的问答类交互也给得出通知正文', async () => {
    const page = runPage({ bridge: true, focused: false })
    await flush()

    page.dispatch({ id: 'i1', kind: 'form', title: '发布凭据', fields: [] })
    const note = page.calls.find(c => c.kind === 'notify')
    expect(note?.arg.body).toBe('需要你填写')
  })
})
