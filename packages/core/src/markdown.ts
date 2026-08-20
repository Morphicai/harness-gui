/**
 * markdown → 富内容（T2 HTML + 强制 T1 降级）
 *
 * 放在协议层而不是某个业务包里：任何拿得到 markdown 的调用方都该能把它摆到人眼前，
 * 这件事和「它是一篇 memo 还是一份报告」无关。
 *
 * 零依赖是硬约束，所以解析器是自己写的一个够用子集。取舍原则：
 * **认不出来的东西降级成看得见的原文，绝不吞掉。** 一个渲染不出来的公式显示成
 * 代码块，人还能读；显示成空白就等于内容丢了，而调用方毫不知情。
 */

import { Content, T1Content } from './types.js'

export interface RichMarkdownOptions {
  /**
   * 把图片地址换成可内联的 data URI；返回 undefined 表示取不到。
   *
   * 之所以做成回调而不是内置下载：取图往往需要业务侧的鉴权（memo 的图在带权限的
   * 对象存储上），而协议层不该知道任何鉴权的事。同时这也守住了「页面零外部资源」——
   * 解析不了的图会退化成一行说明，而不是去外域拉一张图。
   */
  resolveImage?: (src: string) => Promise<string | undefined>
  /**
   * 接管某种语言的围栏代码块 —— 流程图、公式这类「要跑起来才看得见」的内容。
   *
   * 返回 undefined 表示不接管，退回代码块（默认行为不变，认不出来的东西依旧显示原文）。
   *
   * 做成回调而不是内置 mermaid：这一层零依赖是硬约束，而一个图表运行时动辄上兆。
   * 谁需要谁把运行时递进来，代价落在用得上的人身上。
   */
  renderBlock?: (lang: string, code: string) => BlockRender | undefined
  /** HTML 体积上限，超出即截断并注明。默认 512KB */
  maxBytes?: number
  /** 降级文本的长度上限，默认 4000 字符 */
  fallbackChars?: number
}

/** renderBlock 的产物 */
export interface BlockRender {
  /** 放在原代码块位置的 HTML */
  html: string
  /**
   * 整篇文档只注入一次的运行时，按 key 去重 —— 一篇文档里十张流程图
   * 不该把同一个 mermaid 打包进去十遍。
   *
   * 注意：注入脚本会让文档的 CSP 放开 script-src。这段 HTML 最终进的是
   * `sandbox="allow-scripts"`（无 allow-same-origin）的 iframe，属于不透明源，
   * 既够不着宿主页面和它的 token，也出不了网（default-src 'none' 仍然生效）。
   */
  runtime?: { key: string; script?: string; css?: string }
}

const DEFAULT_MAX_BYTES = 512 * 1024
const DEFAULT_FALLBACK_CHARS = 4000

/**
 * 把 markdown 变成可直接交给 `ui.show()` 的内容。
 *
 * 结果是 T2（HTML）+ 强制 fallback。fallback 不是可选项：没有它，同一次展示在
 * 网页上是排版好的文档、在终端上就是一片空白，而调用方根本不知道自己丢了东西。
 */
export async function markdownToContent(md: string, opts: RichMarkdownOptions = {}): Promise<Content> {
  const source = await inlineImages(md, opts.resolveImage)
  const ctx: Ctx = { renderBlock: opts.renderBlock, runtimes: new Map() }
  let html = renderHtml(source, ctx)

  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES
  if (Buffer.byteLength(html, 'utf8') > max) {
    html = truncateHtml(html, max)
  }

  return {
    type: 'html',
    html: wrapDocument(html, ctx.runtimes),
    fallback: toFallback(md, opts.fallbackChars ?? DEFAULT_FALLBACK_CHARS),
  }
}

/** 纯文本降级：截断后的原始 markdown。看得见原文永远好过看不见内容 */
function toFallback(md: string, limit: number): T1Content {
  const text = md.length > limit ? md.slice(0, limit) + '\n\n…（内容过长，已截断）' : md
  return { type: 'markdown', text }
}

// ==================== 图片 ====================

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

async function inlineImages(md: string, resolve?: RichMarkdownOptions['resolveImage']): Promise<string> {
  if (!resolve) return md
  const srcs = new Set<string>()
  for (const m of md.matchAll(IMAGE_RE)) {
    if (!m[2].startsWith('data:')) srcs.add(m[2])
  }
  if (srcs.size === 0) return md

  const map = new Map<string, string>()
  await Promise.all(
    [...srcs].map(async src => {
      try {
        const data = await resolve(src)
        if (data) map.set(src, data)
      } catch {
        /* 取不到就保持原样，下面会退化成说明文字 —— 一张图取不到不该让整篇打不开 */
      }
    }),
  )
  return md.replace(IMAGE_RE, (whole, alt, src) => (map.has(src) ? `![${alt}](${map.get(src)})` : whole))
}

// ==================== 块级 ====================

/** 渲染过程中要带着走的东西：块渲染器，以及它登记的文档级运行时 */
interface Ctx {
  renderBlock?: (lang: string, code: string) => BlockRender | undefined
  runtimes: Map<string, { script?: string; css?: string }>
}

