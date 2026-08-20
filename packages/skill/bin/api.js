/**
 * 以编程方式取用打包进来的 SKILL.md。
 *
 *   import { SKILL_PATH, readSkill } from 'harness-gui-skill'
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 包里那份 SKILL.md 的绝对路径 */
export const SKILL_PATH = resolve(here, '..', 'skill', 'SKILL.md')

/** 读成 UTF-8 字符串 */
export function readSkill() {
  return readFileSync(SKILL_PATH, 'utf-8')
}

/**
 * @typedef {'project' | 'user'} Scope
 * @typedef {{ scope: Scope, path: string, frontmatter: boolean }} Target
 * @typedef {Target & { dest: string, display: string }} ResolvedTarget
 */

/**
 * 已知的安装位置。
 *
 * `scope` 决定相对谁：`project` 相对当前目录，`user` 相对 home。
 * harness-gui 是跨项目工具 —— 「要不要问人」这件事不随仓库变 —— 所以
 * 默认装到 user scope，装一次到处生效，而不是每个仓库各来一份副本。
 *
 * `frontmatter: false` 的目标用自己的格式，装的时候会把 YAML 头去掉。
 */
/** @type {Record<string, Target>} */
export const INSTALL_TARGETS = {
  'claude-code': { scope: 'user', path: '.claude/skills/harness-gui/SKILL.md', frontmatter: true },
  'claude-code-project': { scope: 'project', path: '.claude/skills/harness-gui/SKILL.md', frontmatter: true },
  cursor: { scope: 'project', path: '.cursor/rules/harness-gui.mdc', frontmatter: false },
  kiro: { scope: 'project', path: '.kiro/agents/harness-gui.md', frontmatter: true },
  plain: { scope: 'project', path: 'HARNESS_GUI_SKILL.md', frontmatter: false },
}

/**
 * 某个目标该落在哪；未知目标返回 null（不猜路径）。
 * @param {string} target
 * @returns {ResolvedTarget | null}
 */
export function resolveTarget(target) {
  const t = INSTALL_TARGETS[target]
  if (!t) return null
  const root = t.scope === 'user' ? homedir() : process.cwd()
  return { ...t, dest: join(root, t.path), display: t.scope === 'user' ? `~/${t.path}` : t.path }
}

/**
 * 去掉 YAML frontmatter，正文原样保留。
 * @param {string} raw
 * @returns {string}
 */
export function stripFrontmatter(raw) {
  return raw.replace(/^---[\s\S]*?\n---\n+/, '')
}

/**
 * 注册 MCP server 用的配置片段。
 *
 * skill 光装上没用 —— 工具得先存在。HARNESS_GUI 必须显式给：
 * 服务端无从判断此刻有没有人在看，默认是关的。
 *
 * @returns {{ mcpServers: Record<string, { command: string, args: string[], env: Record<string, string> }> }}
 */
export function mcpConfig() {
  return {
    mcpServers: {
      'harness-gui': {
        command: 'npx',
        args: ['harness-gui-mcp'],
        env: { HARNESS_GUI: 'on' },
      },
    },
  }
}
