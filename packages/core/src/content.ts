/**
 * Content 校验与文本渲染
 *
 * 文本渲染同时服务两个地方：终端 channel 的正常输出，以及 T2 内容在非浏览器 channel 上的降级。
 * 两者是同一件事 —— 「把内容变成不依赖图形能力的可读形式」。
 */

import { resolveMessages, fmt, type LocaleOption } from './i18n.js'
import { Content, T1Content, isT2 } from './types.js'

/**
 * 校验内容合法性；T2 缺 fallback 直接抛错。
 *
 * 在构造期抛错是刻意的：这类错误如果放到运行期，表现是「某些 channel 上什么都不显示」，
 * 而调用方毫无感知 —— 属于最难排查的一类问题。
 */
export function validateContent(c: Content): void {
  if (!c || typeof c !== 'object' || typeof (c as { type?: unknown }).type !== 'string') {
    throw new Error('[harness-gui] content must be an object with a `type` field')
  }
  if (isT2(c)) {
    if (!c.fallback) {
      throw new Error(
        `[harness-gui] T2 content (type="${c.type}") is missing the required \`fallback\`. ` +
          `Without it this content vanishes entirely on non-browser channels such as the ` +
          `terminal. Provide a T1 fallback.`
      )
    }
    if (isT2(c.fallback as Content)) {
      throw new Error('[harness-gui] fallback must be T1 content, not another T2')
    }
    validateContent(c.fallback)
  }
}

/** 取用于非浏览器通道渲染的 T1 内容：T2 取其 fallback，T1 取自身 */
export function toT1(c: Content): T1Content {
  return isT2(c) ? c.fallback : c
}

// ==================== 文本渲染 ====================

export function renderText(c: Content, locale?: LocaleOption): string {
  const t1 = toT1(c)
  switch (t1.type) {
    case 'markdown':
      return t1.text
    case 'table':
      return renderTable(t1.columns, t1.rows)
    case 'chart':
      return renderChart(t1.labels, t1.values, t1.unit)
    case 'diff':
      return renderDiff(t1.before, t1.after, t1.filename, locale)
    case 'image':
      return fmt(resolveMessages(locale).imagePlaceholder, {
        alt: t1.alt ? ': ' + t1.alt : '',
        src: t1.src,
      })
  }
}

function cell(v: string | number | null): string {
  return v === null || v === undefined ? '' : String(v)
}

/** 等宽文本表。按显示宽度对齐——CJK 占两列，用 ASCII 宽度算会错位 */
function renderTable(columns: string[], rows: (string | number | null)[][]): string {
  const all = [columns, ...rows.map(r => r.map(cell))]
  const widths = columns.map((_, i) => Math.max(...all.map(r => displayWidth(cell(r[i])))))
  const line = (cells: (string | number | null)[]) =>
    '| ' + cells.map((v, i) => pad(cell(v), widths[i])).join(' | ') + ' |'
  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|'
  return [line(columns), sep, ...rows.map(line)].join('\n')
}

/** CJK / 全角字符占两列 */
function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    w += code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x20000 && code <= 0x3fffd)) ? 2 : 1
  }
  return w
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)))
}

/** 终端里的条形图：标签 + 比例条 + 数值。信息不丢，只是不好看 */
function renderChart(labels: string[], values: number[], unit?: string): string {
  const max = Math.max(...values.map(v => Math.abs(v)), 1)
  const labelWidth = Math.max(...labels.map(displayWidth))
  return labels
    .map((label, i) => {
      const v = values[i] ?? 0
      const bars = '█'.repeat(Math.max(0, Math.round((Math.abs(v) / max) * 24)))
      return `${pad(label, labelWidth)}  ${bars} ${v}${unit ?? ''}`
    })
    .join('\n')
}

/**
 * 极简行级 diff：只标出「前面独有」和「后面独有」的行，不做最长公共子序列。
 * 通道要的是「看得出改了什么」，不是精确的 patch。
 */
function renderDiff(before: string, after: string, filename?: string, locale?: LocaleOption): string {
  const a = before.split('\n')
  const b = after.split('\n')
  const bSet = new Set(b)
  const aSet = new Set(a)
  const out: string[] = []
  if (filename) out.push(`--- ${filename}`)
  for (const line of a) if (!bSet.has(line)) out.push(`- ${line}`)
  for (const line of b) if (!aSet.has(line)) out.push(`+ ${line}`)
  if (out.length === (filename ? 1 : 0)) out.push(resolveMessages(locale).noDiff)
  return out.join('\n')
}
