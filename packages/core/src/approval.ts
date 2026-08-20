/**
 * 批准闸门 —— 给「由模型调用的工具」用的入口
 *
 * ## 为什么批准必须走带外通道
 *
 * 常见的反面做法是给工具加一个 `confirm: true` 参数当护栏。那不是护栏 ——
 * **那个参数模型自己就能填**，而且拒绝时的报错文案往往顺手把填法教给它了
 * （"pass confirm=true if that is what you want"），下一轮它就照做。
 *
 * 所以确认要送到真人那里去：**模型能构造的只有请求，构造不出人的批准。**
 *
 * ## 为什么默认关闭
 *
 * 库无从判断此刻有没有人在看。MCP 的 stdio 传输下 stdin 是协议通道不是终端，
 * TTY 探测没有意义；而 daemon 通道是恒「可用」的 —— 它只会去拉起一个没人看的
 * daemon 然后干等到超时。在无头环境里那不是降级，是挂死。
 *
 * 与其猜，不如让开启的人明确知道自己开了什么。已有的自动化因此完全不受影响。
 */

import { Interact } from './registry.js'
import { DaemonChannel } from './daemon/client.js'
import { TtyChannel } from './channels/tty.js'
import { markdownToContent } from './markdown.js'
import type { Content } from './types.js'

/** 默认等人的时间。人要读完内容再决定，比机器超时该宽得多 */
const DEFAULT_TIMEOUT_MS = 5 * 60_000

/**
 * 交互策略，由环境变量 `HARNESS_GUI` 控制。
 *
 * - `off`（**默认**）：完全不交互，行为与未接入时一致
 * - `on`：危险动作要人点头；**拿不到通道时按原行为继续**
 * - `strict`：同上，但拿不到通道就拒绝执行 —— 给「宁可停下也不能误发」的场景
 */
export type InteractMode = 'on' | 'strict' | 'off'

/** 读取当前策略 */
export function interactMode(): InteractMode {
  const v = (process.env.HARNESS_GUI ?? '').toLowerCase()
  if (v === 'strict') return 'strict'
  if (v === 'on' || v === '1' || v === 'true') return 'on'
  return 'off'
}

let shared: Interact | undefined

/**
 * 取共享实例。
 *
 * 走 daemon 而不是各自开页面：一个进程里可能并行跑多个会话，各开各的页面会让人
 * 被同时弹出的几个窗口淹没，而且不知道该答哪个。daemon 把界面收拢成一份。
 *
 * daemon 通道是懒连接的 —— 不发生交互就不会拉起它。终端兜底放在后面，
 * 由各通道的 supports() 决定谁真正接手。
 */
export function getUi(): Interact {
  if (!shared) {
    shared = new Interact().register(new DaemonChannel()).register(new TtyChannel())
  }
  return shared
}

/**
 * 换掉共享实例。传 undefined 复位到默认（daemon + tty）。
 *
 * 给「整个进程都走同一个自建实例」的情况用 —— 比如一个 CLI 已经
 * `createInteract()` 过了，希望批准也从那儿走。单次调用另有 `ui` 参数。
 */
export function setUi(next: Interact | undefined): void {
  shared = next
}

/** @deprecated 用 {@link setUi}。保留是因为 0.2.0 已经导出了这个名字 */
export const setUiForTest = setUi

export class ApprovalDeniedError extends Error {
  constructor(
    public readonly action: string,
    public readonly reason: string,
  ) {
    super(`${action} was not approved: ${reason}`)
    this.name = 'ApprovalDeniedError'
    Object.setPrototypeOf(this, ApprovalDeniedError.prototype)
  }
}

export interface ApprovalRequest {
  /** 这次要干什么，用于报错文案，如 'delete rows' */
  action: string
  title: string
  message: string
  /**
   * 附带展示的内容（待删列表、消息正文预览等），批准之前先让人看见。
   *
   * 给字符串就按 markdown 渲染 —— 「删除 12 行」和「删除**这** 12 行」
   * 是两个不同的决定，而只有后者是知情的，所以让附上载荷这件事足够省事。
   */
  preview?: Content | string
  /** 不可逆或外发时置 true，界面上用醒目样式。默认 true */
  danger?: boolean
  timeoutMs?: number
  /**
   * 用这个实例，而不是共享的那个。
   *
   * SDK 用户往往已经 `createInteract()` 过了 —— 没有这个参数的话，批准会走
   * 另一条通道（默认是 daemon），于是同一个程序里出现两个界面。
   */
  ui?: Interact
}

