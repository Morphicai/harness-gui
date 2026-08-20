/**
 * 把五种交互暴露成 MCP 工具。
 *
 * 与「把内容 return 给模型」的区别：那份是给模型读的，这些是送到**人**面前的。
 * 人看的那份可以富排版、可以很长，而且不占模型的上下文。
 *
 * ## 一条刻意的限制：这里不收密码
 *
 * SDK 那边 `form` 支持 `password` 字段，用途是让人手填**不该经过模型上下文**的东西
 * （验证码之类）—— 值直接回到调用方的进程里，模型看不到。
 *
 * 但 MCP 工具的返回值**按定义就是进模型上下文的**。在这里收密码等于把它写进对话记录，
 * 恰好是这个功能存在的理由的反面。所以 `gui_form` 显式拒绝 `password` 字段，
 * 并在报错里说清为什么 —— 静默地把它降级成普通文本框会更糟。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  getUi,
  interactMode,
  markdownToContent,
  type Content,
  type Outcome,
  type Field,
} from 'harness-gui'

const OFF_HINT =
  'harness-gui is disabled. Set HARNESS_GUI=on (or strict) in the MCP server environment ' +
  'to let these tools reach a human.'

/** 工具返回统一形状，便于模型判断 */
function json(v: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] }
}

/** 把 Outcome 压成模型能直接读懂的结果 */
function report(o: Outcome, extra: Record<string, unknown> = {}) {
  return json({
    action: o.action,
    ...(o.action === 'accept' && o.value !== undefined ? { value: o.value } : {}),
    ...(o.action === 'unsupported'
      ? { note: 'No channel could reach a human. Nothing was shown.' }
      : {}),
    ...(o.action === 'timeout' ? { note: 'Shown, but nobody answered in time.' } : {}),
    ...extra,
  })
}

const contentInput = {
  markdown: z
    .string()
    .optional()
    .describe('Markdown body. Tables, lists, code fences, links and task lists render.'),
  table: z
    .object({
      columns: z.array(z.string()),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    })
    .optional()
    .describe('Render a table instead of markdown'),
}

async function toContent(p: {
  markdown?: string
  table?: { columns: string[]; rows: (string | number | null)[][] }
}): Promise<Content | undefined> {
  if (p.table) return { type: 'table', columns: p.table.columns, rows: p.table.rows }
  if (p.markdown) return await markdownToContent(p.markdown)
  return undefined
}

