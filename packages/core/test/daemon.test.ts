/**
 * daemon 测试 —— 单实例 / 生命周期 / 残留清理
 *
 * 全部走真实 socket，不 mock：这些行为（谁抢到、死 socket 怎么办、什么时候退出）
 * 恰恰是只有在真实竞争下才会暴露的，mock 掉就等于什么都没测。
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as net from 'node:net'
import { Daemon } from '../src/daemon/server.js'
import { DaemonChannel } from '../src/daemon/client.js'
import { Interact } from '../src/registry.js'
import { ScriptedChannel } from '../src/channels/scripted.js'
import { NATIVE_PORT } from '../src/native/shell.js'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

/** 每个用例一个独立 socket，避免互相踩 —— 也顺便证明路径是可注入的 */
function tmpSock(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-'))
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'd.sock')
}

/** 用 scripted 通道当 UI，测 daemon 本身而不是网页 */
function scriptedUi(answers: any[]) {
  return new Interact().register(new ScriptedChannel(answers))
}

async function startDaemon(sock: string, opts: any = {}) {
  process.env.INTERACT_SOCKET = sock
  const d = new Daemon({ idleTimeoutMs: 0, ui: scriptedUi(opts.answers ?? []), ...opts })
  cleanup.push(() => d.close())
  const owned = await d.start()
  return { d, owned }
}

function newClient(sock: string) {
  const c = new DaemonChannel({ socket: sock, autoSpawn: false })
  cleanup.push(() => c.close())
  return c
}

/**
 * 界面由谁承载
 *
 * 这一组**不**传 ui，让 daemon 自己建 web 通道 —— 要测的正是那段选择逻辑。
 */
describe('daemon 的界面承载', () => {
  const savedNative = process.env.INTERACT_NATIVE
  const savedApp = process.env.INTERACT_APP
  afterEach(() => {
    if (savedNative === undefined) delete process.env.INTERACT_NATIVE
    else process.env.INTERACT_NATIVE = savedNative
    if (savedApp === undefined) delete process.env.INTERACT_APP
    else process.env.INTERACT_APP = savedApp
  })

  /** 一个假外壳：把拿到的 URL 写进文件，然后挂住不退（真外壳也是常驻的） */
  function fakeShell(marker: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ish-'))
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const bin = path.join(dir, 'shell.sh')
    fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$NATIVE_SDK_FRONTEND_URL" > ${marker}\nwhile true; do sleep 1; done\n`, {
      mode: 0o755,
    })
    return bin
  }

  function markerPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-'))
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    return path.join(dir, 'url.txt')
  }

  async function bare(sock: string, opts: any = {}) {
    process.env.INTERACT_SOCKET = sock
    const d = new Daemon({ idleTimeoutMs: 0, ...opts })
    cleanup.push(() => d.close())
    const owned = await d.start()
    return { d, owned }
  }

  /** 47100 现在空不空 —— 空不出来的用例直接跳过，不制造假红 */
  function portFree(): Promise<boolean> {
    return new Promise(resolve => {
      const s = net.createServer()
      s.once('error', () => resolve(false))
      s.listen(NATIVE_PORT, '127.0.0.1', () => s.close(() => resolve(true)))
    })
  }

  it('没有原生外壳时照常起来，用系统分配的端口', async () => {
    process.env.INTERACT_NATIVE = '0'
    const { d, owned } = await bare(tmpSock())
    expect(owned).toBe(true)
    // 界面通道确实挂上了 —— 之前这里是 autoOpen:false 且没人打开，等于没有界面
    expect(d.status().clients).toBe(0)
  })

  it('装了外壳就绑固定端口（原生壳的 origin 白名单是编译期写死的）', async () => {
    if (process.platform !== 'darwin' || !(await portFree())) return
    const { d, owned } = await bare(tmpSock(), { native: { appPath: fakeShell(markerPath()) } })
    expect(owned).toBe(true)
    expect(await (d as any).web.getUrl()).toContain(`127.0.0.1:${NATIVE_PORT}`)
  })

  it('固定端口被占时退回浏览器，daemon 不能因此起不来', async () => {
    if (process.platform !== 'darwin') return
    const squatter = net.createServer()
    await new Promise<void>(r => squatter.listen(NATIVE_PORT, '127.0.0.1', () => r()))
    cleanup.push(() => new Promise<void>(r => squatter.close(() => r())))

    const { d, owned } = await bare(tmpSock(), { native: { appPath: fakeShell(markerPath()) } })
    expect(owned).toBe(true)
    const url = await (d as any).web.getUrl()
    expect(url).not.toContain(`:${NATIVE_PORT}`)
  })

  it('不发生交互就不拉窗口 —— 后台脚本不该无缘无故抢屏幕', async () => {
    if (process.platform !== 'darwin' || !(await portFree())) return
    const marker = markerPath()
    await bare(tmpSock(), { native: { appPath: fakeShell(marker) } })
    await new Promise(r => setTimeout(r, 300))
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('第一次交互才拉起外壳，并把页面地址交给它', async () => {
    if (process.platform !== 'darwin' || !(await portFree())) return
    const marker = markerPath()
    const sock = tmpSock()
    const { d } = await bare(sock, { native: { appPath: fakeShell(marker) } })
    // portFree() 到真正 listen 之间有窗口，端口可能被别人抢走。那种情况下 daemon
    // 会退回浏览器 —— 那是正确行为，但这条用例就无从验起了，如实跳过而不是判失败
    if (!(d as any).useNative) return

    const c = newClient(sock)
    // notify 是单向的，不等人回答，正好用来触发「拉窗口」这件事
    await c.present({ kind: 'notify', title: 'x', message: 'y' } as any)

    // 并行跑测试时机器负载高，进程起来可能要几秒，给足时间
    for (let i = 0; i < 160 && !fs.existsSync(marker); i++) await new Promise(r => setTimeout(r, 50))
    expect(fs.existsSync(marker), '外壳没有被拉起来').toBe(true)
    expect(fs.readFileSync(marker, 'utf8')).toContain(`127.0.0.1:${NATIVE_PORT}`)

    // 关 daemon 要把外壳一起收走：留一个连不上任何东西的托盘图标更让人困惑
    const shell = (d as any).shell
    expect(shell.alive()).toBe(true)
    await d.close()
    expect(shell.alive()).toBe(false)
  })
})

