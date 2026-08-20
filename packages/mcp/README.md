# harness-gui-mcp

**MCP server that lets an agent reach the human — out of band.**

Five tools: notify, show, confirm, select, form. The answer comes from a person on a
separate surface (a terminal, a browser tab, or a native window), so it is not something the
model can fill in for itself.

```bash
npx harness-gui-mcp        # stdio transport
```

Register it with your host:

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

## Tools

| Tool | For |
|---|---|
| `gui_notify` | "the long job finished" — one-way, returns immediately |
| `gui_show` | put a table / summary / document in front of them to read |
| `gui_confirm` | **gate anything irreversible or outward-facing** before doing it |
| `gui_select` | let them pick when a wrong guess would be costly |
| `gui_form` | collect several fields at once |

`gui_show` is also the right place for long or richly formatted output: it renders properly
and **does not consume your context**.

## `HARNESS_GUI` must be set

Without `HARNESS_GUI=on` (or `strict`) every tool returns a plain refusal instead of
reaching anyone. It defaults to off because a server cannot tell whether anyone is watching:
under stdio transport `stdin` is the protocol channel, not a terminal, so TTY detection is
meaningless — and the daemon channel is always nominally "available", so it would spin up an
unwatched window and wait out the timeout. In a headless environment that is not degrading,
it is hanging.

## Why a `confirm: true` parameter is not a guardrail

*The model can fill that in itself*, and the rejection message usually teaches it how
("pass confirm=true if that is what you want"). A model can construct a request; it cannot
construct a human's approval. `gui_confirm` exists to make that distinction real.

Treat anything other than `action: "accept"` as "do not proceed". `timeout` and `cancel` are
reported separately on purpose — "nobody is there" and "the answer is no" are different
facts.

## One deliberate limitation: no password fields

The SDK's `form` supports `password` fields so a human can type something that **never
enters a model's context** — a verification code, say — and the value goes straight to the
calling process.

An MCP tool result, by definition, goes into your context. Collecting a secret here would
write it into the transcript, which is the exact thing the feature exists to prevent. So
`gui_form` rejects `password` fields and says why. A program that needs a secret should use
the [`harness-gui`](https://www.npmjs.com/package/harness-gui) SDK directly.

## Also in this project

- `harness-gui` — the SDK, for any Node program. Zero runtime dependencies.

Architecture, design rules and platform matrix:
**https://github.com/Morphicai/harness-gui**

## License

MIT
