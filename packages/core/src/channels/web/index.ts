/**
 * web channel —— 本机 HTTP + 系统浏览器
 *
 * 安全约束（不是洁癖，交互内容可能含公司数据）：
 *  - 只绑 127.0.0.1，端口交给系统分配
 *  - 每个 session 一次性 token，无 token / 错 token 一律拒
 *  - 页面自包含，零外部资源
 *  - 不打访问日志、不把内容写盘
 *
 * 生命周期：同一个实例内的多次交互复用同一个 server 与同一个标签页（新交互经 SSE 推过去）。
 * 一次交互开一个新窗口在连续问答时是灾难。
 */

import { resolveMessages, type LocaleOption, type Messages } from '../../i18n.js'
import * as http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Channel, Interaction, Outcome, isOneWay } from '../../types.js'
import { renderPage } from './page.js'

export interface WebChannelOptions {
  /** 库自己的文案语言（按钮、校验提示等）；不给则用全局默认。
      调用方给的 title / message / 选项标签不受影响 —— 那些原样透传 */
  locale?: LocaleOption
  /** 是否自动打开浏览器。默认：有 TTY 且非 CI */
  autoOpen?: boolean
  /** 页面标题 */
  title?: string
  /**
   * 固定端口。默认 0（系统分配）——**除非调用方必须提前知道地址**，否则别用固定端口：
   * 随机端口能避开占用与被别的本机进程蹲守。
   * 目前唯一的正当用途是原生外壳：app.zon 里的 WebView URL 是构建期写死的。
   */
  port?: number
  /**
   * 页面掉线后等它回来的宽限期，默认 5s。
   *
   * 掉线分两种，SSE 层面区分不了：用户关掉了页面（放弃），还是刷新/网络抖动（马上回来）。
   * 一断就把等待中的交互全判 cancel，会让一次误触刷新毁掉整串问答；
   * 而无限等则让「关掉窗口」永远得不到结论。宽限期是这两者之间唯一诚实的折中：
   * 刷新通常一秒内回来，真关掉的不会回来。
   */
  disconnectGraceMs?: number
  /**
   * 往页面注入调试运行时（harness-fe 之类）。**默认关闭，且应当保持关闭。**
   *
   * 这个页面会经手密码、验证码、以及 memo / 邮件 / 通讯录等公司数据，而
   * 「敏感值直接回到程序、不经过日志和上下文」正是这一层刻意建立的性质。
   * 探针通常会录制 DOM 并落盘（rrweb 只遮蔽 `input[type=password]`，验证码、
   * 表格正文一概不遮），默认开启等于自己把这条性质拆掉 —— 所以必须显式打开，
   * 一次一次地想清楚再开。
   *
   * 脚本由本 server 从自己的 origin 提供，不引外部域名 —— 「页面零外部资源」
   * 这条不因为接探针而破例。
   */
  instrument?: {
    /** 注入前挂到 window 上的全局配置。如 harness-fe 读的是 `__HARNESS_FE__` */
    globals?: Record<string, unknown>
    /** 本地 JS 文件路径，按序注入。必须是打包好的浏览器产物 */
    scripts?: string[]
    /** 以 ES module 方式引入，默认 true */
    module?: boolean
  }
}

interface Pending {
  resolve: (o: Outcome) => void
  timer?: NodeJS.Timeout
  /** 原始载荷。页面重连后要重投 —— 发起方还在等，不能让它等一个已经没人看见的问题 */
  payload: string
}

export class WebChannel implements Channel {
  readonly name = 'web'
  private server?: http.Server
  private readonly token = randomBytes(24).toString('hex')
  private url?: string
  private clients = new Set<http.ServerResponse>()
  private pending = new Map<string, Pending>()
  /** 客户端还没连上时先攒着，连上立刻补发 */
  private backlog: string[] = []
  /** 页面自报的可见性；页面每次 visibilitychange 都会推过来 */
  private hidden = false
  private everConnected = false
  private browserOpened = false
  private seq = 0
  private readonly autoOpen: boolean
  private readonly title: string
  private readonly m: Messages
  private readonly port: number
  private readonly graceMs: number
  private readonly instrument?: WebChannelOptions['instrument']
  /** 掉线宽限计时器。页面回来要把它撤掉，否则等待中的交互会被迟到的定时器误杀 */
  private graceTimer?: NodeJS.Timeout

