/**
 * 界面文案 —— 库自己的那部分（按钮、校验提示、终端 prompt、降级原因）
 *
 * 调用方传进来的 title / message / 选项标签**不经过这里**：那些是调用方写的，
 * 用什么语言由它决定。这里只管库自己产出的字。
 *
 * ## 为什么是扁平的字符串字典，而不是函数
 *
 * 网页那份文案要**序列化进生成的浏览器 JS**（见 channels/web/page.ts）——
 * 函数序列化不了。扁平字典还顺带换来一件事：用户能用一个普通对象部分覆盖，
 * 不必等我们发版。插值统一用 `{name}` 占位符。
 *
 * ## 哪些**不**进这张表
 *
 * `throw new Error(...)` 和 daemon 的运行日志一律**英文字面量**，不本地化。
 * 那些是给开发者看的：本地化之后既搜不到、也没法拿去对着 issue 与文档匹配，
 * 而这正是遇到报错的人最需要做的事。Node / TS / React 也都只抛英文。
 * 这张表只管「**不是开发者的人**会看到的字」。
 *
 * ## 为什么默认英文、且不看 LANG
 *
 * 默认值必须是确定的。跟着 `LANG` 走会让同一份代码在不同机器上说不同的语言，
 * 而这类差异在 CI 与容器里最难复现 —— 想要中文就显式要。
 */

export type Locale = 'en' | 'zh'

/** 库自己的全部文案。值里的 `{name}` 会被 fmt() 替换 */
export interface Messages {
  /** <html lang> 的值 */
  lang: string

  // ── 网页 ────────────────────────────────────────────────
  /** confirm 没给 message 时的兜底正文 */
  needConfirm: string
  needSelect: string
  needFill: string
  /** 服务端关掉连接后的收尾提示 */
  sessionEnded: string
  /** 答完一次、等下一次交互时的占位 */
  submitted: string
  /** 页面刚打开、还没有交互送达时的占位 */
  waiting: string
  /** show + awaitAck 的确认按钮 */
  ack: string
  /** confirm 的主按钮 */
  confirm: string
  cancel: string
  /** select 的主按钮 */
  ok: string
  /** form 的主按钮 */
  submit: string
  /** 一个都没选就提交 */
  pickOne: string
  /** 必填项没填 */
  fillRequired: string

  // ── 终端 ────────────────────────────────────────────────
  pressEnter: string
  /** y/N 的字母不翻译 —— 输入解析认的是 y/yes */
  confirmPrompt: string
  selectMultiple: string
  selectOne: string
  itemNumber: string

  // ── 纯文本渲染（终端等非浏览器通道）──────────────────────
  /** {alt} 可能为空；{src} 是图片地址 */
  imagePlaceholder: string
  /** diff 两边一样时 */
  noDiff: string

  // ── 原生壳的降级原因（会进日志，也会被 nativeShellUnavailableReason 返回）──
  /** {platform} {arch} */
  noBuildForPlatform: string
  /** {env} */
  webView2Missing: string
  /** {env} */
  shellNotFound: string
  /** {message} */
  launchFailed: string
  nativeUnavailable: string
}

const en: Messages = {
  lang: 'en',
  needConfirm: 'Please confirm',
  needSelect: 'Please choose',
  needFill: 'Please fill this in',
  sessionEnded: 'Session ended — you can close this page.',
  submitted: 'Submitted. Waiting for the next interaction…',
  waiting: 'Waiting for an interaction…',
  ack: 'Got it',
  confirm: 'Confirm',
  cancel: 'Cancel',
  ok: 'OK',
  submit: 'Submit',
  pickOne: 'Pick an option first',
  fillRequired: 'Fill in the fields marked *',
  pressEnter: '\nPress Enter to continue… ',
  confirmPrompt: '  Confirm? [y/N] ',
  selectMultiple: '  Select (comma-separated, empty to cancel): ',
  selectOne: '  Select a number (empty to cancel): ',
  itemNumber: '    Number: ',
  imagePlaceholder: '[image{alt}] {src}',
  noDiff: '(no differences)',
  noBuildForPlatform:
    'No native shell build for {platform}-{arch}; using the browser channel',
  webView2Missing:
    'Edge WebView2 Runtime not found — the native shell would open a blank window, ' +
    'so the browser channel is used instead (install WebView2, or point {env} at a ' +
    'shell with a bundled runtime)',
  shellNotFound: 'No native shell found (point {env} at one); using the browser channel',
  launchFailed: '[native] failed to launch: {message}',
  nativeUnavailable: 'Native shell unavailable',
}

