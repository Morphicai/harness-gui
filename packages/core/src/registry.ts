/**
 * Channel 注册表与选择策略
 */

import { Channel, Content, Field, Interaction, Option, Outcome } from './types.js'
import { validateContent } from './content.js'

/**
 * 默认优先级，数字小的先被问到。
 *
 * client 排在 web 前面：常驻客户端在的时候用它（有状态、不打扰），
 * 不在时自动落到一次性的本地网页。
 */
export const DEFAULT_PRIORITY: Record<string, number> = {
  scripted: 0,
  elicitation: 10,
  client: 15,
  web: 20,
  tty: 30,
  file: 40,
}

export interface PresentOptions {
  /** 指定 channel 名，绕过自动选择 */
  channel?: string
}

interface Entry {
  channel: Channel
  priority: number
}

export class Interact {
  private entries: Entry[] = []

  register(channel: Channel, priority?: number): this {
    this.unregister(channel.name)
    this.entries.push({ channel, priority: priority ?? DEFAULT_PRIORITY[channel.name] ?? 50 })
    this.entries.sort((a, b) => a.priority - b.priority)
    return this
  }

  unregister(name: string): this {
    this.entries = this.entries.filter(e => e.channel.name !== name)
    return this
  }

  get(name: string): Channel | undefined {
    return this.entries.find(e => e.channel.name === name)?.channel
  }

  /** 按优先级列出已注册 channel 名 */
  list(): string[] {
    return this.entries.map(e => e.channel.name)
  }

  /**
   * 派发一次交互。
   *
   * 没有任何 channel 支持时返回 `unsupported` 而不是抛错 —— 由调用方决定降级还是放弃。
   * 抛错会逼所有调用点写 try/catch，而「没有可用通道」是完全可预期的运行状态。
   */
  async present<V = unknown>(i: Interaction, opts: PresentOptions = {}): Promise<Outcome<V>> {
    if (i.kind === 'show') validateContent(i.content)

    const candidates = opts.channel
      ? this.entries.filter(e => e.channel.name === opts.channel)
      : this.entries

    for (const { channel } of candidates) {
      if (!channel.supports(i)) continue
      const outcome = await channel.present(i)
      return { ...outcome, channel: outcome.channel ?? channel.name } as Outcome<V>
    }
    return { action: 'unsupported' }
  }

  async close(): Promise<void> {
    for (const { channel } of this.entries) {
      await channel.close?.()
    }
  }

  // ==================== 便捷方法 ====================

  notify(p: { title: string; message: string; level?: 'info' | 'warn' | 'error' }, opts?: PresentOptions) {
    return this.present({ kind: 'notify', ...p }, opts)
  }

  show(p: { title: string; content: Content; awaitAck?: boolean; timeoutMs?: number }, opts?: PresentOptions) {
    return this.present({ kind: 'show', ...p }, opts)
  }

  confirm(p: { title: string; message: string; danger?: boolean; timeoutMs?: number }, opts?: PresentOptions) {
    return this.present<boolean>({ kind: 'confirm', ...p }, opts)
  }

  select(p: { title: string; message?: string; options: Option[]; multiple?: boolean; timeoutMs?: number }, opts?: PresentOptions) {
    return this.present<string | string[]>({ kind: 'select', ...p }, opts)
  }

  form(p: { title: string; message?: string; fields: Field[]; timeoutMs?: number }, opts?: PresentOptions) {
    return this.present<Record<string, unknown>>({ kind: 'form', ...p }, opts)
  }
}
