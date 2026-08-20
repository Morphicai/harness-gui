/**
 * 页面的表单校验 —— 直接跑页面里那段 JS
 *
 * 为什么值得单独测：协议里声明了 required，页面却照收空值的话，发起方拿到的是 ""，
 * 而它以为自己拿到了必填项。这种错不会当场报出来，会一路漏到业务逻辑里才暴露。
 */
import { describe, it, expect } from 'vitest'
import { MESSAGES } from '../src/i18n.js'
import { renderPage } from '../src/channels/web/page.js'

interface FieldStub {
  type: string
  value: unknown
  checked?: boolean
  classes: string[]
  focused: boolean
  getAttribute(k: string): string | null
  classList: { add(c: string): void }
  focus(): void
}

function field(name: string, type: string, value: unknown, required = false): FieldStub {
  const attrs: Record<string, string> = { 'data-n': name }
  if (required) attrs['data-req'] = '1'
  const f: FieldStub = {
    type,
    value,
    checked: type === 'checkbox' ? Boolean(value) : undefined,
    classes: [],
    focused: false,
    getAttribute: k => attrs[k] ?? null,
    classList: { add: c => f.classes.push(c) },
    focus: () => {
      f.focused = true
    },
  }
  return f
}

/** 把页面跑起来，并允许注入表单字段与选项，然后模拟点「提交」 */
function runPage(opts: { fields?: FieldStub[]; radios?: { checked: boolean; value: string }[] } = {}) {
  const html = renderPage('tok', 'title')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('页面里找不到脚本块')

  const buttons: { _a: string; onclick?: () => void; getAttribute(k: string): string | null }[] = [
    { _a: 'accept', getAttribute: k => (k === 'data-a' ? 'accept' : null) },
    { _a: 'cancel', getAttribute: k => (k === 'data-a' ? 'cancel' : null) },
  ]
  const created: { className: string; textContent: string }[] = []

  const root = {
    innerHTML: '',
    querySelectorAll(sel: string) {
      if (sel === 'button[data-a]') return buttons
      if (sel === '[data-n]') return opts.fields ?? []
      if (sel === 'input[name=sel]') return opts.radios ?? []
      return []
    },
    querySelector(sel: string) {
      // 让 .err 与 .row 都返回 null，走 appendChild 分支，省掉 parentNode 的桩
      return sel === '.err' ? (created.find(c => c.className === 'err') ?? null) : null
    },
    appendChild(el: { className: string; textContent: string }) {
      created.push(el)
    },
  }

  const posts: { url: string; body: any }[] = []
  const doc = {
    getElementById: () => root,
    hasFocus: () => true,
    hidden: false,
    addEventListener: () => {},
    createElement: () => ({ className: '', textContent: '' }),
  }
  class FakeEventSource {
    handlers: Record<string, (e: { data: string }) => void> = {}
    addEventListener(n: string, fn: (e: { data: string }) => void) {
      this.handlers[n] = fn
    }
    close() {}
  }
  let es: FakeEventSource | undefined
  const ES = class extends FakeEventSource {
    constructor() {
      super()
      es = this
    }
  }

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'EventSource', 'fetch', script)({}, doc, ES, (url: string, init?: { body?: string }) => {
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
    return Promise.resolve()
  })

  return {
    posts,
    created,
    root,
    dispatch: (i: unknown) => es!.handlers.interaction({ data: JSON.stringify(i) }),
    click: (which: 'accept' | 'cancel') => buttons.find(b => b._a === which)!.onclick!(),
    submits: () => posts.filter(p => p.url.startsWith('/submit')),
    error: () => created.find(c => c.className === 'err')?.textContent,
  }
}

describe('表单必填校验', () => {
  it('必填项为空时拦住提交，并就地报错', () => {
    const token = field('token', 'password', '', true)
    const page = runPage({ fields: [field('name', 'text', 'x'), token] })
    page.dispatch({ id: 'i1', kind: 'form', title: '发布凭据', fields: [] })

    page.click('accept')

    expect(page.submits()).toHaveLength(0)
    expect(page.error()).toBe(MESSAGES.en.fillRequired)
    // 光标要落到出问题的那个字段上，否则长表单里用户得自己找
    expect(token.focused).toBe(true)
    expect(token.classes).toContain('bad')
  })

  it('只有空白字符也算空', () => {
    const page = runPage({ fields: [field('token', 'text', '   ', true)] })
    page.dispatch({ id: 'i1', kind: 'form', title: 't', fields: [] })
    page.click('accept')
    expect(page.submits()).toHaveLength(0)
  })

  it('必填项填了就正常提交，值原样带出', () => {
    const page = runPage({
      fields: [field('token', 'password', 'secret', true), field('retries', 'number', '2'), field('notify', 'checkbox', true)],
    })
    page.dispatch({ id: 'i1', kind: 'form', title: 't', fields: [] })
    page.click('accept')

    const s = page.submits()
    expect(s).toHaveLength(1)
    expect(s[0].body).toMatchObject({
      id: 'i1',
      action: 'accept',
      value: { token: 'secret', retries: 2, notify: true },
    })
  })

  it('非必填项为空不拦', () => {
    const page = runPage({ fields: [field('note', 'text', '')] })
    page.dispatch({ id: 'i1', kind: 'form', title: 't', fields: [] })
    page.click('accept')
    expect(page.submits()).toHaveLength(1)
  })

  it('number 类型：填了 0 不算空', () => {
    // 0 是合法输入，用 falsy 判空会把它误判成没填
    const page = runPage({ fields: [field('count', 'number', '0', true)] })
    page.dispatch({ id: 'i1', kind: 'form', title: 't', fields: [] })
    page.click('accept')
    expect(page.submits()).toHaveLength(1)
    expect(page.submits()[0].body.value).toEqual({ count: 0 })
  })

  it('取消不做校验 —— 放弃就是放弃', () => {
    const page = runPage({ fields: [field('token', 'text', '', true)] })
    page.dispatch({ id: 'i1', kind: 'form', title: 't', fields: [] })
    page.click('cancel')
    expect(page.submits()[0].body).toMatchObject({ action: 'cancel' })
  })

  it('必填标记与 data-req 一起出现在渲染结果里', () => {
    const html = renderPage('tok', 't')
    expect(html).toContain('data-req="1"')
    expect(html).toContain('class="req"')
  })
})

describe('select 未选时的反馈', () => {
  it('一项没选就点确定：拦住并报错，而不是静默无反应', () => {
    const page = runPage({ radios: [{ checked: false, value: 'a' }, { checked: false, value: 'b' }] })
    page.dispatch({ id: 'i1', kind: 'select', title: '选环境', options: [] })
    page.click('accept')

    expect(page.submits()).toHaveLength(0)
    // 点了没反应的按钮比报错更糟：用户分不清是没选还是程序挂了
    expect(page.error()).toBe(MESSAGES.en.pickOne)
  })

  it('选了就正常提交', () => {
    const page = runPage({ radios: [{ checked: true, value: 'uat' }, { checked: false, value: 'test' }] })
    page.dispatch({ id: 'i1', kind: 'select', title: 't', options: [] })
    page.click('accept')
    expect(page.submits()[0].body.value).toBe('uat')
  })
})
