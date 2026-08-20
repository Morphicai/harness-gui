/**
 * interact daemon —— 独占交互界面，供多个消费者共享
 *
 * 为什么需要它：交互界面天然是单例的。同一台机器上跑着的多个 MCP / CLI / 脚本
 * 如果各开各的页面，用户会被同时弹出的几个窗口淹没，而且谁也不知道该答哪个。
 * daemon 把「界面」这件事收拢成一份，消费者只管把 Interaction 递进来。
 */

import * as net from 'node:net'
import * as fs from 'node:fs'
import { Interact } from '../registry.js'
import { Interaction } from '../types.js'
import { WebChannel, WebChannelOptions, openBrowser } from '../channels/web/index.js'
import { NATIVE_PORT, isAvailable as nativeAvailable, unavailableReason as nativeUnavailableReason, launch as launchNative, NativeShell } from '../native/shell.js'
import { socketPath, socketDir } from './paths.js'
import { createLineReader, encode, Request, Response, DaemonStatus, PROTOCOL_VERSION } from './protocol.js'

export interface NativeOptions {
  /** 原生外壳路径；不给则按 INTERACT_APP → 标准安装位置查找 */
  appPath?: string
}

export interface DaemonOptions {
  /** 无消费者且无待答交互后，多久自动退出。默认 5 分钟；0 表示常驻 */
  idleTimeoutMs?: number
  /** 传给内部 WebChannel */
  web?: WebChannelOptions
  /**
   * 用原生外壳承载页面。默认 true —— 但仅在**装了**外壳时才生效，
   * 没装就是浏览器，所以打开它不会让任何环境变糟。
   */
  native?: boolean | NativeOptions
  /** 自定义 UI（测试用）。不传则建一个只含 web 通道的 */
  ui?: Interact
  onLog?: (msg: string) => void
}

export class Daemon {
  private server?: net.Server
  private readonly ui: Interact
  private readonly consumers = new Set<net.Socket>()
  private readonly idleMs: number
  private idleTimer?: NodeJS.Timeout
  private pending = 0
  private readonly startedAt = Date.now()
  private readonly log: (m: string) => void
  private closing = false

  /** 承载页面的 web 通道。opts.ui 自带 UI 时（测试）为 undefined */
  private web?: WebChannel
  /** 页面该由原生外壳承载 —— 在 setupWeb() 里按端口是否绑得上决定 */
  private useNative = false
  private shell?: NativeShell
  private viewer?: Promise<void>

  constructor(private readonly opts: DaemonOptions = {}) {
    this.idleMs = opts.idleTimeoutMs ?? 5 * 60_000
    this.log = opts.onLog ?? (() => {})
    // web 通道挪到 start() 里建：要不要用固定端口取决于原生外壳在不在，
    // 而端口绑不绑得上只有真去 listen 才知道
    this.ui = opts.ui ?? new Interact()
  }