describe('daemon 单实例', () => {
  it('第一个抢到 socket，第二个让位（不是报错）', async () => {
    const sock = tmpSock()
    const first = await startDaemon(sock)
    expect(first.owned).toBe(true)

    // 两个消费者同时冷启动时一定会走到这条路径 —— 让位是正常结果，不是失败
    const second = await startDaemon(sock)
    expect(second.owned).toBe(false)
  })

  it('残留的死 socket 会被清掉后接管', async () => {
    const sock = tmpSock()
    // 造一个「文件在、没人听」的死 socket：listen 后直接关掉服务端但留下文件
    const stale = net.createServer()
    await new Promise<void>(r => stale.listen(sock, () => r()))
    await new Promise<void>(r => stale.close(() => r()))
    fs.writeFileSync(sock, '') // 确保路径上确实有个文件
    expect(fs.existsSync(sock)).toBe(true)

    const { owned } = await startDaemon(sock)
    // 光看文件在不在说明不了任何事，必须连一下才知道那头有没有活人
    expect(owned).toBe(true)
  })

  it('socket 权限只给本用户 —— 上面没有 token，权限就是唯一的门', async () => {
    if (process.platform === 'win32') return
    const sock = tmpSock()
    await startDaemon(sock)
    const mode = fs.statSync(sock).mode & 0o777
    expect(mode & 0o077).toBe(0)
  })
})

describe('daemon 转发交互', () => {
  it('消费者的交互由 daemon 的 UI 承接，结果原样回传', async () => {
    const sock = tmpSock()
    await startDaemon(sock, { answers: [{ action: 'accept', value: true }] })
    const c = newClient(sock)

    const outcome = await c.present({ kind: 'confirm', title: '发布', message: '不可撤销' })
    expect(outcome).toMatchObject({ action: 'accept', value: true })
  })

  it('多个消费者共用同一个界面', async () => {
    const sock = tmpSock()
    await startDaemon(sock, {
      answers: [
        { action: 'accept', value: 'a' },
        { action: 'accept', value: 'b' },
      ],
    })
    const c1 = newClient(sock)
    const c2 = newClient(sock)

    const r1 = await c1.present({ kind: 'confirm', title: '1', message: 'm' })
    const r2 = await c2.present({ kind: 'confirm', title: '2', message: 'm' })
    expect([r1.value, r2.value]).toEqual(['a', 'b'])

    const st = await c1.status()
    expect(st.consumers).toBeGreaterThanOrEqual(2)
  })

  it('status 报告 pid 与协议版本，便于排查串版本', async () => {
    const sock = tmpSock()
    await startDaemon(sock)
    const st = await newClient(sock).status()
    expect(st.pid).toBe(process.pid)
    expect(st.protocol).toBeGreaterThanOrEqual(1)
  })

  it('一个消费者断开不影响另一个', async () => {
    const sock = tmpSock()
    await startDaemon(sock, { answers: [{ action: 'accept', value: 'ok' }] })
    const c1 = newClient(sock)
    const c2 = newClient(sock)
    await c1.status()
    await c1.close()

    const r = await c2.present({ kind: 'confirm', title: 't', message: 'm' })
    expect(r.value).toBe('ok')
  })
})

