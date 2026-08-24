/**
 * 页面的 markdown 渲染 —— 直接跑页面里那段 JS
 *
 * 为什么值得单独测：message 是调用方唯一能塞正文的字段，实际拿到的经常是带标题、
 * 列表、表格的长文。这里渲染错了不会报错，只会在人眼前糊成一坨；而链接协议放宽了
 * 更糟 —— 这个页面手里有 token。
 */
import { describe, it, expect } from 'vitest'
import { renderPage } from '../src/channels/web/page.js'

/** 把页面跑起来，投一次交互，把渲染结果抓回来 */
function runPage() {
  const script = renderPage('tok', 'title').match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('页面里找不到脚本块')

  const root = {
    innerHTML: '',
    querySelectorAll: () => [],
    querySelector: () => null,
    appendChild: () => {},
  }
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
  new Function('window', 'document', 'EventSource', 'fetch', script)({}, doc, ES, () => Promise.resolve())

  return {
    /** 渲染一条 confirm，返回页面 HTML */
    message: (message: string) => {
      es!.handlers.interaction({ data: JSON.stringify({ id: 'i1', kind: 'confirm', title: 't', message }) })
      return root.innerHTML
    },
  }
}

describe('message 的 markdown 渲染', () => {
  it('标题 / 列表 / 表格 / 围栏都渲染成对应元素', () => {
    const html = runPage().message(
      ['## 三个选项', '', '- **A)** 顺手修', '- B) 不修', '', '| 方案 | 代价 |', '| --- | ---: |', '| A | 一天 |', '', '```ts', 'const a = 1', '```'].join('\n'),
    )

    expect(html).toContain('<h3>三个选项</h3>') // 页面自己占着 h1，标题整体降一级
    expect(html).toContain('<li><strong>A)</strong> 顺手修</li>')
    expect(html).toContain('<th style="text-align:left">方案</th>')
    expect(html).toContain('<td style="text-align:right">一天</td>')
    expect(html).toContain('<div class="lang">ts</div>')
    expect(html).toContain('<code>const a = 1</code>')
  })

  it('有序列表与任务项保留自己的语义', () => {
    const html = runPage().message(['1. 先看', '2. 再改', '', '- [x] 已做', '- [ ] 没做'].join('\n'))
    expect(html).toContain('<ol><li>先看</li><li>再改</li></ol>')
    expect(html).toContain('<input type="checkbox" disabled checked> 已做')
    expect(html).toContain('<input type="checkbox" disabled> 没做')
  })

  it('嵌套列表挂在上一项里，不摊平成同级', () => {
    const html = runPage().message(['- 外', '  - 内', '- 外二'].join('\n'))
    expect(html).toContain('<li>外<ul><li>内</li></ul></li>')
  })

  it('纯文本的换行不丢 —— 段落内软换行渲染成 <br>', () => {
    const html = runPage().message('第一行\n第二行\n\n第二段')
    expect(html).toContain('<p>第一行<br>第二行</p>')
    expect(html).toContain('<p>第二段</p>')
  })

  it('行内码里的星号不当格式', () => {
    const html = runPage().message('用 `a ** b` 算')
    expect(html).toContain('<code>a ** b</code>')
    expect(html).not.toContain('<strong>')
  })

  it('HTML 一律转义，标签进不来', () => {
    const html = runPage().message('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })

  it('只放行安全协议的链接，javascript: 退成纯文本', () => {
    const ok = runPage().message('[文档](https://example.com/a)')
    expect(ok).toContain('<a href="https://example.com/a" target="_blank"')

    // 这个页面同源持有 token，一个能点的 javascript: 链接等于把它交出去
    const bad = runPage().message('[点我](javascript:fetch("/submit"))')
    expect(bad).not.toContain('<a ')
    expect(bad).toContain('点我')
  })

  it('页面拉不到的图退成文案，不去引外部资源', () => {
    // 页面零外部资源是硬约束，data: 与 http(s) 之外的图源一律只留说明
    const html = runPage().message('![图](ftp://host/a.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('ftp://host/a.png')
  })

  it('看着像表格但没有分隔行的一行，当段落处理且不卡死', () => {
    const html = runPage().message('| 看着像表格 |')
    expect(html).toContain('| 看着像表格 |')
  })

  it('调用方把换行多转义了一层时，仍然按换行排版', () => {
    // 模型写 JSON 时偶尔把 \n 写成字面的反斜杠 + n，正文里就冒出一个个可见的 \n
    const html = runPage().message('## 标题\\n\\n正文')
    expect(html).toContain('<h3>标题</h3>')
    expect(html).not.toContain('\\n')
  })

  it('文本里有真换行时，字面的 \\n 保持原样 —— 那是内容不是格式', () => {
    const html = runPage().message('换行符写作 \\n\n就这样')
    expect(html).toContain('\\n')
  })
})
