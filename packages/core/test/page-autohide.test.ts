/**
 * 答完之后自动收起窗口
 *
 * 一个常驻客户端不该答完了还赖在最前面。但「什么时候收」有两条必须守住的边界：
 *  - 人正在**读**东西时不能收（纯展示不该触发）
 *  - 一次工具调用常常连着问两轮（先填内容、再确认），中间不能收
 *
 * 这两条错了都不会报错，只会让人莫名其妙 —— 所以钉在测试里。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderPage } from '../src/channels/web/page.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function runPage(opts: { bridge?: boolean } = {}) {
  const script = renderPage('tok', 'title').match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('页面里找不到脚本块')

  const buttons: { _a: string; onclick?: () => void; getAttribute(k: string): string | null }[] = [
    { _a: 'accept', getAttribute: k => (k === 'data-a' ? 'accept' : null) },
    { _a: 'cancel', getAttribute: k => (k === 'data-a' ? 'cancel' : null) },
  ]
  const root = {
    innerHTML: '',
    querySelectorAll: (sel: string) => (sel === 'button[data-a]' ? buttons : []),
    querySelector: () => null,
    appendChild: () => {},
  }

  const invokes: { cmd: string; arg: any }[] = []
  const zero = {
    invoke(cmd: string, arg: any) {
      invokes.push({ cmd, arg })
      return Promise.resolve(true)
    },
    os: { showNotification: () => Promise.resolve(true) },
  }

  const doc = {
    getElementById: () => root,
    hasFocus: () => true,
    hidden: false,
    addEventListener: () => {},
    createElement: () => ({ className: '', textContent: '' }),
  }
  let es: any
  class ES {
    handlers: Record<string, (e: { data: string }) => void> = {}
    constructor() {
      es = this
    }
    addEventListener(n: string, fn: (e: { data: string }) => void) {
      this.handlers[n] = fn
    }
    close() {}
  }

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'EventSource', 'fetch', script)(
    opts.bridge === false ? {} : { zero },
    doc,
    ES,
    () => Promise.resolve(),
  )

  return {
    invokes,
    hides: () => invokes.filter(c => c.cmd === 'native-sdk.command.invoke' && c.arg?.name === 'interact.hide'),
    dispatch: (i: unknown) => es.handlers.interaction({ data: JSON.stringify(i) }),
    click: (which: 'accept' | 'cancel') => buttons.find(b => b._a === which)!.onclick!(),
  }
}

const confirm = (id = 'i1') => ({ id, kind: 'confirm', title: '确认', message: '要不要' })

describe('答完收起窗口', () => {
  it('回答之后收起来', () => {
    const p = runPage()
    p.dispatch(confirm())
    p.click('accept')
    expect(p.hides(), '不该立刻收 —— 要留出下一轮追问的余地').toHaveLength(0)

    vi.advanceTimersByTime(1000)
    expect(p.hides()).toHaveLength(1)
  })

  it('取消也算答完', () => {
    const p = runPage()
    p.dispatch(confirm())
    p.click('cancel')
    vi.advanceTimersByTime(1000)
    expect(p.hides()).toHaveLength(1)
  })

  it('用的是 app 自己的命令，不是 window.close —— 那条会连 WebView 一起销毁', () => {
    const p = runPage()
    p.dispatch(confirm())
    p.click('accept')
    vi.advanceTimersByTime(1000)
    expect(p.hides()[0].arg).toEqual({ name: 'interact.hide' })
    expect(p.invokes.some(c => c.cmd.includes('window.close'))).toBe(false)
  })
})

describe('不该收的时候', () => {
  it('纯展示不收 —— 人正在读，把窗口收掉等于把文档抢走', () => {
    const p = runPage()
    p.dispatch({ id: 'i1', kind: 'show', title: '文档', content: { type: 'markdown', text: '# 正文' } })
    vi.advanceTimersByTime(3000)
    expect(p.hides()).toHaveLength(0)
  })

  it('通知不收', () => {
    const p = runPage()
    p.dispatch({ id: 'i1', kind: 'notify', title: '好了', message: '完成' })
    vi.advanceTimersByTime(3000)
    expect(p.hides()).toHaveLength(0)
  })

  it('连着问两轮时中间不收 —— 否则第二问会推给一个隐藏的窗口', () => {
    const p = runPage()
    p.dispatch(confirm('i1'))
    p.click('accept')
    vi.advanceTimersByTime(200) // 还没到点
    p.dispatch(confirm('i2')) // 第二问到了
    vi.advanceTimersByTime(3000)
    expect(p.hides(), '第一问的收窗定时没有被取消').toHaveLength(0)

    p.click('accept')
    vi.advanceTimersByTime(1000)
    expect(p.hides(), '最后一问答完还是要收').toHaveLength(1)
  })

  it('浏览器里不碰窗口 —— 标签页归用户自己管', () => {
    const p = runPage({ bridge: false })
    p.dispatch(confirm())
    p.click('accept')
    vi.advanceTimersByTime(3000)
    expect(p.invokes).toHaveLength(0)
  })
})
