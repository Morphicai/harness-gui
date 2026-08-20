/**
 * markdown → 富内容
 *
 * 贯穿全部用例的一条取舍：**认不出来的东西降级成看得见的原文，绝不吞掉。**
 * 渲染不了的公式显示成代码块，人还能读；显示成空白就等于内容丢了，而调用方毫不知情。
 */
import { describe, it, expect } from 'vitest'
import { markdownToContent } from '../src/markdown.js'
import { validateContent } from '../src/content.js'

const html = async (md: string, opts?: any) => {
  const c = await markdownToContent(md, opts)
  return (c as { html: string }).html
}

describe('结构', () => {
  it('产出 T2，且必带 fallback —— 否则终端上就是一片空白', async () => {
    const c = await markdownToContent('# 标题')
    expect(c.type).toBe('html')
    expect((c as any).fallback).toBeTruthy()
    // 协议层的校验必须放行（缺 fallback 会在这里抛）
    expect(() => validateContent(c)).not.toThrow()
  })

  it('fallback 是原始 markdown，超长截断', async () => {
    const c = await markdownToContent('x'.repeat(9000), { fallbackChars: 100 })
    const f = (c as any).fallback
    expect(f.type).toBe('markdown')
    expect(f.text.length).toBeLessThan(300)
    expect(f.text).toContain('截断')
  })
})

describe('块级', () => {
  it('标题 / 段落 / 分割线', async () => {
    const h = await html('# 一\n\n正文\n\n---\n\n## 二')
    expect(h).toContain('<h1>一</h1>')
    expect(h).toContain('<p>正文</p>')
    expect(h).toContain('<hr>')
    expect(h).toContain('<h2>二</h2>')
  })

  it('表格：表头 + 对齐 + 单元格', async () => {
    const h = await html('| 包 | 版本 |\n| --- | ---: |\n| sdk | 0.1.19 |')
    expect(h).toContain('<table>')
    expect(h).toContain('<th style="text-align:left">包</th>')
    expect(h).toContain('<th style="text-align:right">版本</th>')
    expect(h).toContain('0.1.19')
  })

  it('没有分隔行的竖线不算表格 —— 别把普通文字吃成表', async () => {
    const h = await html('| 这不是表格 |')
    expect(h).not.toContain('<table>')
  })

  it('嵌套列表与任务项（保留完成状态）', async () => {
    const h = await html('- 一\n  - 一一\n- [x] 做完了\n- [ ] 没做')
    expect(h).toContain('<ul>')
    expect(h.match(/<ul>/g)!.length).toBeGreaterThanOrEqual(2)
    expect(h).toContain('checkbox')
    expect(h).toContain('checked')
  })

  it('有序列表', async () => {
    expect(await html('1. 甲\n2. 乙')).toContain('<ol>')
  })

  it('引用块', async () => {
    const h = await html('> 引用的话')
    expect(h).toContain('<blockquote>')
    expect(h).toContain('引用的话')
  })

  it('围栏代码块保留原文与语言标记', async () => {
    const h = await html('```ts\nconst a = 1 < 2\n```')
    expect(h).toContain('<pre>')
    expect(h).toContain('const a = 1 &lt; 2')
    expect(h).toContain('ts')
  })

  it('渲染不了的语言（mermaid / katex）降级成代码块而不是留白', async () => {
    // 这是本文件最重要的一条：宁可显示原文，也不能让内容凭空消失
    const h = await html('```mermaid\ngraph TD\n  A --> B\n```')
    expect(h).toContain('graph TD')
    expect(h).toContain('mermaid')
  })
})

describe('行内', () => {
  it('粗体 / 斜体 / 删除线 / 行内码', async () => {
    const h = await html('**粗** *斜* ~~删~~ `码`')
    expect(h).toContain('<strong>粗</strong>')
    expect(h).toContain('<em>斜</em>')
    expect(h).toContain('<del>删</del>')
    expect(h).toContain('<code>码</code>')
  })

  it('行内码里的星号不被当成格式 —— 代码里出现星号是家常便饭', async () => {
    const h = await html('`a ** b`')
    expect(h).toContain('<code>a ** b</code>')
    expect(h).not.toContain('<strong>')
  })

  it('链接带 noopener，且非 http/mailto 的协议被剥成纯文本', async () => {
    const ok = await html('[去看看](https://example.com)')
    expect(ok).toContain('rel="noreferrer noopener"')

    const bad = await html('[点我](javascript:alert(1))')
    expect(bad).not.toContain('javascript:')
    expect(bad).toContain('点我')
  })
})

describe('安全', () => {
  it('源码里的 HTML 被转义，不能直接生效', async () => {
    const h = await html('<img src=x onerror=alert(1)>')
    expect(h).not.toContain('<img src=x')
    expect(h).toContain('&lt;img')
  })

  it('CSP 只放行 data: 图片 —— 页面零外部资源这条不因内容是别人给的而破例', async () => {
    const h = await html('# t')
    expect(h).toContain('img-src data:')
    expect(h).toContain("default-src 'none'")
  })
})