/**
 * 要一次人工批准。没拿到就抛 —— 调用方不必判断返回值，抛出即中止。
 *
 * `timeout` 与 `cancel` 分开报：前者是「没人在」，后者是明确的「不要」。
 * 两者都不放行，但文案不同，便于事后分清到底是无人应答还是被拒。
 */
export async function requireApproval(req: ApprovalRequest): Promise<void> {
  const mode = interactMode()
  if (mode === 'off') return

  const ui = req.ui ?? getUi()

  if (req.preview) {
    // 展示失败不该顶掉批准本身 —— 那只是没看到附件，不是操作出错
    try {
      await ui.show({ title: req.title, content: await asContent(req.preview) })
    } catch {
      /* 继续问 */
    }
  }

  let outcome
  try {
    outcome = await ui.confirm({
      title: req.title,
      message: req.message,
      danger: req.danger ?? true,
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  } catch (err) {
    // 通道本身出错（daemon 拉不起来等）。strict 下这就是拒绝
    if (mode === 'strict') {
      throw new ApprovalDeniedError(
        req.action,
        `could not deliver the request (${(err as Error).message})`,
      )
    }
    return
  }

  if (outcome.action === 'accept') return

  if (outcome.action === 'unsupported') {
    // 没有任何通道能触达人。on 下按原行为继续 —— 一刀切拒绝会打断无头环境里
    // 已有的自动化；strict 下则宁可停下
    if (mode === 'strict') {
      throw new ApprovalDeniedError(req.action, 'no channel can reach a human (HARNESS_GUI=strict)')
    }
    return
  }

  throw new ApprovalDeniedError(
    req.action,
    outcome.action === 'timeout' ? 'timed out waiting for an answer' : 'declined by the human',
  )
}

/**
 * 让人手填一段内容 —— 典型用途是验证码之类**不该经过模型上下文**的东西。
 *
 * 返回 undefined 表示放弃（取消 / 超时 / 无通道）。刻意不返回空串：
 * 空串会被下游当成「人填了空」继续送出去。
 */
export async function askText(p: {
  title: string
  message?: string
  label: string
  placeholder?: string
  /** 置 true 走密码输入框，值不回显 */
  secret?: boolean
  timeoutMs?: number
  /** 用这个实例，而不是共享的那个 */
  ui?: Interact
}): Promise<string | undefined> {
  if (interactMode() === 'off') return undefined
  try {
    const r = await (p.ui ?? getUi()).form({
      title: p.title,
      message: p.message,
      fields: [
        {
          name: 'text',
          label: p.label,
          type: p.secret ? 'password' : 'text',
          required: true,
          placeholder: p.placeholder,
        },
      ],
      timeoutMs: p.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    if (r.action !== 'accept') return undefined
    const v = (r.value as { text?: unknown } | undefined)?.text
    const s = typeof v === 'string' ? v.trim() : ''
    return s || undefined
  } catch {
    return undefined
  }
}

/**
 * 把内容摆到人眼前看一眼。纯展示。
 *
 * 与「把内容 return 给模型」的区别：那份是给模型读的，这份是给**人**看的。
 * 两者常常都要，但去处不同 —— 人看的可以富排版、可以很长，且不占模型上下文。
 */
export async function showToUser(p: {
  title: string
  /** 给字符串就按 markdown 渲染 */
  content: Content | string
  awaitAck?: boolean
  /** 用这个实例，而不是共享的那个 */
  ui?: Interact
}): Promise<void> {
  if (interactMode() === 'off') return
  try {
    await (p.ui ?? getUi()).show({
      title: p.title,
      content: await asContent(p.content),
      awaitAck: p.awaitAck,
    })
  } catch {
    /* 展示失败不该让整个工具失败 */
  }
}

/**
 * 字符串按 markdown 渲染，已经是 Content 的原样返回。
 *
 * 之所以值得有：批准的价值一半在「让人看见他在批准什么」，而手搓 Content
 * 的那点摩擦足以让人省掉预览 —— 省掉之后批准就退化成一次盲签。
 */
export async function asContent(c: Content | string): Promise<Content> {
  return typeof c === 'string' ? await markdownToContent(c) : c
}
