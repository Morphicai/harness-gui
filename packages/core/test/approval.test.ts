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
  Interact,
  ScriptedChannel,
  answer,
  type Outcome,
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
