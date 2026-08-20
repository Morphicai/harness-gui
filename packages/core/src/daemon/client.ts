/**
 * daemon 的消费者侧 —— 一个把交互转发出去的 Channel
 *
 * 对调用方来说它和别的 Channel 没区别；区别在于界面不归它管，
 * 由 daemon 独占。多个进程同时用也只会看到一个界面。
 */

import * as net from 'node:net'
import { spawn } from 'node:child_process'
import * as path from 'node:path'
import { Channel, Interaction, Outcome } from '../types.js'
import { socketPath } from './paths.js'
import { createLineReader, encode, Request, Response, DaemonStatus } from './protocol.js'

export interface DaemonChannelOptions {
  /** 连不上时是否自动拉起 daemon，默认 true */
  autoSpawn?: boolean
  /** 等 daemon 起来的上限，默认 8s */
  spawnTimeoutMs?: number
  socket?: string
}

export class DaemonChannel implements Channel {
  readonly name = 'client'
  private sock?: net.Socket
  private seq = 0
  private readonly waiting = new Map<string, { resolve: (r: Response) => void }>()
  private readonly autoSpawn: boolean
  private readonly spawnTimeoutMs: number
  private readonly sockPath: string
  private connecting?: Promise<void>

  constructor(opts: DaemonChannelOptions = {}) {
    this.autoSpawn = opts.autoSpawn ?? true
    this.spawnTimeoutMs = opts.spawnTimeoutMs ?? 8000
    this.sockPath = opts.socket ?? socketPath()
  }

  /**
   * 能力探测。
   *
   * 这里刻意**不**去连 daemon：supports() 会在每次派发时被调用，
   * 让它做 IO 会把「探测」变成「副作用」，而且连不上时还会拖慢降级到 tty 的速度。
   * 真正连不上时 present() 会抛，由 Interact 决定后续 —— 那是它该管的事。
   */
  supports(): boolean {
    return true
  }

  async present(i: Interaction): Promise<Outcome> {
    await this.ensure()
    const id = `r${++this.seq}`
    const res = await this.rpc({ id, method: 'present', params: { interaction: i } })
    if (!res.ok) throw new Error(res.error)
    return res.result as Outcome
  }

  async status(): Promise<DaemonStatus> {
    await this.ensure()
    const res = await this.rpc({ id: `r${++this.seq}`, method: 'status' })
    if (!res.ok) throw new Error(res.error)
    return res.result as DaemonStatus
  }

  /** 只断开自己，不关 daemon —— 别的消费者可能还在用 */
  async close(): Promise<void> {
    this.sock?.destroy()
    this.sock = undefined
    // 断开时把还在等的请求了结，避免调用方永久挂起
    for (const [, w] of this.waiting) w.resolve({ id: '', ok: false, error: 'daemon connection closed' })
    this.waiting.clear()
  }

  /** 请 daemon 退出（谨慎：其他消费者的界面会一起没） */
  async shutdownDaemon(): Promise<void> {
    await this.ensure()
    await this.rpc({ id: `r${++this.seq}`, method: 'shutdown' })
    await this.close()
  }

  // ==================== 内部 ====================

  private async ensure(): Promise<void> {
    if (this.sock && !this.sock.destroyed) return
    // 并发的 present 不该各自拉起一个 daemon
    if (!this.connecting) {
      this.connecting = this.connectOrSpawn().finally(() => {
        this.connecting = undefined
      })
    }
    return this.connecting
  }

  private async connectOrSpawn(): Promise<void> {
    try {
      this.sock = await connect(this.sockPath)
      this.bind(this.sock)
      return
    } catch {
      if (!this.autoSpawn) throw new Error(`cannot reach the harness-gui daemon (${this.sockPath})`)
    }

    spawnDaemon()

    // daemon 起来需要时间；轮询而不是固定 sleep，正常情况几十毫秒就连上了
    const deadline = Date.now() + this.spawnTimeoutMs
    for (;;) {
      await sleep(80)
      try {
        this.sock = await connect(this.sockPath)
        this.bind(this.sock)
        return
      } catch {
        if (Date.now() > deadline) throw new Error(`daemon did not become ready within ${this.spawnTimeoutMs}ms`)
      }
    }
  }

  private bind(sock: net.Socket): void {
    const read = createLineReader(
      line => {
        let res: Response
        try {
          res = JSON.parse(line)
        } catch {
          return
        }
        const w = this.waiting.get(res.id)
        if (w) {
          this.waiting.delete(res.id)
          w.resolve(res)
        }
      },
      () => sock.destroy(),
    )
    sock.on('data', read)
    sock.on('close', () => {
      // 连接断了要把等待中的请求全部了结，否则调用方永远拿不到结果
      for (const [, w] of this.waiting) w.resolve({ id: '', ok: false, error: 'daemon connection closed' })
      this.waiting.clear()
      if (this.sock === sock) this.sock = undefined
    })
    sock.on('error', () => sock.destroy())
    // 等人回答可能很久，别让 socket 空闲超时把它掐了
    sock.setTimeout(0)
  }

  private rpc(req: Request): Promise<Response> {
    return new Promise(resolve => {
      this.waiting.set(req.id, { resolve })
      this.sock!.write(encode(req))
    })
  }
}

function connect(sockPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const c = net.connect(sockPath)
    c.once('connect', () => {
      c.removeAllListeners('error')
      resolve(c)
    })
    c.once('error', err => {
      c.destroy()
      reject(err)
    })
  })
}

/**
 * 拉起 daemon。
 *
 * detached + unref：daemon 的生命周期不该挂在拉起它的那个进程上 ——
 * 一个跑完就退的 CLI 不应该把用户正在看的窗口一起带走。
 */
function spawnDaemon(): void {
  // 本包编译为 CommonJS，__dirname 一定可用；bin.js 与本文件同目录
  const entry = path.join(__dirname, 'bin.js')
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.unref()
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
