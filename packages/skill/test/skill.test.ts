/**
 * skill 包的用例。
 *
 * 这个包没有运行时逻辑，所以测的是**一致性**：SKILL.md 里写的工具名必须和
 * MCP 实际注册的一致，安装路径必须落在该落的地方。
 * 前者是重点 —— 改一个工具名而不改 SKILL.md，skill 会静默过期，
 * 而 agent 那边表现成「工具不存在」，很难联想到是文档没跟上。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  SKILL_PATH,
  readSkill,
  INSTALL_TARGETS,
  resolveTarget,
  stripFrontmatter,
  mcpConfig,
} from '../bin/api.js'
import { registerGuiTools } from '../../mcp/src/tools.js'

/** MCP 那边真正注册了哪些工具 */
function registeredTools(): string[] {
  const names: string[] = []
  registerGuiTools({ tool: (n: string) => void names.push(n) } as never)
  return names.sort()
}

describe('SKILL.md 与 MCP 工具保持一致', () => {
  const raw = readSkill()

  it('frontmatter 齐全', () => {
    expect(raw.startsWith('---\n')).toBe(true)
    expect(raw).toMatch(/^name: harness-gui$/m)
    expect(raw).toMatch(/^description: \|$/m)
  })

  it('allowed-tools 与实际注册的工具一一对应', () => {
    const declared = [...raw.matchAll(/^\s+- mcp__harness-gui__(\w+)$/gm)].map(m => m[1]).sort()
    expect(declared).toEqual(registeredTools())
  })

  it('正文里提到的每个工具都真的存在', () => {
    const body = stripFrontmatter(raw)
    for (const t of registeredTools()) {
      expect(body).toContain(t)
    }
    // 反向：正文里不能出现没注册的 gui_* 名字（改名后的残留）
    const mentioned = new Set([...body.matchAll(/\bgui_[a-z_]+/g)].map(m => m[0]))
    for (const m of mentioned) {
      expect(registeredTools()).toContain(m)
    }
  })

  it('把三条硬规则写进去了 —— 它们是这个 skill 存在的理由', () => {
    const body = stripFrontmatter(raw)
    expect(body).toMatch(/never.*approval/i)           // 只有 accept 算批准
    expect(body).toMatch(/re-ask|asking again/i)       // 别反复问
    expect(body).toMatch(/route around|refusal/i)      // 别绕过拒绝
    expect(body).toMatch(/HARNESS_GUI/)                // 门控说明
  })

  it('说清 gui_form 不收 password，并给出替代路径', () => {
    const body = stripFrontmatter(raw)
    expect(body).toMatch(/password/i)
    expect(body).toMatch(/SDK/)
  })
})

describe('安装目标', () => {
  it('默认目标是 user scope —— 「要不要问人」不随仓库变', () => {
    expect(INSTALL_TARGETS['claude-code'].scope).toBe('user')
    const t = resolveTarget('claude-code')!
    expect(t.dest).toBe(join(homedir(), '.claude/skills/harness-gui/SKILL.md'))
    expect(t.display.startsWith('~/')).toBe(true)
  })

  it('项目级目标落在 cwd 下', () => {
    const t = resolveTarget('claude-code-project')!
    expect(t.dest).toBe(join(process.cwd(), '.claude/skills/harness-gui/SKILL.md'))
    expect(t.display).not.toContain('~')
  })

  it('未知目标返回 null，而不是猜一个路径', () => {
    expect(resolveTarget('windsurf')).toBeNull()
  })

  it('用自有格式的目标要去掉 YAML 头', () => {
    expect(INSTALL_TARGETS.cursor.frontmatter).toBe(false)
    const stripped = stripFrontmatter(readSkill())
    expect(stripped.startsWith('---')).toBe(false)
    expect(stripped).toMatch(/^# harness-gui/)
    // 正文不能被切掉
    expect(stripped.length).toBeGreaterThan(2000)
  })
})

describe('mcpConfig', () => {
  it('给出的命令能直接跑，且显式打开 HARNESS_GUI', () => {
    const c = mcpConfig().mcpServers['harness-gui']
    expect(c.command).toBe('npx')
    expect(c.args).toEqual(['harness-gui-mcp'])
    // 不显式给就是 off，装了 skill 却每个工具都拒绝，最难排查
    expect(c.env.HARNESS_GUI).toBe('on')
  })
})

describe('SKILL_PATH', () => {
  it('指向包里那份，读得到', () => {
    expect(SKILL_PATH).toMatch(/packages\/skill\/skill\/SKILL\.md$/)
    expect(readFileSync(SKILL_PATH, 'utf-8')).toBe(readSkill())
  })
})