  /**
   * 启动并独占 socket。
   *
   * 返回 false 表示**已经有别的 daemon 占着**（单实例语义）—— 调用方应该去连它，
   * 而不是报错。这条路径在两个消费者同时冷启动时一定会走到。
   */
  async start(): Promise<boolean> {
    const sock = socketPath()
    fs.mkdirSync(socketDir(), { recursive: true, mode: 0o700 })

    const listen = () =>
      new Promise<boolean>(resolve => {
        const server = net.createServer(s => this.attach(s))
        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') return resolve(false)
          throw err
        })
        server.listen(sock, () => {
          this.server = server
          // 只有本用户能连。socket 上没有 token，权限就是唯一的门
          try {
            fs.chmodSync(sock, 0o600)
          } catch {
            /* Windows 命名管道没有 chmod，忽略 */
          }
          resolve(true)
        })
      })

    if (await listen()) {
      await this.setupWeb()
      this.armIdle()
      return true
    }

    /*
     * 端口被占。分两种，必须区分：
     *   - 真有 daemon 在听 → 让位
     *   - 上次没清干净的死 socket → 删掉重来
     * 判据只能是「连一下试试」，文件存在与否说明不了任何事。
     */
    if (await probeAlive(sock)) return false
    this.log('发现残留 socket，清理后重试')
    try {
      fs.unlinkSync(sock)
    } catch {
      /* 竞态：别人抢先删了，继续重试即可 */
    }
    if (await listen()) {
      await this.setupWeb()
      this.armIdle()
      return true
    }
    return false // 重试期间被别人抢到，同样让位
  }

  /**
   * 建页面通道，并决定由谁承载它。
   *
   * 原生外壳的 origin 白名单是编译期写死的，所以用它就必须绑固定端口 —— 而固定端口
   * 是会被占的。这里**先试着绑**，绑不上就退回系统分配端口 + 浏览器：宁可少一层
   * 原生能力，也不能让 daemon 起不来。
   */
  private async setupWeb(): Promise<void> {
    if (this.opts.ui) return // 测试自带 UI，不碰

    const nativeOpt = this.opts.native ?? process.env.INTERACT_NATIVE !== '0'
    const appPath = typeof nativeOpt === 'object' ? nativeOpt.appPath : undefined

    // 用不了原生壳时把原因说出来再退回 web —— 静默降级会让人以为壳坏了，
    // 而真实原因（平台没构建 / 缺 WebView2 / 没装壳包）各不相同、排查方向完全不同
    if (nativeOpt !== false && !nativeAvailable(appPath)) {
      this.log(nativeUnavailableReason(appPath) ?? '原生壳不可用')
    }
    if (nativeOpt !== false && nativeAvailable(appPath)) {
      const web = new WebChannel({ ...this.opts.web, autoOpen: false, port: NATIVE_PORT })
      try {
        await web.getUrl() // 真去 listen，绑不上会抛
        this.web = web
        this.useNative = true
        this.log(`原生外壳模式，页面在 127.0.0.1:${NATIVE_PORT}`)
      } catch (err) {
        await web.close()
        this.log(`固定端口 ${NATIVE_PORT} 绑不上（${(err as Error).message}），退回浏览器`)
      }
    }

    if (!this.web) {
      // 浏览器模式让 WebChannel 自己在首次交互时弹 —— 它已经有 autoOpen 了。
      // daemon 跑在 detached 进程里，isTTY 是 false，所以必须显式打开
      this.web = new WebChannel({ port: 0, ...this.opts.web, autoOpen: true })
    }
    this.ui.register(this.web)
  }

  /**
   * 确保人真的看得到界面。
   *
   * 只在**第一次有交互进来**时才拉窗口：daemon 可能被一个从头到尾不需要人参与的
   * 脚本拉起来，那种情况下弹窗纯属抢屏幕。
   *
   * 浏览器模式什么都不用做（WebChannel 的 autoOpen 会处理），这里只管原生外壳。
   */
  private ensureViewer(): Promise<void> {
    if (!this.useNative || !this.web) return Promise.resolve()
    if (this.viewer) return this.viewer

    this.viewer = (async () => {
      const url = await this.web!.getUrl()
      try {
        this.shell = launchNative(url, { appPath: this.nativeAppPath(), onLog: this.log })
        this.log(`原生外壳已拉起 pid=${this.shell.child.pid}`)
      } catch (err) {
        // 装了却起不来（权限、Gatekeeper、二进制损坏…）。人还等着，别把交互耗在这里
        this.log(`原生外壳拉不起来（${(err as Error).message}），改用浏览器`)
        this.useNative = false
        openBrowser(url)
      }
    })()
    return this.viewer
  }

  private nativeAppPath(): string | undefined {
    const n = this.opts.native
    return typeof n === 'object' ? n.appPath : undefined
  }

  status(): DaemonStatus {
    const web = this.web ?? (this.ui.get('web') as WebChannel | undefined)
    return {
      protocol: PROTOCOL_VERSION,
      pid: process.pid,
      consumers: this.consumers.size,
      pending: this.pending,
      clients: web?.clientCount() ?? 0,
      hidden: web?.clientHidden() ?? false,
      startedAt: this.startedAt,
    }
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    if (this.idleTimer) clearTimeout(this.idleTimer)
    for (const s of this.consumers) s.destroy()
    this.consumers.clear()
    await this.ui.close()
    // 外壳的生命周期挂在 daemon 上：留一个连不上任何东西的托盘图标，
    // 比没有图标更让人困惑
    if (this.shell) {
      await this.shell.close()
      this.shell = undefined
    }
    if (this.server) {
      const server = this.server
      this.server = undefined
      await new Promise<void>(r => server.close(() => r()))
    }
    try {
      fs.unlinkSync(socketPath())
    } catch {
      /* 已经没了就算了 */
    }
  }

  // ==================== 内部 ====================

  private attach(sock: net.Socket): void {
    this.consumers.add(sock)
    this.armIdle()

    const send = (r: Response) => {
      if (!sock.destroyed) sock.write(encode(r))
    }

    const read = createLineReader(
      line => {
        let req: Request
        try {
          req = JSON.parse(line)
        } catch {
          return send({ id: '', ok: false, error: '请求不是合法 JSON' })
        }
        void this.dispatch(req, send)
      },
      () => {
        this.log('单行超限，断开该消费者')
        sock.destroy()
      },
    )

    sock.on('data', read)
    sock.on('error', () => sock.destroy())
    sock.on('close', () => {
      this.consumers.delete(sock)
      this.armIdle()
    })
  }

  private async dispatch(req: Request, send: (r: Response) => void): Promise<void> {
    try {
      if (req.method === 'status') return send({ id: req.id, ok: true, result: this.status() })
      if (req.method === 'shutdown') {
        send({ id: req.id, ok: true, result: { ok: true } })
        setTimeout(() => void this.close(), 10)
        return
      }
      if (req.method === 'present') {
        this.pending++
        this.armIdle()
        try {
          // 人从状态栏退出过外壳的话，这里会把它重新拉起来
          if (this.shell && !this.shell.alive()) this.viewer = undefined
          await this.ensureViewer()
          const outcome = await this.ui.present(req.params.interaction as Interaction)
          send({ id: req.id, ok: true, result: outcome })
        } finally {
          this.pending--
          this.armIdle()
        }
        return
      }
      send({ id: (req as { id: string }).id, ok: false, error: `未知方法：${(req as { method: string }).method}` })
    } catch (err) {
      send({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  /**
   * 空闲判定：没有消费者、也没有人在等答复，才开始倒计时。
   *
   * 只看消费者数是不够的 —— 一个脚本可能发完 present 就断开连接去做别的事，
   * 而人还对着窗口没点；那时候把 daemon 关掉，用户点下去会石沉大海。
   */
  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    if (this.idleMs <= 0 || this.closing) return
    if (this.consumers.size > 0 || this.pending > 0) return
    this.idleTimer = setTimeout(() => {
      this.log('空闲超时，退出')
      void this.close()
    }, this.idleMs)
    this.idleTimer.unref?.()
  }
}

/** 连一下看那头有没有活着的 daemon。死 socket 会以 ECONNREFUSED/ENOENT 立刻失败 */
export function probeAlive(sock: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const c = net.connect(sock)
    const done = (v: boolean) => {
      c.removeAllListeners()
      c.destroy()
      resolve(v)
    }
    c.once('connect', () => done(true))
    c.once('error', () => done(false))
    c.setTimeout(timeoutMs, () => done(false))
  })
}
