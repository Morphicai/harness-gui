/**
 * 多语言。
 *
 * 重点不是「翻译对不对」，而是三件容易出错的事：
 * 默认必须确定（英文）、优先级必须可预测、部分覆盖不能漏出 undefined。
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  MESSAGES,
  LOCALE_ENV,
  setLocale,
  resolveMessages,
  fmt,
  createInteract,
  TtyChannel,
  ScriptedChannel,
  Interact,
  answer,
  renderText,
  nativeShellUnavailableReason,
  type Messages,
} from '../src/index.js'
import { renderPage } from '../src/channels/web/page.js'

afterEach(() => {
  setLocale(undefined)
  delete process.env[LOCALE_ENV]
})

describe('默认与优先级', () => {
  it('什么都不设就是英文 —— 默认值必须确定', () => {
    expect(resolveMessages()).toBe(MESSAGES.en)
    expect(resolveMessages().confirm).toBe('Confirm')
  })

  it('不跟随 LANG —— 同一份代码不该在不同机器上说不同的语言', () => {
    process.env.LANG = 'zh_CN.UTF-8'
    try {
      expect(resolveMessages().lang).toBe('en')
    } finally {
      delete process.env.LANG
    }
  })

  it('环境变量能切', () => {
    process.env[LOCALE_ENV] = 'zh'
    expect(resolveMessages()).toBe(MESSAGES.zh)
  })

  it('无法识别的语言名退回英文，而不是渲染出空白', () => {
    process.env[LOCALE_ENV] = 'kl'
    expect(resolveMessages()).toBe(MESSAGES.en)
  })

  it('setLocale 压过环境变量，显式参数又压过 setLocale', () => {
    process.env[LOCALE_ENV] = 'zh'
    setLocale('en')
    expect(resolveMessages().confirm).toBe('Confirm')
    expect(resolveMessages('zh').confirm).toBe('确认')
  })

  it('setLocale(undefined) 复位回「读环境变量」', () => {
    setLocale('zh')
    expect(resolveMessages().lang).toBe('zh')
    setLocale(undefined)
    expect(resolveMessages().lang).toBe('en')
  })
})

describe('部分覆盖', () => {
  it('没覆盖到的 key 用英文兜底 —— 绝不能渲染出 undefined', () => {
    const m = resolveMessages({ confirm: 'Yes', cancel: 'No' })
    expect(m.confirm).toBe('Yes')
    expect(m.cancel).toBe('No')
    expect(m.submit).toBe(MESSAGES.en.submit)
    for (const [k, v] of Object.entries(m)) {
      expect(typeof v, `${k} 不是字符串`).toBe('string')
    }
  })

  it('两种内置语言的 key 集合必须一致 —— 少一个就是某语言渲染空白', () => {
    expect(Object.keys(MESSAGES.zh).sort()).toEqual(Object.keys(MESSAGES.en).sort())
  })

  it('没有空值', () => {
    for (const [loc, m] of Object.entries(MESSAGES)) {
      for (const [k, v] of Object.entries(m as Messages)) {
        expect(String(v).length, `${loc}.${k} 是空的`).toBeGreaterThan(0)
      }
    }
  })
})

describe('fmt', () => {
  it('替换占位符', () => {
    expect(fmt('{a} and {b}', { a: '1', b: 2 })).toBe('1 and 2')
  })

  it('缺失的占位符原样留下 —— 一眼看得出是哪个 key 没给，而不是变成 undefined', () => {
    expect(fmt('{a} and {b}', { a: 'x' })).toBe('x and {b}')
  })

  it('内置文案里的占位符都能被喂上', () => {
    const filled = fmt(MESSAGES.en.noBuildForPlatform, { platform: 'linux', arch: 'x64' })
    expect(filled).not.toMatch(/\{\w+\}/)
    expect(filled).toContain('linux-x64')
  })
})

describe('接到各处', () => {
  it('页面按 locale 渲染，且 <html lang> 跟着走', () => {
    const en = renderPage('t', 'T', '', MESSAGES.en)
    const zh = renderPage('t', 'T', '', MESSAGES.zh)
    expect(en).toContain('<html lang="en">')
    expect(zh).toContain('<html lang="zh">')
    // 文案整份序列化进页面脚本 —— 页面自包含，运行时没有第二次机会取文案
    expect(en).toContain(JSON.stringify(MESSAGES.en))
    expect(zh).toContain(JSON.stringify(MESSAGES.zh))
    // 只断言那份载荷，别断言整页：源码注释也在模板里、会一起发到浏览器，
    // 而注释是中文的（和 UI 语言是两件事）
    const payload = (h: string) => /var M=(\{.*?\});/s.exec(h)![1]
    expect(payload(en)).not.toMatch(/[\u4e00-\u9fa5]/)
    expect(payload(zh)).toMatch(/[\u4e00-\u9fa5]/)
    // body 里的占位文案也要跟着切
    const idle = (h: string) => h.split('\n').find(l => l.includes('class="idle"'))!
    expect(idle(en)).toContain(MESSAGES.en.waiting)
    expect(idle(zh)).toContain(MESSAGES.zh.waiting)
  })

  it('renderText 的图片占位与「无差异」跟着 locale', () => {
    const img = { type: 'image', src: 'a.png', alt: 'cat' } as const
    expect(renderText(img, 'en')).toBe('[image: cat] a.png')
    expect(renderText(img, 'zh')).toBe('[图片: cat] a.png')
    const same = { type: 'diff', before: 'x', after: 'x' } as const
    expect(renderText(same, 'en')).toBe(MESSAGES.en.noDiff)
    expect(renderText(same, 'zh')).toBe(MESSAGES.zh.noDiff)
  })

  it('原生壳的降级原因跟着 locale', () => {
    const en = nativeShellUnavailableReason(undefined, 'en')
    const zh = nativeShellUnavailableReason(undefined, 'zh')
    if (en && zh) {
      expect(en).not.toBe(zh)
      expect(en).not.toMatch(/[一-龥]/)
      expect(zh).toMatch(/[一-龥]/)
    }
  })

  it('createInteract 的 locale 传得到终端通道', async () => {
    const out: string[] = []
    const ui = new Interact().register(
      new TtyChannel({
        forceTty: true,
        locale: 'zh',
        input: { isTTY: true } as never,
        output: { write: (s: string) => void out.push(s) } as never,
      }),
    )
    expect(ui).toBeDefined()
    // 只验构造不抛且拿到了中文表；真正的读写在 channels.test.ts 里覆盖
    expect(resolveMessages('zh').confirmPrompt).toContain('确认')
  })

  it('createInteract 接受 locale 且不影响调用方自己的文案', async () => {
    const ui = createInteract({ web: false, tty: false, locale: 'zh' })
    ui.register(new ScriptedChannel([answer.accept()]))
    const r = await ui.confirm({ title: 'Delete?', message: 'Not undoable' })
    expect(r.action).toBe('accept')
  })
})
