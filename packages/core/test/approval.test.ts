/**
 * 批准闸门的用例。
 *
 * 这一层是「模型不能自己放行」这条立场的唯一执行点，所以它的行为差异要被钉住 ——
 * 尤其是 timeout / cancel 必须分开报，以及 off 是默认值。
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  requireApproval,
  askText,
  showToUser,
  interactMode,
  setUiForTest,
  ApprovalDeniedError,
  setUi,
  asContent,
  getUi,
  Interact,
  ScriptedChannel,
  answer,
  type Outcome,
  type Content,
} from '../src/index.js'

const ENV = 'HARNESS_GUI'

function withChannel(...answers: Outcome[]): Interact {
  const ui = new Interact().register(new ScriptedChannel(answers))
  setUiForTest(ui)
  return ui
}

afterEach(() => {
  delete process.env[ENV]
  setUiForTest(undefined)
})

describe('策略门控', () => {
  it('默认是 off —— 库无从判断有没有人在看，猜错就是挂死', () => {
    delete process.env[ENV]
    expect(interactMode()).toBe('off')
  })

  it('on / 1 / true 都算开启，strict 单独一档', () => {
    for (const v of ['on', '1', 'true', 'ON']) {
      process.env[ENV] = v
      expect(interactMode()).toBe('on')
    }
    process.env[ENV] = 'strict'
    expect(interactMode()).toBe('strict')
    process.env[ENV] = '随便什么'
    expect(interactMode()).toBe('off')
  })

  it('off 下不碰通道 —— 已有自动化完全不受影响', async () => {
    delete process.env[ENV]
    const ui = withChannel(answer.cancel())   // 会拒的答案，但根本不该被取用
    await expect(
      requireApproval({ action: 'delete', title: 'T', message: 'M' }),
    ).resolves.toBeUndefined()
    expect(ui).toBeDefined()
  })
})

describe('requireApproval', () => {
  it('人点了同意就放行', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept())
    await expect(
      requireApproval({ action: 'delete', title: 'T', message: 'M' }),
    ).resolves.toBeUndefined()
  })

  it('人拒绝 → 抛，且说明是被拒', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.cancel())
    await expect(
      requireApproval({ action: 'delete rows', title: 'T', message: 'M' }),
    ).rejects.toThrow(/delete rows/)
    withChannel(answer.cancel())
    await expect(
      requireApproval({ action: 'delete rows', title: 'T', message: 'M' }),
    ).rejects.toThrow(/declined/)
  })

  it('超时和取消的文案必须不同 —— 「没人在」与「不要」是两件事', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.timeout())
    await expect(
      requireApproval({ action: 'send', title: 'T', message: 'M' }),
    ).rejects.toThrow(/timed out/)
  })

  it('抛出的是 ApprovalDeniedError，instanceof 认得出来', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.cancel())
    const err = await requireApproval({ action: 'x', title: 'T', message: 'M' }).catch(e => e)
    expect(err).toBeInstanceOf(ApprovalDeniedError)
    expect(err.action).toBe('x')
    expect(err.name).toBe('ApprovalDeniedError')
  })

  it('on + 没有任何通道 → 放行，不打断无头环境里的自动化', async () => {
    process.env[ENV] = 'on'
    setUiForTest(new Interact())        // 一个通道都没注册
    await expect(
      requireApproval({ action: 'delete', title: 'T', message: 'M' }),
    ).resolves.toBeUndefined()
  })

  it('strict + 没有任何通道 → 拒绝，宁可停下也不误发', async () => {
    process.env[ENV] = 'strict'
    setUiForTest(new Interact())
    await expect(
      requireApproval({ action: 'delete', title: 'T', message: 'M' }),
    ).rejects.toThrow(/strict/)
  })

  it('preview 只是展示，不消耗答案，也不该顶掉批准本身', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept())        // 只给一个答案：给 confirm 的
    await expect(
      requireApproval({
        action: 'delete',
        title: 'T',
        message: 'M',
        preview: { type: 'markdown', text: '待删 12 行' },
      }),
    ).resolves.toBeUndefined()
  })
})

describe('askText', () => {
  it('拿到值就返回', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept({ text: '123456' }))
    await expect(askText({ title: 'T', label: 'Code' })).resolves.toBe('123456')
  })

  it('取消返回 undefined，而不是空串 —— 空串会被下游当成「人填了空」', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.cancel())
    await expect(askText({ title: 'T', label: 'Code' })).resolves.toBeUndefined()
  })

  it('只填了空白也算没填', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept({ text: '   ' }))
    await expect(askText({ title: 'T', label: 'Code' })).resolves.toBeUndefined()
  })

  it('off 下不问人，直接 undefined', async () => {
    delete process.env[ENV]
    withChannel(answer.accept({ text: 'x' }))
    await expect(askText({ title: 'T', label: 'Code' })).resolves.toBeUndefined()
  })
})

describe('showToUser', () => {
  it('展示失败不让调用方失败 —— 那只是没看到，不是操作出错', async () => {
    process.env[ENV] = 'on'
    setUiForTest({
      show: () => Promise.reject(new Error('通道炸了')),
    } as unknown as Interact)
    await expect(
      showToUser({ title: 'T', content: { type: 'markdown', text: 'x' } }),
    ).resolves.toBeUndefined()
  })
})

describe('SDK 用法：批准层要能指向调用方自己的实例', () => {
  it('ui 参数把批准送到我建的实例上，而不是共享的那个', async () => {
    process.env[ENV] = 'on'
    // 共享实例给「同意」，自己的实例给「拒绝」—— 用哪个一试就知道
    setUiForTest(new Interact().register(new ScriptedChannel([answer.accept()])))
    const mine = new Interact().register(new ScriptedChannel([answer.cancel()]))
    await expect(
      requireApproval({ action: 'x', title: 'T', message: 'M', ui: mine }),
    ).rejects.toThrow(ApprovalDeniedError)
  })

  it('没传 ui 才用共享的', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept())
    await expect(requireApproval({ action: 'x', title: 'T', message: 'M' })).resolves.toBeUndefined()
  })

  it('askText / showToUser 同样能指定 ui', async () => {
    process.env[ENV] = 'on'
    setUiForTest(new Interact().register(new ScriptedChannel([answer.cancel()])))
    const mine = new Interact().register(new ScriptedChannel([answer.accept({ text: '123456' })]))
    await expect(askText({ title: 'T', label: 'Code', ui: mine })).resolves.toBe('123456')

    const seen: string[] = []
    const spy = { show: (p: { title: string }) => void seen.push(p.title) } as unknown as Interact
    await showToUser({ title: 'mine', content: 'x', ui: spy })
    expect(seen).toEqual(['mine'])
  })

  it('setUi 换掉共享实例，undefined 复位到默认通道', () => {
    const mine = new Interact().register(new ScriptedChannel([]))
    setUi(mine)
    expect(getUi()).toBe(mine)
    setUi(undefined)
    // 默认是 daemon(client) + tty —— daemon 的 name 是 client，优先级 15，
    // 所以它排在 tty(30) 前面。这是本项目的取向：能开图形界面就给富一点的形态
    expect(getUi().list()).toEqual(['client', 'tty'])
  })
})

describe('预览可以直接给 markdown', () => {
  it('字符串按 markdown 渲染，Content 原样透传', async () => {
    const fromStr = await asContent('| a |\n|---|\n| 1 |')
    expect(typeof fromStr.type).toBe('string')
    const c: Content = { type: 'table', columns: ['a'], rows: [['1']] }
    expect(await asContent(c)).toBe(c)
  })

  it('requireApproval 收字符串预览，且仍不多消耗一个答案', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept())
    await expect(
      requireApproval({ action: 'x', title: 'T', message: 'M', preview: '**12 rows**' }),
    ).resolves.toBeUndefined()
  })

  it('showToUser 收字符串', async () => {
    process.env[ENV] = 'on'
    const seen: unknown[] = []
    const spy = { show: (p: { content: unknown }) => void seen.push(p.content) } as unknown as Interact
    await showToUser({ title: 'T', content: '# hi', ui: spy })
    expect(seen).toHaveLength(1)
    expect((seen[0] as { type: string }).type).toBeTruthy()
  })
})