const zh: Messages = {
  lang: 'zh',
  needConfirm: '需要你确认',
  needSelect: '需要你选择',
  needFill: '需要你填写',
  sessionEnded: '会话已结束，可以关闭此页面。',
  submitted: '已提交，等待下一次交互…',
  waiting: '等待交互…',
  ack: '知道了',
  confirm: '确认',
  cancel: '取消',
  ok: '确定',
  submit: '提交',
  pickOne: '请先选择一项',
  fillRequired: '请填写标了 * 的必填项',
  pressEnter: '\n按回车继续… ',
  confirmPrompt: '  确认? [y/N] ',
  selectMultiple: '  选择（逗号分隔，留空取消）: ',
  selectOne: '  选择编号（留空取消）: ',
  itemNumber: '    编号: ',
  imagePlaceholder: '[图片{alt}] {src}',
  noDiff: '(无差异)',
  noBuildForPlatform: '原生壳没有 {platform}-{arch} 的构建，将使用浏览器通道',
  webView2Missing:
    '未检测到 Edge WebView2 Runtime，原生壳会白屏，改用浏览器通道' +
    '（装上 WebView2 或用 {env} 指定自带运行时的壳）',
  shellNotFound: '没找到原生壳（用 {env} 指定其位置），将使用浏览器通道',
  launchFailed: '[native] 启动失败：{message}',
  nativeUnavailable: '原生壳不可用',
}

/** 内置语言。缺项由英文兜底，所以新增 key 不会让某个语言直接空掉 */
export const MESSAGES: Record<Locale, Messages> = { en, zh }

/** 传给各通道的 locale 选项：内置语言名，或一份部分覆盖 */
export type LocaleOption = Locale | Partial<Messages>

/** 环境变量：`HARNESS_GUI_LOCALE=zh` */
export const LOCALE_ENV = 'HARNESS_GUI_LOCALE'

let override: Messages | undefined

/**
 * 设定全局默认语言。
 *
 * 给「整个进程就一种语言」的常见情况用；单次调用仍可用 channel 的 locale 选项覆盖。
 * 传 undefined 复位到「读环境变量，否则英文」。
 */
export function setLocale(l: LocaleOption | undefined): void {
  override = l === undefined ? undefined : merge(l)
}

/**
 * 解析出实际要用的文案。优先级：显式参数 → setLocale → 环境变量 → 英文。
 *
 * 每次都读环境变量而不是缓存：省掉「什么时候初始化」这个问题，
 * 代价只是一次 process.env 查表。
 */
export function resolveMessages(l?: LocaleOption): Messages {
  if (l !== undefined) return merge(l)
  if (override) return override
  const env = (process.env[LOCALE_ENV] ?? '').toLowerCase()
  return env in MESSAGES ? MESSAGES[env as Locale] : en
}

function merge(l: LocaleOption): Messages {
  if (typeof l === 'string') return MESSAGES[l] ?? en
  // 部分覆盖以英文为底 —— 没覆盖到的 key 有确定的兜底，不会渲染出 undefined
  return { ...en, ...l }
}

/** 把 `{name}` 换成 vars 里的值。缺失的占位符原样留下，便于一眼看出是哪个 key 没给 */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, k: string) =>
    k in vars ? String(vars[k]) : whole,
  )
}
