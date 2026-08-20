import { describe, it, expect } from 'vitest'
import { validateContent, renderText } from '../src/content.js'
import { isOneWay, type Content, type Interaction } from '../src/types.js'
import { Interact } from '../src/registry.js'
import { ScriptedChannel, answer } from '../src/channels/scripted.js'

describe('Content 校验', () => {
  it('T2 缺 fallback 抛错，且错误信息指明缺失字段', () => {
    expect(() => validateContent({ type: 'html', html: '<b>x</b>' } as unknown as Content))
      .toThrowError(/fallback/)
  })

  it('fallback 不能又是 T2', () => {
    expect(() =>
      validateContent({
        type: 'html',
        html: '<b>x</b>',
        fallback: { type: 'url', url: 'http://x', fallback: { type: 'markdown', text: 'y' } },
      } as unknown as Content)
    ).toThrowError(/must be T1/)
  })

  it('带 fallback 的 T2 合法', () => {
    expect(() =>
      validateContent({ type: 'html', html: '<b>x</b>', fallback: { type: 'markdown', text: 'x' } })
    ).not.toThrow()
  })

  it('present 时校验 content —— 缺 fallback 在派发阶段就炸', async () => {
    const ui = new Interact().register(new ScriptedChannel([answer.accept()]))
    await expect(
      ui.present({ kind: 'show', title: 't', content: { type: 'html', html: 'x' } as unknown as Content })
    ).rejects.toThrowError(/fallback/)
  })
})

describe('单向交互', () => {
  it('notify 与无 awaitAck 的 show 是单向', () => {
    expect(isOneWay({ kind: 'notify', title: 't', message: 'm' })).toBe(true)
    expect(isOneWay({ kind: 'show', title: 't', content: { type: 'markdown', text: 'x' } })).toBe(true)
    expect(isOneWay({ kind: 'show', title: 't', content: { type: 'markdown', text: 'x' }, awaitAck: true })).toBe(false)
    expect(isOneWay({ kind: 'confirm', title: 't', message: 'm' })).toBe(false)
  })
})

describe('T1 文本渲染：不许空白', () => {
  const cases: Array<[string, Content, string[]]> = [
    ['markdown', { type: 'markdown', text: '# 标题\n正文' }, ['标题', '正文']],
    ['table', { type: 'table', columns: ['名称', '值'], rows: [['配额', 100], ['已用', 42]] }, ['名称', '配额', '100', '42']],
    ['chart', { type: 'chart', chart: 'bar', labels: ['一月', '二月'], values: [3, 9], unit: 'GB' }, ['一月', '二月', '9GB']],
    ['diff', { type: 'diff', before: 'a\nb', after: 'a\nc', filename: 'x.ts' }, ['x.ts', '- b', '+ c']],
    ['image', { type: 'image', src: '/tmp/a.png', alt: '截图' }, ['截图', '/tmp/a.png']],
  ]

  for (const [name, content, expected] of cases) {
    it(`${name} 渲染出关键数据`, () => {
      const out = renderText(content)
      expect(out.trim()).not.toBe('')
      for (const e of expected) expect(out).toContain(e)
    })
  }

  it('T2 渲染其 fallback，不空白也不报错', () => {
    const out = renderText({
      type: 'html',
      html: '<canvas id="chart"></canvas>',
      fallback: { type: 'table', columns: ['k'], rows: [['v']] },
    })
    expect(out).toContain('k')
    expect(out).toContain('v')
    expect(out).not.toContain('canvas')
  })

  it('表格按显示宽度对齐（CJK 占两列，不能用 String.length 判断）', () => {
    const out = renderText({ type: 'table', columns: ['名', 'x'], rows: [['ab', 'y']] })
    const [head, sep, row] = out.split('\n')
    // 分隔行全是 ASCII，它的字符数就是这张表的目标显示宽度
    expect(width(head)).toBe(sep.length)
    expect(width(row)).toBe(sep.length)
  })

  /** 与 content.ts 同口径的显示宽度：CJK / 全角占两列 */
  function width(s: string): number {
    let w = 0
    for (const ch of s) {
      const c = ch.codePointAt(0) ?? 0
      w += c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd)) ? 2 : 1
    }
    return w
  }
})

describe('channel 选择策略', () => {
  const ping: Interaction = { kind: 'confirm', title: 't', message: 'm' }

  it('按优先级自动选中', async () => {
    const lo = new ScriptedChannel([answer.accept('lo')])
    const hi = new ScriptedChannel([answer.accept('hi')])
    Object.defineProperty(lo, 'name', { value: 'lo' })
    Object.defineProperty(hi, 'name', { value: 'hi' })
    const ui = new Interact().register(lo, 90).register(hi, 10)
    const r = await ui.present(ping)
    expect(r.value).toBe('hi')
    expect(r.channel).toBe('hi')
  })

  it('显式指定优先于自动选择', async () => {
    const lo = new ScriptedChannel([answer.accept('lo')])
    const hi = new ScriptedChannel([answer.accept('hi')])
    Object.defineProperty(lo, 'name', { value: 'lo' })
    Object.defineProperty(hi, 'name', { value: 'hi' })
    const ui = new Interact().register(lo, 90).register(hi, 10)
    const r = await ui.present(ping, { channel: 'lo' })
    expect(r.value).toBe('lo')
  })

  it('supports 为假的被跳过', async () => {
    const no = new ScriptedChannel([answer.accept('no')])
    Object.defineProperty(no, 'name', { value: 'no' })
    no.supports = () => false
    const yes = new ScriptedChannel([answer.accept('yes')])
    Object.defineProperty(yes, 'name', { value: 'yes' })
    const ui = new Interact().register(no, 10).register(yes, 20)
    expect((await ui.present(ping)).value).toBe('yes')
  })

  it('无可用 channel 返回 unsupported 而不是抛错', async () => {
    const ui = new Interact()
    const r = await ui.present(ping)
    expect(r.action).toBe('unsupported')
  })
})