function renderHtml(md: string, ctx: Ctx): string {
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块。先问 renderBlock 要不要接管（流程图之类），
    // 没人接管就显示成带语言标记的代码块 —— 人还能读懂，比渲染失败留白强
    const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/)
    if (fence) {
      const [, , mark, lang] = fence
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(mark[0].repeat(mark.length))) body.push(lines[i++])
      i++
      const code = body.join('\n')

      const taken = lang && ctx.renderBlock ? tryRenderBlock(ctx, lang, code) : undefined
      if (taken) {
        out.push(taken)
        continue
      }

      const label = lang ? `<div class="lang">${esc(lang)}</div>` : ''
      out.push(`<pre>${label}<code>${esc(code)}</code></pre>`)
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>')
      i++
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = Math.min(6, heading[1].length)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }

    // 表格：表头 + 分隔行才算，否则当普通段落
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(line)
      const align = splitRow(lines[i + 1]).map(alignOf)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]))
      out.push(renderTable(header, align, rows))
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${renderHtml(body.join('\n'), ctx)}</blockquote>`)
      continue
    }

    if (isListItem(line)) {
      const [list, next] = renderList(lines, i)
      out.push(list)
      i = next
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    /*
     * 段落：连续非空行合并。
     *
     * 第一行**无条件**吃掉，这一句是防死循环的关键：走到这里的行有可能仍然满足
     * isBlockStart（比如一行 `| 看着像表格 |` 但下一行不是分隔行，上面的表格分支
     * 没接住它），若循环条件对第一行也生效，就会一行都不消费、i 永不前进。
     */
    const para: string[] = [lines[i++]]
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) para.push(lines[i++])
    out.push(`<p>${inline(para.join('\n'))}</p>`)
  }

  return out.join('\n')
}

/**
 * 问块渲染器要不要接管。
 *
 * 渲染器抛异常时**当作没接管**：一张画不出来的图不该让整篇文档打不开，
 * 退回代码块至少原文还在。这和 resolveImage 抛错时的处理是同一条原则。
 */
function tryRenderBlock(ctx: Ctx, lang: string, code: string): string | undefined {
  let r: BlockRender | undefined
  try {
    r = ctx.renderBlock!(lang, code)
  } catch {
    return undefined
  }
  if (!r) return undefined
  if (r.runtime && !ctx.runtimes.has(r.runtime.key)) {
    ctx.runtimes.set(r.runtime.key, { script: r.runtime.script, css: r.runtime.css })
  }
  return r.html
}

function isBlockStart(l: string): boolean {
  return (
    /^(\s*)(`{3,}|~{3,})/.test(l) ||
    /^#{1,6}\s/.test(l) ||
    /^\s*>\s?/.test(l) ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) ||
    isListItem(l) ||
    isTableRow(l)
  )
}

// ==================== 列表（支持嵌套与任务项）====================

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

function isListItem(l: string): boolean {
  return LIST_RE.test(l)
}

