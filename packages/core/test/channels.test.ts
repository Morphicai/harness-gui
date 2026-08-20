import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import { ScriptedChannel, answer } from '../src/channels/scripted.js'
import { TtyChannel } from '../src/channels/tty.js'
import { Interact } from '../src/registry.js'

describe('scripted channel', () => {
  it('按序返回预置答案', async () => {
    const ch = new ScriptedChannel([answer.accept('A'), answer.cancel()])
    const a = await ch.present({ kind: 'confirm', title: '1', message: 'm' })
    const b = await ch.present({ kind: 'confirm', title: '2', message: 'm' })
    expect(a).toMatchObject({ action: 'accept', value: 'A' })
    expect(b.action).toBe('cancel')
  })

  it('预置答案耗尽时抛错，并指明是第几次交互', async () => {
    const ch = new ScriptedChannel([answer.accept()])
    await ch.present({ kind: 'confirm', title: '1', message: 'm' })
    await expect(ch.present({ kind: 'confirm', title: '2', message: 'm' }))
      .rejects.toThrowError(/interaction #2/)
  })

  it('单向交互只记录、不消费预置答案', async () => {
    const ch = new ScriptedChannel([answer.accept('给 confirm 的')])
    await ch.present({ kind: 'notify', title: 'n', message: 'm' })
    await ch.present({ kind: 'show', title: 's', content: { type: 'markdown', text: 'x' } })
    expect(ch.remaining()).toBe(1)
    const r = await ch.present({ kind: 'confirm', title: 'c', message: 'm' })
    expect(r.value).toBe('给 confirm 的')
  })

  it('transcript 可断言问了什么、问了几次', async () => {
    const ch = new ScriptedChannel([answer.accept()])
    await ch.present({ kind: 'notify', title: '通知', message: 'm' })
    await ch.present({ kind: 'confirm', title: '确认删除', message: 'm' })
    const log = ch.transcript()
    expect(log.map(e => e.kind)).toEqual(['notify', 'confirm'])
    expect(log.map(e => e.title)).toEqual(['通知', '确认删除'])
    expect(log[1].answered?.action).toBe('accept')
  })

  it('接住依赖人工输入的流程 —— 验证码可无人值守跑通', async () => {
    const ch = new ScriptedChannel([answer.accept({ code: '123456' })])
    const ui = new Interact().register(ch)
    const r = await ui.form({
      title: '需要验证码',
      fields: [{ name: 'code', label: '邮箱验证码', type: 'text', required: true }],
    })
    expect(r.action).toBe('accept')
    expect((r.value as { code: string }).code).toBe('123456')
  })
})

describe('tty channel', () => {
  it('无 TTY 时 supports() 为假，自动选择会跳过它', () => {
    const input = new PassThrough() as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
    const ch = new TtyChannel({ input, output: new PassThrough() })
    expect(ch.supports()).toBe(false)
  })

  it('forceTty 时 supports() 为真', () => {
    const input = new PassThrough() as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
    const ch = new TtyChannel({ input, output: new PassThrough(), forceTty: true })
    expect(ch.supports()).toBe(true)
  })

  it('notify 直接输出到终端并返回 accept', async () => {
    const out = new PassThrough()
    let buf = ''
    out.on('data', c => (buf += c))
    const ch = new TtyChannel({ output: out, forceTty: true })
    const r = await ch.present({ kind: 'notify', title: '标题', message: '正文', level: 'warn' })
    expect(r.action).toBe('accept')
    expect(buf).toContain('标题')
    expect(buf).toContain('正文')
  })

  it('show 把 T1 内容渲染进终端', async () => {
    const out = new PassThrough()
    let buf = ''
    out.on('data', c => (buf += c))
    const ch = new TtyChannel({ output: out, forceTty: true })
    await ch.present({
      kind: 'show',
      title: '用量',
      content: { type: 'table', columns: ['名称', '值'], rows: [['配额', 100]] },
    })
    expect(buf).toContain('配额')
    expect(buf).toContain('100')
  })

  it('select 读到编号后返回对应 value', async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
    const out = new PassThrough()
    const ch = new TtyChannel({ input, output: out, forceTty: true })
    const p = ch.present({
      kind: 'select',
      title: '选组织',
      options: [
        { label: 'Alpha', value: 'a' },
        { label: 'Beta', value: 'b' },
      ],
    })
    setTimeout(() => (input as unknown as PassThrough).write('2\n'), 10)
    expect(await p).toMatchObject({ action: 'accept', value: 'b' })
  })

  it('select 留空 = 主动取消，不是超时', async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
    const ch = new TtyChannel({ input, output: new PassThrough(), forceTty: true })
    const p = ch.present({ kind: 'select', title: 't', options: [{ label: 'A', value: 'a' }] })
    setTimeout(() => (input as unknown as PassThrough).write('\n'), 10)
    expect((await p).action).toBe('cancel')
  })

  it('超时返回 timeout，且与 cancel 区分', async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
    const ch = new TtyChannel({ input, output: new PassThrough(), forceTty: true })
    const r = await ch.present({ kind: 'confirm', title: 't', message: 'm', timeoutMs: 60 })
    expect(r.action).toBe('timeout')
  })
})