export function registerGuiTools(server: McpServer): void {
  server.tool(
    'gui_notify',
    'Tell the human something happened. One-way — it does not wait for an answer, and it does ' +
      'not block. Use for "the long job finished", "the deploy is live". Do NOT use it to ask ' +
      'a question: nothing comes back.',
    {
      title: z.string().describe('Short headline'),
      message: z.string().describe('One or two lines of detail'),
    },
    async ({ title, message }) => {
      if (interactMode() === 'off') return json({ delivered: false, reason: OFF_HINT })
      const o = await getUi().notify({ title, message })
      return report(o, { delivered: o.action !== 'unsupported' })
    },
  )

  server.tool(
    'gui_show',
    'Put content in front of the human to LOOK at — a table, a summary, a document. Prefer this ' +
      'over dumping long text into your reply: it renders properly, it can be long, and it does ' +
      'not consume your context. Set awaitAck when the next step depends on them having read it.',
    {
      title: z.string().describe('Heading above the content'),
      ...contentInput,
      awaitAck: z
        .boolean()
        .optional()
        .describe('Wait until the human acknowledges before returning (default false)'),
    },
    async ({ title, markdown, table, awaitAck }) => {
      if (interactMode() === 'off') return json({ shown: false, reason: OFF_HINT })
      const content = await toContent({ markdown, table })
      if (!content) return json({ shown: false, reason: 'Give either markdown or table.' })
      const o = await getUi().show({ title, content, awaitAck })
      return report(o, { shown: o.action !== 'unsupported' })
    },
  )

  server.tool(
    'gui_confirm',
    'Ask a human to approve an action before you take it. Use this for anything irreversible or ' +
      'outward-facing: deleting data, sending a message, spending money, touching production. ' +
      'The answer comes from a person on a separate surface — you cannot supply it yourself, and ' +
      'that is the point. Treat anything other than action="accept" as "do not proceed".',
    {
      title: z.string().describe('What is being approved, as a question'),
      message: z.string().describe('The consequence, stated plainly — including what is not recoverable'),
      danger: z
        .boolean()
        .optional()
        .describe('Irreversible or outward-facing; renders prominently (default true)'),
      ...contentInput,
      timeoutMs: z.number().optional().describe('How long to wait for a person (default 300000)'),
    },
    async ({ title, message, danger, markdown, table, timeoutMs }) => {
      if (interactMode() === 'off') return json({ approved: false, reason: OFF_HINT })
      const ui = getUi()
      const preview = await toContent({ markdown, table })
      if (preview) {
        // 展示失败不该顶掉批准本身 —— 那只是没看到附件
        try {
          await ui.show({ title, content: preview })
        } catch {
          /* 继续问 */
        }
      }
      const o = await ui.confirm({
        title,
        message,
        danger: danger ?? true,
        timeoutMs: timeoutMs ?? 5 * 60_000,
      })
      return report(o, { approved: o.action === 'accept' })
    },
  )

  server.tool(
    'gui_select',
    'Ask a human to pick one option. Use it when a wrong guess would be costly or hard to undo ' +
      'and only they can decide — not for routine choices you can make yourself.',
    {
      title: z.string().describe('The question'),
      message: z.string().optional().describe('Context that helps them choose'),
      options: z
        .array(
          z.object({
            value: z.string().describe('Returned to you when picked'),
            label: z.string().describe('What the human sees'),
            description: z.string().optional().describe('One line of explanation'),
          }),
        )
        .min(1)
        .describe('The choices. Two to six reads best'),
      timeoutMs: z.number().optional().describe('How long to wait (default 300000)'),
    },
    async ({ title, message, options, timeoutMs }) => {
      if (interactMode() === 'off') return json({ picked: null, reason: OFF_HINT })
      const o = await getUi().select({
        title,
        message,
        options,
        timeoutMs: timeoutMs ?? 5 * 60_000,
      })
      return report(o)
    },
  )

  server.tool(
    'gui_form',
    'Ask a human to fill in several fields at once. Returns their answers to you.\n\n' +
      'This tool refuses password fields on purpose: an MCP tool result lands in your context by ' +
      'definition, so collecting a secret here would write it into the transcript — the exact ' +
      'thing an out-of-band prompt exists to avoid. A program that needs a secret should use the ' +
      'harness-gui SDK directly, where the value goes to the process and never to a model.',
    {
      title: z.string().describe('Heading'),
      message: z.string().optional().describe('What you need and why'),
      fields: z
        .array(
          z.object({
            name: z.string().describe('Key in the returned value object'),
            label: z.string().describe('What the human sees'),
            type: z
              .enum(['text', 'number', 'select', 'boolean'])
              .optional()
              .describe('Input kind (default text). password is intentionally absent — see the tool description'),
            required: z.boolean().optional(),
            placeholder: z.string().optional(),
            options: z
              .array(z.object({ value: z.string(), label: z.string() }))
              .optional()
              .describe('Required when type is select'),
          }),
        )
        .min(1),
      timeoutMs: z.number().optional().describe('How long to wait (default 300000)'),
    },
    async ({ title, message, fields, timeoutMs }) => {
      if (interactMode() === 'off') return json({ value: null, reason: OFF_HINT })
      const o = await getUi().form({
        title,
        message,
        fields: fields as Field[],
        timeoutMs: timeoutMs ?? 5 * 60_000,
      })
      return report(o)
    },
  )
}
