/**
 * MCP 工具层的用例。
 *
 * 这一层几乎没有逻辑（协议与降级都在 core 里），所以测的是**契约**：
 * 工具在不在、schema 对不对、off 的时候是否老实拒绝而不是挂住。
 *
 * 注意这里 import 的是 `harness-gui` 包名（→ core 的 dist），和 tools.ts 里一致 ——
 * 若一边走包名一边走 ../src，会拿到两份模块实例，setUiForTest 就换不到同一个单例上。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { Interact, ScriptedChannel, answer, setUiForTest, type Outcome } from 'harness-gui'
import { registerGuiTools } from '../src/tools.js'

const ENV = 'HARNESS_GUI'

type Handler = (args: any) => Promise<{ content: { type: 'text'; text: string }[] }>
interface Captured {
  description: string
  schema: Record<string, unknown>
  handler: Handler
}

/** 假 server：只把注册信息记下来，不接任何传输层 */
function capture() {
  const tools = new Map<string, Captured>()
  const fake = {
    tool(name: string, description: string, schema: Record<string, unknown>, handler: Handler) {
      tools.set(name, { description, schema, handler })
    },
  }
  registerGuiTools(fake as never)
  return tools
}

let tools: Map<string, Captured>

async function call(name: string, args: unknown) {
  const t = tools.get(name)
  if (!t) throw new Error(`没有注册 ${name}`)
  const r = await t.handler(args)
  return JSON.parse(r.content[0].text)
}

function withChannel(...answers: Outcome[]) {
  setUiForTest(new Interact().register(new ScriptedChannel(answers)))
}

beforeEach(() => {
  tools = capture()
})
afterEach(() => {
  delete process.env[ENV]
  setUiForTest(undefined)
})

describe('注册契约', () => {
  it('五种交互都有对应工具', () => {
    expect([...tools.keys()].sort()).toEqual([
      'gui_confirm',
      'gui_form',
      'gui_notify',
      'gui_select',
      'gui_show',
    ])
  })

  it('gui_form 的 type 枚举里没有 password —— 别把它「顺手补回来」', () => {
    // MCP 工具的返回值按定义进模型上下文，在这里收密码等于写进对话记录，
    // 恰好是这个功能存在理由的反面。要收密码请直接用 SDK。
    const raw = JSON.stringify(tools.get('gui_form')!.schema)
    expect(raw).not.toContain('password')
    // 描述里必须说清为什么，否则模型只会以为是漏了
    expect(tools.get('gui_form')!.description).toMatch(/password/i)
    expect(tools.get('gui_form')!.description).toMatch(/SDK/)
  })

  it('gui_confirm 的描述要讲明批准不是模型能自己给的', () => {
    const d = tools.get('gui_confirm')!.description
    expect(d).toMatch(/cannot supply it yourself/i)
    expect(d).toMatch(/irreversible/i)
  })

  it('gui_notify 说清它是单向的 —— 别拿它当提问', () => {
    expect(tools.get('gui_notify')!.description).toMatch(/one-way/i)
  })
})

describe('off 的时候老实拒绝，不挂住', () => {
  it.each([
    ['gui_notify', { title: 'T', message: 'M' }, 'delivered'],
    ['gui_show', { title: 'T', markdown: 'x' }, 'shown'],
    ['gui_confirm', { title: 'T', message: 'M' }, 'approved'],
    ['gui_select', { title: 'T', options: [{ value: 'a', label: 'A' }] }, 'picked'],
    ['gui_form', { title: 'T', fields: [{ name: 'a', label: 'A' }] }, 'value'],
  ])('%s', async (name, args, key) => {
    delete process.env[ENV]
    withChannel(answer.accept())     // 有答案也不该被取用
    const r = await call(name, args)
    expect(r.reason).toMatch(/HARNESS_GUI/)
    expect(r[key]).toBeFalsy()
  })
})

describe('gui_confirm', () => {
  it('只有 accept 才算批准', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept())
    await expect(call('gui_confirm', { title: 'T', message: 'M' })).resolves.toMatchObject({
      action: 'accept',
      approved: true,
    })
  })

  it('取消 / 超时都不算批准，且 action 能分辨', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.cancel())
    expect(await call('gui_confirm', { title: 'T', message: 'M' })).toMatchObject({
      action: 'cancel',
      approved: false,
    })
    withChannel(answer.timeout())
    const t = await call('gui_confirm', { title: 'T', message: 'M' })
    expect(t).toMatchObject({ action: 'timeout', approved: false })
    expect(t.note).toMatch(/nobody answered/i)
  })

  it('没有通道时告诉模型「什么都没显示」，别让它以为人看过了', async () => {
    process.env[ENV] = 'on'
    setUiForTest(new Interact())
    const r = await call('gui_confirm', { title: 'T', message: 'M' })
    expect(r).toMatchObject({ action: 'unsupported', approved: false })
    expect(r.note).toMatch(/Nothing was shown/i)
  })

  it('带 preview 时不多消耗一个答案', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept())   // 只有给 confirm 的这一个
    await expect(
      call('gui_confirm', { title: 'T', message: 'M', markdown: '待删 12 行' }),
    ).resolves.toMatchObject({ approved: true })
  })
})

describe('gui_show', () => {
  it('markdown 和 table 都没给就直说，不是静默成功', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept())
    const r = await call('gui_show', { title: 'T' })
    expect(r.shown).toBe(false)
    expect(r.reason).toMatch(/markdown or table/)
  })

  it('table 走结构化内容，不用先转 markdown', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept())
    await expect(
      call('gui_show', { title: 'T', table: { columns: ['a'], rows: [['1']] } }),
    ).resolves.toMatchObject({ shown: true })
  })
})

describe('gui_select / gui_form 把值带回来', () => {
  it('select 回传 value', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept('prod'))
    await expect(
      call('gui_select', {
        title: 'T',
        options: [
          { value: 'staging', label: 'staging' },
          { value: 'prod', label: 'production' },
        ],
      }),
    ).resolves.toMatchObject({ action: 'accept', value: 'prod' })
  })

  it('form 回传各字段', async () => {
    process.env[ENV] = 'on'
    withChannel(answer.accept({ env: 'prod', n: 3 }))
    await expect(
      call('gui_form', {
        title: 'T',
        fields: [
          { name: 'env', label: 'Env' },
          { name: 'n', label: 'N', type: 'number' },
        ],
      }),
    ).resolves.toMatchObject({ value: { env: 'prod', n: 3 } })
  })
})
