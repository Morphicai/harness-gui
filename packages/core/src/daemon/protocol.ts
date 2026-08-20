/**
 * daemon 的线路协议 —— NDJSON（一行一个 JSON）
 *
 * 用行分隔而不是长度前缀：交互请求都很小，可读性在排查时比几个字节的开销值钱得多；
 * 单行超长（异常大的 show 内容）由 readLines 的上限兜住，不会把内存灌爆。
 */

import { Interaction, Outcome } from '../types.js'

export const PROTOCOL_VERSION = 1

/** 单行上限。超了直接断连 —— 正常交互不该有兆级单行 */
export const MAX_LINE_BYTES = 4 * 1024 * 1024

export type Request =
  | { id: string; method: 'present'; params: { interaction: Interaction } }
  | { id: string; method: 'status' }
  | { id: string; method: 'shutdown' }

export type Response =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

export interface DaemonStatus {
  protocol: number
  pid: number
  /** 当前连着的消费者数 */
  consumers: number
  /** 等待人回答的交互数 */
  pending: number
  /** 界面（页面）连着几个 */
  clients: number
  /** 界面是否处于不可见状态 */
  hidden: boolean
  /** 页面地址，便于人工打开 */
  url?: string
  startedAt: number
}

/**
 * 把字节流拆成整行，交给 onLine。
 *
 * 之所以自己写而不用 readline：需要对超长行主动断连（见 MAX_LINE_BYTES），
 * readline 会一直缓冲到行尾，正好是我们要防的那种情况。
 */
export function createLineReader(onLine: (line: string) => void, onOverflow: () => void) {
  let buf = ''
  return (chunk: Buffer | string): void => {
    buf += chunk
    if (buf.length > MAX_LINE_BYTES) {
      buf = ''
      onOverflow()
      return
    }
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (line) onLine(line)
    }
  }
}

export function encode(msg: Request | Response): string {
  return JSON.stringify(msg) + '\n'
}

export type PresentResult = Outcome
