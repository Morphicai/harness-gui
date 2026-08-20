# harness-gui

**A bridge between your program and a human.**

Automation eventually hits a moment that needs a person — look at this, approve that, type
the code that shouldn't pass through a model. `harness-gui` owns that moment.

Five interactions, one protocol, several channels. Your code doesn't know or care whether
the human answered in a terminal, a browser tab, or a native window.

Zero runtime dependencies.

```bash
npm i harness-gui
```

```ts
import { createInteract } from 'harness-gui'

const ui = createInteract()

await ui.notify({ title: 'Deploy finished', message: 'v2.4.0 is live' })

const r = await ui.confirm({
  title: 'Drop 12 rows?',
  message: 'Soft delete — recoverable from history.',
  danger: true,
})
if (r.action !== 'accept') return

const form = await ui.form({
  title: 'Sign in',
  fields: [
    { name: 'code', label: 'Verification code', type: 'password', required: true },
  ],
})
// form.value.code never went through your LLM's context
```

## Outcomes

Every interaction resolves to one of four actions — there is no throw-on-decline:

| `action` | Means |
|---|---|
| `accept` | The human answered. `value` is populated for `select` / `form` |
| `cancel` | The human declined, or closed the surface |
| `timeout` | Nobody answered within `timeoutMs` |
| `unsupported` | No channel could reach a human at all |

`timeout` and `cancel` are deliberately distinct: "nobody is there" and "the answer is no"
are different facts, and collapsing them makes failures hard to diagnose.

## Approval gate

For tools that an LLM calls, `requireApproval` is the intended entry point:

```ts
import { requireApproval } from 'harness-gui'

await requireApproval({
  action: 'delete rows',
  title: 'Drop 12 rows?',
  message: 'Soft delete — recoverable from history.',
  danger: true,
})
// throws ApprovalDeniedError unless a human said yes
```

A `confirm: true` tool parameter is not a guardrail — *the model can fill that in itself*,
and the error text usually teaches it how. A model can construct a request; it cannot
construct a human's approval.

Gated by `HARNESS_GUI`: `off` (default — no interaction at all), `on` (ask; proceed if no
channel can reach anyone), `strict` (ask; refuse if no channel can reach anyone). It
defaults to `off` because a library cannot tell whether anyone is watching, and guessing
wrong in a headless environment means hanging, not degrading.

## Channels

Picked automatically by capability; register your own to override.

| Channel | Reaches the human via |
|---|---|
| `scripted` | canned answers — for tests |
| `tty` | the terminal |
| `web` | a loopback HTTP page, one-shot token, closes after |
| `daemon` | a single shared instance, so parallel callers don't each open a window |

The daemon can host the page in a native window instead of your browser, buying system
notifications, a tray presence, and surviving a window close. Point
`HARNESS_GUI_APP=/path/to/Interact.app` at a shell to enable it; without one, the browser
is used and the reason is logged.

## Also in this project

- `harness-gui-mcp` — the same five interactions as MCP tools, for agents and LLM hosts

Architecture, design rules, platform matrix and the inbound-invocation design:
**https://github.com/Morphicai/harness-gui**

## License

MIT
