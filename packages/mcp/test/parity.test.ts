/**
 * 能力对等 —— MCP 层不能比 SDK 更能干。
 *
 * 立场：**关键能力放在 core**，MCP 只是适配层。这条一旦破了，
 * 想直接用 SDK 的人就得自己把 MCP 里的逻辑抄一遍，而抄出来的那份
 * 迟早和这边分叉（模式门控、timeout/cancel 的区分、批准的抛错语义都不好抄对）。
 *
 * 所以这里机械核对：MCP 的每个工具做的事，SDK 都有对应入口。
 */
import { describe, it, expect } from 'vitest'
import * as sdk from 'harness-gui'
import { registerGuiTools } from '../src/tools.js'

function toolNames(): string[] {
  const names: string[] = []
  registerGuiTools({ tool: (n: string) => void names.push(n) } as never)
  return names
}

/** 每个 MCP 工具靠 SDK 的哪个入口实现 */
const BACKED_BY: Record<string, string[]> = {
  gui_notify: ['notify'],
  gui_show: ['show'],
  gui_confirm: ['confirm'],
  gui_select: ['select'],
  gui_form: ['form'],
}

describe('MCP 的每个工具在 SDK 上都有对应入口', () => {
  it('工具集合与映射表一致 —— 加了工具却没登记会红', () => {
    expect(toolNames().sort()).toEqual(Object.keys(BACKED_BY).sort())
  })

  it('映射到的 Interact 方法都真的存在', () => {
    const proto = sdk.Interact.prototype as unknown as Record<string, unknown>
    for (const [tool, methods] of Object.entries(BACKED_BY)) {
      for (const m of methods) {
        expect(typeof proto[m], `${tool} → Interact#${m}`).toBe('function')
      }
    }
  })
})

describe('SDK 侧该有的东西都导出了', () => {
  it('批准闸门与它的辅助', () => {
    for (const k of ['requireApproval', 'askText', 'showToUser', 'asContent', 'setUi', 'getUi', 'interactMode']) {
      expect(typeof (sdk as Record<string, unknown>)[k], k).toBe('function')
    }
    expect(typeof sdk.ApprovalDeniedError).toBe('function')
  })

  it('内容构造：MCP 能收 markdown/table，SDK 也要能', () => {
    // MCP 的 toContent 是私有辅助，SDK 侧的等价物是 asContent + markdownToContent
    expect(typeof sdk.asContent).toBe('function')
    expect(typeof sdk.markdownToContent).toBe('function')
  })

  it('批准层能被指向调用方自己的实例 —— 否则 SDK 用户只能自己重写一遍', () => {
    // 签名层面：ui 参数存在。运行时行为在 core 的 approval.test.ts 里覆盖
    expect(sdk.requireApproval.length).toBeGreaterThan(0)
  })

  it('通道、daemon、原生壳、多语言都在 SDK 上', () => {
    for (const k of ['TtyChannel', 'WebChannel', 'ScriptedChannel', 'DaemonChannel', 'Daemon',
                     'createInteract', 'setLocale', 'resolveMessages', 'launchNativeShell']) {
      expect((sdk as Record<string, unknown>)[k], k).toBeTruthy()
    }
  })

  it('SDK 独有的能力：收密码。MCP 刻意没有，所以只能从这边拿', () => {
    // askText({ secret: true }) 是唯一不经过模型上下文的取值路径
    expect(typeof sdk.askText).toBe('function')
    const raw = registerGuiToolsSchema()
    expect(JSON.stringify(raw)).not.toContain('password')
  })
})

function registerGuiToolsSchema() {
  const schemas: unknown[] = []
  registerGuiTools({
    tool: (_n: string, _d: string, schema: unknown) => void schemas.push(schema),
  } as never)
  return schemas
}
