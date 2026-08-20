# @harness-gui/skill

**Teach an agent when and how to reach the human.**

A playbook (`SKILL.md`) for agents that have the
[`@harness-gui/mcp`](https://www.npmjs.com/package/@harness-gui/mcp) server
available. Installs into Claude Code, Cursor, Kiro, or anywhere that reads a
markdown instruction file.

```bash
npx @harness-gui/skill install          # → ~/.claude/skills/harness-gui/
npx @harness-gui/skill mcp --claude-code # → the `claude mcp add` command
```

User scope is the default on purpose: *whether to interrupt a person* is not a
per-repository decision, so installing once covers every project.

## Commands

```
harness-gui-skill install [target] [--force]   install SKILL.md
harness-gui-skill mcp [--claude-code]          print the MCP server config
harness-gui-skill print                        dump SKILL.md to stdout
harness-gui-skill where                        print SKILL.md's absolute path
```

| Target | Lands at |
|---|---|
| `claude-code` *(default)* | `~/.claude/skills/harness-gui/SKILL.md` |
| `claude-code-project` | `.claude/skills/harness-gui/SKILL.md` |
| `cursor` | `.cursor/rules/harness-gui.mdc` (YAML frontmatter stripped) |
| `kiro` | `.kiro/agents/harness-gui.md` |
| `plain` | `HARNESS_GUI_SKILL.md` |

Installing refuses to overwrite; pass `--force` when you mean it.

## Two things it needs to actually work

1. **The MCP server has to be registered** — the skill describes tools; it does
   not provide them.
2. **`HARNESS_GUI=on`** in the server's environment. It defaults to `off`, and
   every tool then returns a plain refusal. That default is deliberate: a server
   cannot tell whether a person is watching, and guessing wrong in a headless
   environment means hanging, not degrading.

## What the skill actually teaches

Most of it is *when not to ask*. An agent that confirms every step is worse than
one that just does the work, so the playbook leads with the judgment call —
reach out for irreversible or outward-facing actions, genuine ambiguity, and
information only the human holds; not for permission you already have or
progress check-ins. Then the three hard rules: only `accept` is approval, never
re-ask hoping for a different answer, and never route around a decline.

## Programmatic use

```js
import { readSkill, SKILL_PATH, mcpConfig } from '@harness-gui/skill'
```

## License

MIT