function renderList(lines: string[], start: number): [string, number] {
  const first = lines[start].match(LIST_RE)!
  const baseIndent = first[1].length
  const ordered = /\d/.test(first[2])
  const items: string[] = []
  let i = start

  while (i < lines.length) {
    const m = lines[i].match(LIST_RE)
    if (!m || m[1].length < baseIndent) break
    if (m[1].length > baseIndent) {
      // 更深的缩进属于上一项的子列表
      const [sub, next] = renderList(lines, i)
      if (items.length) items[items.length - 1] += sub
      else items.push(sub)
      i = next
      continue
    }
    let body = m[3]
    // 任务项：渲染成禁用的复选框，保留"已完成/未完成"这个信息
    const task = body.match(/^\[([ xX])\]\s+(.*)$/)
    const prefix = task ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ` : ''
    if (task) body = task[2]
    items.push(`<li>${prefix}${inline(body)}`)
    i++
  }

  const tag = ordered ? 'ol' : 'ul'
  return [`<${tag}>${items.map(s => s + '</li>').join('')}</${tag}>`, i]
}

// ==================== 表格 ====================

function isTableRow(l: string): boolean {
  return /^\s*\|.*\|\s*$/.test(l)
}
function isTableDivider(l: string): boolean {
  return /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l)
}
function splitRow(l: string): string[] {
  return l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(s => s.trim())
}
function alignOf(sep: string): string {
  const left = sep.startsWith(':')
  const right = sep.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}
function renderTable(header: string[], align: string[], rows: string[][]): string {
  const th = header.map((h, i) => `<th style="text-align:${align[i] ?? 'left'}">${inline(h)}</th>`).join('')
  const body = rows
    .map(r => `<tr>${r.map((c, i) => `<td style="text-align:${align[i] ?? 'left'}">${inline(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`
}

// ==================== 行内 ====================

/**
 * 行内解析。
 *
 * 先把行内码切出来单独处理 —— 否则 `**` 这类标记会在代码片段里被当成格式，
 * 而代码里出现星号是家常便饭。
 */
function inline(src: string): string {
  const codes: string[] = []
  let s = src.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c)
    return ` ${codes.length - 1} `
  })

  s = esc(s)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) =>
    isSafeImage(url) ? `<img src="${escAttr(url)}" alt="${escAttr(alt)}">` : `<span class="noimg">[图片：${esc(alt || url)}]</span>`,
  )
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) =>
    isSafeLink(url) ? `<a href="${escAttr(url)}" target="_blank" rel="noreferrer noopener">${text}</a>` : text,
  )
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return s.replace(/ (\d+) /g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`)
}

/**
 * 只允许 data: 图片与 http(s)。
 *
 * http(s) 的图会被下面的 wrapDocument 的 CSP 挡掉（页面零外部资源是硬约束），
 * 但仍然放行 —— 让浏览器显示一个坏图标，比在源码里静默抹掉一张图更诚实。
 */
function isSafeImage(url: string): boolean {
  return /^(data:image\/|https?:)/i.test(url)
}
function isSafeLink(url: string): boolean {
  return /^(https?:|mailto:|#|\/)/i.test(url)
}

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;')
}

// ==================== 文档外壳 ====================

/**
 * 套一层样式。
 *
 * CSP 写死 `img-src data:`：这段 HTML 最终进的是页面里的 sandbox iframe，
 * 而「页面不引外部资源」是这一层的硬约束 —— 不能因为内容是别人给的就破例。
 * 图片要显示就得在 resolveImage 阶段内联成 data URI。
 */
function wrapDocument(body: string, runtimes: Map<string, { script?: string; css?: string }> = new Map()): string {
  const scripts = [...runtimes.values()].filter(r => r.script)
  const extraCss = [...runtimes.values()]
    .map(r => r.css)
    .filter(Boolean)
    .join('\n')

  /*
   * 只有真注入了脚本才放开 script-src —— 绝大多数文档不需要脚本，
   * 那些文档的 CSP 保持原样（一条都不放）。
   */
  const csp = [
    "default-src 'none'",
    'img-src data:',
    "style-src 'unsafe-inline'",
    ...(scripts.length ? ["script-src 'unsafe-inline'"] : []),
  ].join('; ')

  return `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
${scripts.map(r => `<script>${sealScript(r.script as string)}</script>`).join('\n')}
${extraCss ? `<style>${extraCss}</style>` : ''}
<style>
:root{--fg:#1a1a1a;--muted:#6b7280;--line:#e5e7eb;--card:#f7f7f8;--accent:#1456f0}
@media(prefers-color-scheme:dark){:root{--fg:#e8eaed;--muted:#9aa0a6;--line:#2c2f36;--card:#22252b;--accent:#6f9bff}}
body{margin:0;padding:4px 2px;color:var(--fg);font:14px/1.7 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
     word-wrap:break-word;overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.2em 0 .5em}
h1{font-size:1.5em}h2{font-size:1.28em}h3{font-size:1.12em}h4,h5,h6{font-size:1em}
p{margin:.6em 0}
a{color:var(--accent)}
hr{border:0;border-top:1px solid var(--line);margin:1.4em 0}
blockquote{margin:.8em 0;padding:.2em 0 .2em 12px;border-left:3px solid var(--line);color:var(--muted)}
ul,ol{margin:.6em 0;padding-left:1.5em}
li{margin:.25em 0}
li input{margin-right:.3em}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;
     background:var(--card);padding:.12em .35em;border-radius:4px}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;position:relative}
pre code{background:none;padding:0;font-size:.86em;line-height:1.55}
pre .lang{position:absolute;top:6px;right:10px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
table{border-collapse:collapse;margin:.8em 0;font-size:.94em;display:block;overflow-x:auto;max-width:100%}
th,td{border:1px solid var(--line);padding:6px 10px}
th{background:var(--card);font-weight:600}
img{max-width:100%;border-radius:6px;margin:.4em 0}
.noimg{color:var(--muted);font-size:.9em}
.cut{margin-top:1.2em;padding:8px 12px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);font-size:.9em}
</style>
${body}`
}

/**
 * 让一段 JS 能安全地待在 `<script>` 里。
 *
 * 打包产物里出现 `</script`（字符串、正则、注释里都可能）会当场关掉标签，
 * 后面的代码就变成页面正文了。`<\/script` 在 JS 里语义完全等价。
 */
function sealScript(src: string): string {
  return src.replace(/<\/(script)/gi, '<\\/$1')
}

/** 超长时在块边界截断 —— 从标签中间切开会产出坏 HTML */
function truncateHtml(html: string, maxBytes: number): string {
  let cut = html.slice(0, maxBytes)
  const lastClose = cut.lastIndexOf('</')
  const boundary = cut.indexOf('>', lastClose)
  if (boundary > 0) cut = cut.slice(0, boundary + 1)
  return cut + '<div class="cut">内容过长，此处已截断。完整内容请在 Tanka 中打开。</div>'
}
