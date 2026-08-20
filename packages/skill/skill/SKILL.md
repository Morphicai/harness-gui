---
name: harness-gui
description: |
    Reach the human operating this session — show them something, ask them to
    approve an action, let them pick or fill something in. Use this when an
    action is irreversible or outward-facing (deleting data, sending a message,
    spending money, touching production), when output is too long or too visual
    for a chat reply, or when only they hold the information you need. Requires
    the harness-gui MCP server.
allowed-tools:
    - mcp__harness-gui__gui_notify
    - mcp__harness-gui__gui_show
    - mcp__harness-gui__gui_confirm
    - mcp__harness-gui__gui_select
    - mcp__harness-gui__gui_form
---

# harness-gui — reaching the human

You have a channel to the person operating this session. It lands on a surface
they are actually looking at — a terminal, a browser tab, or a native window —
not in this transcript.

Tool names are `mcp__<server>__<name>`; the server prefix is whatever the host
config uses (commonly `harness-gui`). This doc writes the bare name.

## First: should you be asking at all?

**Default to deciding yourself.** Their attention is the scarce resource, and an
agent that confirms every step is worse than one that just does the work. Make
routine judgment calls, note your assumptions in your reply, keep going.

Reach for them when one of these is true:

| Reach out | Because |
|---|---|
| The action is **irreversible or outward-facing** | deleting data, sending a message, publishing, spending money, touching production. Undo is not available afterwards |
| Two readings of the request lead to **materially different work** | guessing wrong wastes more of their time than asking does |
| Only they have the information | a verification code, a preference not in the repo, which of two prod databases they meant |
| The output is long or visual | a table, a diff, a report — see `gui_show` |

Do **not** reach out for: permission you already have, confirmations of things
you just did, progress check-ins, "does this look right?" after each step, or
questions you could answer by reading the code.

**One good ask beats three timid ones.** If you need three things, use one
`gui_form`, not three sequential `gui_confirm`s. Every round trip is another
context switch for them.

## The five tools

### `gui_confirm` — approve before acting

```
gui_confirm({
  title: "Drop 12 rows from customers?",
  message: "Soft delete — recoverable from row history for 30 days.",
  markdown: "| id | name |\n|---|---|\n| 41 | ACME |\n| 42 | Globex |",
  danger: true
})
→ { action: "accept", approved: true }
```

Pass the thing being approved as `markdown` or `table`. **Let them see what they
are approving** — "delete 12 rows" and "delete *these* 12 rows" are different
decisions, and only one of them is informed.

State the consequence plainly in `message`, including what is *not* recoverable.
Do not soften it. If you would not want to read a vague warning before losing
data, do not write one.

### `gui_show` — put something in front of them

For anything long or structured: a table, a summary, a report, a diff. It renders
properly, it can be long, and **it does not consume your context** — which makes
it strictly better than pasting a 200-row table into your reply.

Set `awaitAck: true` only when your next step depends on them having read it.
Otherwise it returns immediately.

### `gui_notify` — one-way, no answer

"The migration finished." "The deploy is live." Returns immediately; nothing comes
back. Never use it to ask something — you will wait forever for an answer that
was never collected.

### `gui_select` — one choice from a few

For a decision only they can make: which environment, which of two candidate
fixes. Two to six options reads best. Give each a `description` when the label
alone does not carry the tradeoff.

### `gui_form` — several fields at once

Use this instead of a chain of separate asks. Field types: `text`, `number`,
`select`, `boolean`.

**No password fields here.** An MCP tool result goes into your context by
definition, so collecting a secret through this tool writes it into the
transcript — the exact thing an out-of-band prompt exists to prevent. If a
program needs a secret, it should call the `harness-gui` SDK directly, where the
value goes to the process and never to a model. Do not work around this by
asking for the secret in plain chat instead.

## Reading the answer

Every tool resolves to one of four actions. There is no exception path:

| `action` | What happened | What you do |
|---|---|---|
| `accept` | They answered. `value` holds it for select/form | proceed |
| `cancel` | They declined, or closed the surface | **stop.** Report that it was declined |
| `timeout` | Nobody answered in time | **stop.** Say nobody answered |
| `unsupported` | No channel could reach anyone — nothing was shown | **stop**, and say the request never reached a person |

`timeout` and `cancel` are reported separately on purpose: "nobody is there" and
"the answer is no" are different facts. Report which one you got — it is the
difference between "try again later" and "they said no".

### Three things never to do

1. **Never treat anything but `accept` as approval.** Not `unsupported`, not a
   timeout, not "they probably would have said yes".
2. **Never re-ask the same question hoping for a different answer.** A decline is
   an answer. Asking again is pestering, and on a `timeout` it just means nobody
   is there.
3. **Never route around a decline.** If they refuse `DROP TABLE`, do not go find
   a `DELETE FROM` that achieves the same thing. The refusal was about the
   outcome, not the syntax.

## Why the approval has to come from here

A `confirm: true` tool parameter is not a guardrail — *you can fill that in
yourself*, and the rejection message usually teaches you how. These tools exist
because you can construct a request but cannot construct a human's approval.
That asymmetry is the whole point; treat it as load-bearing rather than as
friction to minimize.

## If the tools are not there

The server is registered as an MCP server and gated by an env var:

```bash
npx harness-gui-skill mcp --claude-code     # prints the claude mcp add command
npx harness-gui-skill mcp                   # prints the JSON snippet
```

```jsonc
{
  "mcpServers": {
    "harness-gui": {
      "command": "npx",
      "args": ["harness-gui-mcp"],
      "env": { "HARNESS_GUI": "on" }
    }
  }
}
```

`HARNESS_GUI` defaults to `off`, and every tool then returns a plain refusal
instead of reaching anyone. That default is deliberate: a server cannot tell
whether a person is watching. Under stdio transport `stdin` is the protocol
channel, not a terminal, so terminal detection is meaningless — and the daemon
channel is always nominally "available", so it would open an unwatched window and
wait out the timeout. In a headless environment that is not degrading, it is
hanging.

Set it to `strict` when the session must stop rather than proceed unapproved.

For calling this from your own Node code instead of as an agent:
**https://github.com/Morphicai/harness-gui**
