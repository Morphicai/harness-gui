/**
 * 交互协议 —— 程序与人之间的统一契约
 *
 * 一次交互用 Interaction 描述，交给某个 Channel 触达人，拿回 Outcome。
 * 协议层不认识任何具体 UI：终端、本地网页、宿主对话框、IM 卡片都只是 Channel 的实现。
 */

export type Level = 'info' | 'warn' | 'error'

// ==================== Content ====================

/**
 * T1 声明式内容：**所有 channel 都必须能渲染**。
 * 能力受限的 channel（如终端）可以降级表现，但不能输出空白。
 */
export type T1Content =
  | { type: 'markdown'; text: string }
  | { type: 'table'; columns: string[]; rows: (string | number | null)[][] }
  | { type: 'chart'; chart: 'bar'; labels: string[]; values: number[]; unit?: string }
  | { type: 'diff'; before: string; after: string; filename?: string }
  | { type: 'image'; src: string; alt?: string }

/**
 * T2 原始内容：只有浏览器类 channel 能渲染。
 *
 * `fallback` 是**强制**的：没有它，同一次 show 在网页上是张图、在终端上就是一片空白，
 * 而调用方根本不知道自己丢了东西。宁可在开发期抛错，也不要运行期静默丢内容。
 */
export type T2Content =
  | { type: 'html'; html: string; fallback: T1Content }
  | { type: 'url'; url: string; fallback: T1Content }

export type Content = T1Content | T2Content

export function isT2(c: Content): c is T2Content {
  return c.type === 'html' || c.type === 'url'
}

// ==================== Interaction ====================

export interface Option {
  label: string
  value: string
  description?: string
}

export type Field =
  | { name: string; label: string; type: 'text' | 'password' | 'number'; required?: boolean; placeholder?: string; default?: string }
  | { name: string; label: string; type: 'select'; options: Option[]; required?: boolean; default?: string }
  | { name: string; label: string; type: 'boolean'; default?: boolean }

interface Base {
  title: string
  /** 超时毫秒数；不传则不超时。超时与用户主动取消是两种不同的 Outcome */
  timeoutMs?: number
}

export type Interaction =
  | (Base & { kind: 'notify'; message: string; level?: Level })
  | (Base & { kind: 'show'; content: Content; awaitAck?: boolean })
  | (Base & { kind: 'confirm'; message: string; danger?: boolean })
  | (Base & { kind: 'select'; message?: string; options: Option[]; multiple?: boolean })
  | (Base & { kind: 'form'; message?: string; fields: Field[] })

export type InteractionKind = Interaction['kind']

/**
 * 单向交互：不等人应答，present 必须立即返回 accept。
 * `show` 只有显式 awaitAck 时才是双向的。
 */
export function isOneWay(i: Interaction): boolean {
  return i.kind === 'notify' || (i.kind === 'show' && !i.awaitAck)
}

// ==================== Outcome ====================

/**
 * - accept      用户给出了答复（单向交互也用它，value 为空）
 * - cancel      用户主动放弃（点取消、关窗口）
 * - timeout     到期无人应答
 * - unsupported 没有任何 channel 能承接
 *
 * cancel 与 timeout 必须分开：前者是明确的「不要」，后者是「没人在」，
 * 调用方对这两种的处理往往相反。
 */
export type OutcomeAction = 'accept' | 'cancel' | 'timeout' | 'unsupported'

export interface Outcome<V = unknown> {
  action: OutcomeAction
  value?: V
  /** 实际承接这次交互的 channel 名，便于排查与测试断言 */
  channel?: string
}

// ==================== Channel ====================

/**
 * 通道 —— 把一次交互送达人并取回结果。
 *
 * 之所以叫 Channel 而不是 Renderer：scripted 不渲染任何东西，将来的 IM 通道也不渲染。
 */
export interface Channel {
  name: string
  /** 能力探测。返回 false 时选择器跳过它，不算错误 */
  supports(i: Interaction): boolean
  present(i: Interaction): Promise<Outcome>
  /** 释放资源（web channel 关 server 等）。可选 */
  close?(): Promise<void>
}