  constructor(opts: WebChannelOptions = {}) {
    this.autoOpen = opts.autoOpen ?? (Boolean(process.stdout.isTTY) && !process.env.CI)
    /* 构造时解析一次：页面是自包含的，文案在生成那一刻就烧进去了 */
    this.m = resolveMessages(opts.locale)
    this.title = opts.title ?? 'harness-gui'
    this.port = opts.port ?? 0
    this.graceMs = opts.disconnectGraceMs ?? 5000
    this.instrument = opts.instrument
  }

  /**
   * 探针脚本的注入片段。
   *
   * 全局配置整体序列化后赋值，而不是拼字符串 —— 配置值可能来自外部，
   * 而这个页面持有 token，拼接就是把 token 送出去的口子。
   */
  private instrumentHead(): string {
    const inst = this.instrument
    if (!inst) return ''
    const parts: string[] = []
    for (const [k, v] of Object.entries(inst.globals ?? {})) {
      parts.push(`<script>window[${jsonForScript(k)}]=${jsonForScript(v)}</script>`)
    }
    const type = inst.module === false ? '' : ' type="module"'
    ;(inst.scripts ?? []).forEach((_, i) => {
      parts.push(`<script${type} src="/__inst/${i}.js?t=${encodeURIComponent(this.token)}"></script>`)
    })
    return parts.join('\n')
  }

  supports(): boolean {
    return true
  }

  /** 页面地址（含 token）。无论是否自动打开都可取，供调用方自行展示 */
  async getUrl(): Promise<string> {
    await this.ensureServer()
    return this.url as string
  }

  /**
   * 当前连着的页面数（SSE 连接数）。
   *
   * 给外部宿主判断「界面到底起来没有」用 —— 原生外壳把这个页面装进 WebView 时，
   * 只有它连上 SSE 才说明页面真的在跑；探 /healthz 只能证明服务在听。
   */
  clientCount(): number {
    return this.clients.size
  }

  /**
   * 页面当前是否不可见（窗口被隐藏、标签页切走等）。
   *
   * 「连着」和「看得见」是两件事：常驻宿主里窗口可以隐藏而页面继续活着。
   * 界面看不见时，把交互送到人眼前得靠通知，不能指望人正好在看。
   * 没有页面连着时返回 false —— 那是「没有界面」，不是「界面藏起来了」。
   */
  clientHidden(): boolean {
    return this.clients.size > 0 && this.hidden
  }