describe('daemon 生命周期', () => {
  it('没有消费者也没有待答交互时，空闲超时自动退出', async () => {
    const sock = tmpSock()
    const { d } = await startDaemon(sock, { idleTimeoutMs: 60 })
    await new Promise(r => setTimeout(r, 200))
    // 退出后 socket 文件要清掉，否则下次启动会看到一个死 socket
    expect(fs.existsSync(sock)).toBe(false)
    await d.close()
  })

  it('有消费者连着就不退出', async () => {
    const sock = tmpSock()
    await startDaemon(sock, { idleTimeoutMs: 60 })
    const c = newClient(sock)
    await c.status()
    await new Promise(r => setTimeout(r, 220))
    // 还连着就还能用
    await expect(c.status()).resolves.toMatchObject({ pid: process.pid })
  })

  it('人还没回答时不退出 —— 哪怕发起方已经断开', async () => {
    /*
     * 这条最容易被漏掉：脚本发完 present 就断线去做别的事，而人还对着窗口没点。
     * 这时候把 daemon 关掉，用户点下去会石沉大海。
     */
    const sock = tmpSock()
    let release: (v: any) => void = () => {}
    const slow = {
      name: 'slow',
      supports: () => true,
      present: () => new Promise<any>(r => (release = r)),
    }
    const { d } = await startDaemon(sock, {
      idleTimeoutMs: 60,
      ui: new Interact().register(slow as any),
    })
    const c = newClient(sock)
    // 立刻挂 catch：daemon 关掉时这个 Promise 会被拒，晚挂就成了 unhandled rejection
    const p = c.present({ kind: 'confirm', title: 't', message: 'm' }).catch(() => 'rejected')
    await new Promise(r => setTimeout(r, 20))
    await c.close() // 发起方断开，但人还在看

    await new Promise(r => setTimeout(r, 220))
    expect(fs.existsSync(sock)).toBe(true) // 没退

    release({ action: 'accept' })
    await p // 连接已断，结果拿不回来，这里只关心 daemon 没提前退
    await d.close()
  })

  it('close() 之后 socket 文件被清掉', async () => {
    const sock = tmpSock()
    const { d } = await startDaemon(sock)
    expect(fs.existsSync(sock)).toBe(true)
    await d.close()
    expect(fs.existsSync(sock)).toBe(false)
  })
})

describe('daemon 消费者容错', () => {
  it('daemon 消失时等待中的请求被了结，而不是永久挂起', async () => {
    const sock = tmpSock()
    let release: (v: any) => void = () => {}
    const slow = {
      name: 'slow',
      supports: () => true,
      present: () => new Promise<any>(r => (release = r)),
    }
    const { d } = await startDaemon(sock, { ui: new Interact().register(slow as any) })
    const c = newClient(sock)

    const p = c.present({ kind: 'confirm', title: 't', message: 'm' })
    await new Promise(r => setTimeout(r, 30))
    await d.close() // daemon 没了

    // 必须以错误了结 —— 挂死是最糟的失败方式，调用方连降级的机会都没有
    await expect(p).rejects.toThrow(/connection closed/)
    release(undefined)
  })

  it('autoSpawn 关闭时连不上要明确报错', async () => {
    const c = new DaemonChannel({ socket: tmpSock(), autoSpawn: false })
    cleanup.push(() => c.close())
    await expect(c.present({ kind: 'confirm', title: 't', message: 'm' })).rejects.toThrow(/cannot reach/)
  })
})
