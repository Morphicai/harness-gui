/**
 * harness-gui —— 程序与人交互的界面层
 *
 * 一套协议（Interaction / Outcome），多个通道（Channel）。调用方不必知道当前用的是哪个通道。
 *
 * @example
 * ```ts
 * import { createInteract } from 'harness-gui'
 *
 * const ui = createInteract()               // 默认注册 tty + web
 * const r = await ui.confirm({ title: '删除', message: '不可撤销', danger: true })
 * if (r.action === 'accept') { ... }
 * await ui.close()
 * ```
 */

export * from './types.js'
export { validateContent, renderText, toT1 } from './content.js'
export { markdownToContent, type RichMarkdownOptions } from './markdown.js'
export { Interact, DEFAULT_PRIORITY, type PresentOptions } from './registry.js'
export { ScriptedChannel, answer, type TranscriptEntry } from './channels/scripted.js'
export { TtyChannel, type TtyChannelOptions } from './channels/tty.js'
export { WebChannel, type WebChannelOptions } from './channels/web/index.js'
export { Daemon, type DaemonOptions, type NativeOptions } from './daemon/server.js'
export {
  NATIVE_PORT,
  isAvailable as nativeShellAvailable,
  resolveExecutable as resolveNativeShell,
  launch as launchNativeShell,
  type NativeShell,
  type NativeShellOptions,
} from './native/shell.js'
export { DaemonChannel, type DaemonChannelOptions } from './daemon/client.js'
export { socketPath } from './daemon/paths.js'
export { PROTOCOL_VERSION, type DaemonStatus } from './daemon/protocol.js'

import { Interact } from './registry.js'
import { TtyChannel } from './channels/tty.js'
import { WebChannel, WebChannelOptions } from './channels/web/index.js'

export interface CreateInteractOptions {
  /** 注册终端通道，默认 true */
  tty?: boolean
  /** 注册本地网页通道，默认 true；传对象可配置 */
  web?: boolean | WebChannelOptions
}

/**
 * 建一个带默认通道的实例。
 *
 * 顺序上 web 优先于 tty：能开图形界面时给富一点的形态，纯终端环境（无 TTY 也无桌面）
 * 由各自的 supports() 决定谁接。
 */
export function createInteract(opts: CreateInteractOptions = {}): Interact {
  const ui = new Interact()
  if (opts.web !== false) {
    ui.register(new WebChannel(typeof opts.web === 'object' ? opts.web : {}))
  }
  if (opts.tty !== false) {
    ui.register(new TtyChannel())
  }
  return ui
}
