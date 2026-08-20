#!/usr/bin/env node
/**
 * @harness-gui/skill —— 把 SKILL.md 装到各家 agent 的位置去。
 *
 *   install [target] [--force]   装过去
 *   mcp [--claude-code]          打印 MCP server 注册片段
 *   print                        把 SKILL.md 打到 stdout
 *   where                        打印包里 SKILL.md 的绝对路径
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { INSTALL_TARGETS, SKILL_PATH, readSkill, resolveTarget, stripFrontmatter, mcpConfig } from './api.js'

const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'help'
const flags = new Set(argv.filter(a => a.startsWith('--')))
const positional = argv.slice(1).filter(a => !a.startsWith('--'))

function help() {
  /** @type {string[]} */
  const lines = []
  for (const k of Object.keys(INSTALL_TARGETS)) {
    const t = resolveTarget(k)
    if (t) lines.push(`  ${k.padEnd(21)} → ${t.display}`)
  }
  const rows = lines.join('\n')
  process.stdout.write(`@harness-gui/skill — teach an agent when and how to reach the human

Usage:
  harness-gui-skill install [target] [--force]   install SKILL.md
  harness-gui-skill mcp [--claude-code]          print the MCP server config snippet
  harness-gui-skill print                        dump SKILL.md to stdout
  harness-gui-skill where                        print SKILL.md's absolute path

Targets (default claude-code — user scope, so it applies to every project):
${rows}

Examples:
  npx @harness-gui/skill install                  # → ~/.claude/skills/harness-gui/
  npx @harness-gui/skill install claude-code-project
  npx @harness-gui/skill install cursor
  npx @harness-gui/skill mcp                      # copy into your MCP config

The skill needs the tools to exist: register @harness-gui/mcp too (see \`mcp\`),
and set HARNESS_GUI=on — it is off by default because a server cannot tell
whether anyone is watching.
`)
}

function install(target = 'claude-code') {
  const t = resolveTarget(target)
  if (!t) {
    process.stderr.write(`unknown target "${target}". Try: ${Object.keys(INSTALL_TARGETS).join(', ')}\n`)
    process.exit(2)
  }
  if (existsSync(t.dest) && !flags.has('--force')) {
    process.stderr.write(`${t.display} already exists. Pass --force to overwrite.\n`)
    process.exit(1)
  }
  mkdirSync(dirname(t.dest), { recursive: true })
  const raw = readSkill()
  writeFileSync(t.dest, t.frontmatter ? raw : stripFrontmatter(raw), 'utf-8')
  process.stdout.write(`installed → ${t.display}\n`)
  process.stdout.write(`\nNext: register the MCP server (\`npx @harness-gui/skill mcp\`) and set HARNESS_GUI=on.\n`)
  if (target.startsWith('claude-code')) {
    process.stdout.write(`Claude Code picks up new skills on the next session.\n`)
  }
}

function mcp() {
  const cfg = mcpConfig()
  if (flags.has('--claude-code')) {
    // Claude Code 的 CLI 直接吃这条，不用手编 JSON
    process.stdout.write(
      `claude mcp add harness-gui --env HARNESS_GUI=on -- npx @harness-gui/mcp\n`,
    )
    return
  }
  process.stdout.write(JSON.stringify(cfg, null, 2) + '\n')
}

switch (cmd) {
  case 'install':
    install(positional[0])
    break
  case 'mcp':
    mcp()
    break
  case 'print':
    process.stdout.write(readSkill())
    break
  case 'where':
    process.stdout.write(SKILL_PATH + '\n')
    break
  case 'help':
  case '--help':
  case '-h':
    help()
    break
  default:
    process.stderr.write(`unknown command "${cmd}"\n\n`)
    help()
    process.exit(2)
}