describe('图片', () => {
  it('通过 resolveImage 内联成 data URI', async () => {
    const h = await html('![图](https://cdn.example.com/a.png)', {
      resolveImage: async () => 'data:image/png;base64,AAAA',
    })
    expect(h).toContain('src="data:image/png;base64,AAAA"')
  })

  it('取不到就保留原图地址，不静默抹掉', async () => {
    const h = await html('![图](https://cdn.example.com/a.png)', { resolveImage: async () => undefined })
    expect(h).toContain('cdn.example.com/a.png')
  })

  it('resolveImage 抛错不该让整篇打不开', async () => {
    const h = await html('# 标题\n\n![图](https://x/a.png)', {
      resolveImage: async () => {
        throw new Error('403')
      },
    })
    expect(h).toContain('<h1>标题</h1>')
  })

  it('已经是 data URI 的不重复解析', async () => {
    let called = 0
    await html('![x](data:image/png;base64,AA)', {
      resolveImage: async () => {
        called++
        return 'data:image/png;base64,BB'
      },
    })
    expect(called).toBe(0)
  })
})

describe('renderBlock —— 要跑起来才看得见的块（流程图 / 公式）', () => {
  const mermaid = (): any => ({
    renderBlock: (lang: string, code: string) =>
      lang === 'mermaid'
        ? {
            html: `<div class="mermaid">${code}</div>`,
            runtime: { key: 'mermaid', script: 'window.__M=1', css: '.mermaid{margin:1em 0}' },
          }
        : undefined,
  })

  it('接管后不再输出代码块', async () => {
    const h = await html('```mermaid\ngraph TD\n  A --> B\n```', mermaid())
    expect(h).toContain('<div class="mermaid">graph TD')
    expect(h).not.toContain('<pre>')
  })

  it('没接管的语言维持原样降级 —— 默认行为一点不变', async () => {
    const h = await html('```python\nprint(1)\n```', mermaid())
    expect(h).toContain('<pre>')
    expect(h).toContain('print(1)')
  })

  it('运行时按 key 去重 —— 十张图不该把 mermaid 打进去十遍', async () => {
    const h = await html('```mermaid\nA\n```\n\n```mermaid\nB\n```\n\n```mermaid\nC\n```', mermaid())
    expect(h.match(/window\.__M=1/g)).toHaveLength(1)
    expect(h.match(/class="mermaid"/g)).toHaveLength(3)
  })

  it('注入脚本时才放开 script-src，普通文档的 CSP 一条都不放', async () => {
    const withJs = await html('```mermaid\nA\n```', mermaid())
    expect(withJs).toContain("script-src 'unsafe-inline'")

    const plain = await html('# 只是一篇文档')
    expect(plain).not.toContain('script-src')
    expect(plain).toContain("default-src 'none'")
  })

  it('渲染器抛异常时退回代码块，而不是让整篇打不开', async () => {
    const h = await html('# 标题\n\n```mermaid\nA\n```', {
      renderBlock: () => {
        throw new Error('画不出来')
      },
    })
    expect(h).toContain('<h1>标题</h1>')
    expect(h).toContain('<pre>')
    expect(h).toContain('mermaid')
  })

  it('运行时里出现 </script 不能把标签提前关掉', async () => {
    // 打包产物的字符串/正则里出现 `</script` 是完全可能的
    const h = await html('```x\nA\n```', {
      renderBlock: () => ({ html: '<i>x</i>', runtime: { key: 'k', script: 'var s="</script><img onerror=1>"' } }),
    })
    expect(h).not.toContain('</script><img')
    expect(h).toContain('<\\/script')
  })

  it('引用块里的围栏也走同一个渲染器', async () => {
    const h = await html('> ```mermaid\n> A\n> ```', mermaid())
    expect(h).toContain('class="mermaid"')
  })

  it('不给 renderBlock 时行为与之前完全一致', async () => {
    const h = await html('```mermaid\ngraph TD\n```')
    expect(h).toContain('<pre>')
    expect(h).toContain('graph TD')
  })
})

describe('体积上限', () => {
  it('超限截断并注明，且不从标签中间切开', async () => {
    const big = Array.from({ length: 400 }, (_, i) => `## 第 ${i} 节\n\n正文正文正文正文正文正文`).join('\n\n')
    const h = await html(big, { maxBytes: 4000 })
    expect(h).toContain('已截断')
    // 从标签中间切开会产出坏 HTML：末尾必须落在一个闭合标签之后
    expect(h.trimEnd().endsWith('</div>')).toBe(true)
  })
})

describe('解析器不会卡死', () => {
  /*
   * 回归：看着像块级、却没被任何块级分支接住的行（如没有分隔行的表格行），
   * 会让段落分支一行都不消费、i 永不前进 —— 直接死循环。
   * 这类 bug 不会报错，只会把进程挂住，所以必须有超时保护的用例钉住。
   */
  const cases: [string, string][] = [
    ['孤立表格行', '| 只有一行 |'],
    ['未闭合围栏', '```ts\nconst a = 1'],
    ['只有分隔行', '| --- |'],
    ['列表标记后没内容', '-'],
    ['空引用', '>'],
    ['连续奇怪符号', '| a |\n> \n- \n#'],
  ]
  for (const [name, md] of cases) {
    it(`${name} 能在限时内解析完`, { timeout: 3000 }, async () => {
      const c = await markdownToContent(md)
      expect((c as any).html).toBeTruthy()
    })
  }
})