  async present(i: Interaction): Promise<Outcome> {
    await this.ensureServer()
    const id = `i${++this.seq}`
    const payload = JSON.stringify({ ...i, id })

    // 单向交互没人接就先攒着，连上补发一次即可 —— 双向的走 pending，重连时会重投。
    // 单向的**不该**重投：页面刷新后再弹一遍早就过时的通知是打扰，不是恢复。
    if (this.clients.size === 0) {
      if (isOneWay(i)) this.backlog.push(payload)
    } else {
      this.broadcast('interaction', payload)
    }

    if (this.autoOpen && !this.browserOpened) {
      this.browserOpened = true
      openBrowser(this.url as string)
    }

    // 单向交互不等人：推过去就算数，页面负责展示
    if (isOneWay(i)) return { action: 'accept' }

    return new Promise<Outcome>(resolve => {
      const timer = i.timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id)
            this.syncRef()
            resolve({ action: 'timeout' })
          }, i.timeoutMs)
        : undefined
      this.pending.set(id, { resolve, timer, payload })
      this.syncRef()
    })
  }

  /**
   * 有人在等答复时把 server ref 住，没人等时 unref。
   *
   * 只 unref 会让「等用户回答」这件事本身没东西钉住事件循环 —— 一个 pending 的 Promise
   * 不维持 node 存活，进程会在弹出页面后直接退出（实跑 demo 才发现，单测里 vitest
   * 自己在维持进程，抓不到）。只 ref 则反过来：调用方忘了 close，node 永远不退。
   */
  private syncRef(): void {
    if (!this.server) return
    if (this.pending.size > 0) this.server.ref()
    else this.server.unref()
  }

  async close(): Promise<void> {
    // 显式关闭是确定的终止，不再给掉线宽限
    if (this.graceTimer) {
      clearTimeout(this.graceTimer)
      this.graceTimer = undefined
    }
    // 先把还等着的交互了结，避免调用方永久挂起
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.resolve({ action: 'cancel' })
    }
    this.pending.clear()
    this.syncRef()

    for (const res of this.clients) {
      try {
        res.write('event: bye\ndata: {}\n\n')
        res.end()
      } catch {
        /* 客户端已断开，忽略 */
      }
    }
    this.clients.clear()

    if (this.server) {
      const server = this.server
      this.server = undefined
      this.url = undefined
      await new Promise<void>(r => server.close(() => r()))
    }
  }

  // ==================== 内部 ====================

  private async ensureServer(): Promise<void> {
    if (this.server) return
    const server = http.createServer((req, res) => this.handle(req, res))
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        // 端口传 0 由系统分配；只绑回环，外部不可达，也不会触发 macOS 入站防火墙提示
        server.listen(this.port, '127.0.0.1', () => resolve())
      })
    } catch (err) {
      /*
       * 绑不上（指定端口被占）。必须**先关掉再抛**，否则 this.server 留着一个没在
       * 听的 server 对象，下次进来会被开头那句 `if (this.server) return` 挡住，
       * 调用方拿到一个 url 为 undefined 的「成功」。固定端口模式下这条路走得到。
       */
      server.close()
      throw err
    }
    this.server = server
    // 初始无人等待 → unref；有 pending 时 syncRef() 会 ref 回来
    this.syncRef()
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    this.url = `http://127.0.0.1:${port}/?t=${this.token}`
  }

  private checkToken(req: http.IncomingMessage): boolean {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const t = url.searchParams.get('t') ?? ''
    const a = Buffer.from(t)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname

    /*
     * 就绪探针 —— 唯一不校验 token 的端点。
     *
     * 外部宿主（如把页面装进 WebView 的原生壳）需要在加载前确认服务已起，而它拿不到 token：
     * 探针一律带不上 query。这里只回一个固定的 "ok"，不含任何交互内容、不泄露 token，
     * 能被探到的信息量与「这个端口上有东西在听」完全等同。
     */
    if (path === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('ok')
      return
    }

    if (!this.checkToken(req)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('unauthorized')
      return
    }

    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(renderPage(this.token, this.title, this.instrumentHead(), this.m))
      return
    }

    if (path.startsWith('/__inst/') && req.method === 'GET') {
      // 探针脚本从本 server 提供 —— 页面零外部资源这条不因为接探针而破例
      const idx = Number(path.slice('/__inst/'.length).replace(/\.js$/, ''))
      const file = this.instrument?.scripts?.[idx]
      if (!file) return void res.writeHead(404).end()
      try {
        const body = readFileSync(file)
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
      } catch {
        res.writeHead(500).end()
      }
      return
    }

    if (path === '/events' && req.method === 'GET') {
      this.attachClient(res)
      return
    }

    if (path === '/visibility' && req.method === 'POST') {
      this.readJson(req, body => {
        this.hidden = Boolean((body as { hidden?: unknown } | null)?.hidden)
        res.writeHead(204).end()
      })
      return
    }

    if (path === '/submit' && req.method === 'POST') {
      this.readJson(req, body => {
        const { id, action, value } = (body ?? {}) as { id?: string; action?: string; value?: unknown }
        const p = id ? this.pending.get(id) : undefined
        if (p) {
          this.pending.delete(id as string)
          if (p.timer) clearTimeout(p.timer)
          p.resolve({ action: action === 'accept' ? 'accept' : 'cancel', value })
          this.syncRef()
        }
        res.writeHead(204).end()
      })
      return
    }

    res.writeHead(404).end()
  }

  private attachClient(res: http.ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    // SSE 是长连接，别让默认 socket 超时把它掐了
    res.socket?.setTimeout(0)
    this.clients.add(res)
    this.everConnected = true

    // 页面回来了，撤掉掉线宽限计时器 —— 不撤的话它到点会把已经恢复的交互误杀
    if (this.graceTimer) {
      clearTimeout(this.graceTimer)
      this.graceTimer = undefined
    }

    // 补发连上之前攒下的单向交互（只补一次）
    for (const payload of this.backlog) res.write(`event: interaction\ndata: ${payload}\n\n`)
    this.backlog = []

    /*
     * 重投所有还在等答复的交互。
     *
     * 页面刷新后 DOM 全没了，但发起方还在 await —— 不重投的话它面对的是一个
     * 空白页面和一个永远不会有人回答的 Promise。重投是幂等的：id 不变，
     * 页面答哪一个都对得上。
     */
    for (const [, p] of this.pending) res.write(`event: interaction\ndata: ${p.payload}\n\n`)

    res.on('close', () => {
      this.clients.delete(res)
      /*
       * 页面掉线。**先别急着判 cancel** —— SSE 层面区分不了「关掉了」和「刷新中」。
       *
       * 给一个宽限期：回来了就当无事发生（上面会重投），到点还没回来才算放弃。
       * 必须限定「曾经连上过」：启动瞬间还没有任何客户端，那时的 pending 是在
       * 等浏览器打开，不是被放弃。
       */
      if (!this.everConnected || this.clients.size > 0) return
      if (this.graceTimer) clearTimeout(this.graceTimer)
      this.graceTimer = setTimeout(() => {
        this.graceTimer = undefined
        if (this.clients.size > 0) return // 竞态兜底：定时器排队期间页面回来了
        for (const [id, p] of this.pending) {
          if (p.timer) clearTimeout(p.timer)
          p.resolve({ action: 'cancel' })
          this.pending.delete(id)
        }
        this.syncRef()
      }, this.graceMs)
      // 宽限期本身不该钉住进程：调用方若已放弃等待，别拦着 node 退出
      this.graceTimer.unref?.()
    })
  }

  private broadcast(event: string, data: string): void {
    for (const res of this.clients) {
      try {
        res.write(`event: ${event}\ndata: ${data}\n\n`)
      } catch {
        /* 断开的客户端由 close 事件清理 */
      }
    }
  }

  private readJson(req: http.IncomingMessage, cb: (body: unknown) => void): void {
    let raw = ''
    req.on('data', c => {
      raw += c
      // 交互结果不该有兆级体积，超了直接断，避免被本机进程灌爆内存
      if (raw.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        cb(JSON.parse(raw || '{}'))
      } catch {
        cb({})
      }
    })
  }
}

/** 用系统默认浏览器打开。daemon 在原生外壳拉不起来时也要用它兜底 */
export function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' })
    child.unref()
  } catch {
    /* 打不开浏览器不是致命错误：调用方仍可从 getUrl() 拿到地址 */
  }
}

/**
 * 供内联 <script> 使用的 JSON。
 *
 * 光用 JSON.stringify 不够：它不转义 `<`，于是值里的 `</script>` 能直接把标签闭合掉、
 * 逃逸成新的脚本 —— 而这个页面持有 token。所以额外转掉 `<`，以及 U+2028/U+2029
 * （这两个字符在 JS 源码里是合法换行，会把语句从中间截断）。
 */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
