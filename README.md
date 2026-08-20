# harness-gui

**A bridge between your program and a human.**

Automation eventually hits a moment that needs a person — look at this, approve that, type
the code that shouldn't pass through a model. `harness-gui` owns that moment.

Five interactions, one protocol, several channels. Your code doesn't know or care whether
the human answered in a terminal, a browser tab, or a native window.

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
    { name: 'env', label: 'Environment', type: 'select', options: [
      { label: 'staging', value: 'staging' }, { label: 'production', value: 'prod' }] },
    { name: 'code', label: 'Verification code', type: 'password', required: true },
  ],
})
// form.value.code never went through your LLM's context
```

## Two ways to use it

| | Who | How |
|---|---|---|
| **SDK** | any Node program — CLI, service, script | `npm i harness-gui` |
| **MCP** | agents / LLM hosts (Claude Code, Cursor, …) | `@harness-gui/mcp`, stdio transport |

Agents also get a playbook — mostly about *when not to ask*, since an agent that
confirms every step is worse than one that just does the work:

```bash
npx @harness-gui/skill install            # → ~/.claude/skills/harness-gui/
npx @harness-gui/skill mcp --claude-code  # → the `claude mcp add` command
```

## A scenario

An agent is cleaning up a `customers` table. It has found 12 stale rows and is
about to drop them. This is the moment the whole library exists for.

**1. It asks — and attaches what it is asking about.**

```ts
gui_confirm({
  title: 'Drop 12 rows from customers?',
  message: 'Soft delete — recoverable from row history for 30 days. '
         + 'Two rows have open invoices.',
  table: {
    columns: ['id', 'name', 'last_seen', 'open_invoices'],
    rows: [[41, 'ACME Corp', '2024-03-02', 2], [42, 'Globex', '2023-11-18', 0]],
  },
  danger: true,
})
```

"Delete 12 rows" and "delete *these* 12 rows" are different decisions, and only
one of them is informed. Passing the payload is not decoration.

**2. A person sees it — on a surface, not in a transcript.**

```
┌─ Drop 12 rows from customers? ──────────────────────────────┐
│                                                             │
│  Soft delete — recoverable from row history for 30 days.     │
│  Two rows have open invoices.                                │
│                                                             │
│   id   name        last_seen     open_invoices               │
│   41   ACME Corp   2024-03-02                2               │
│   42   Globex      2023-11-18                0               │
│   …                                                          │
│                                                             │
│                                    [ 取消 ]   [ 确认 ]       │
└─────────────────────────────────────────────────────────────┘
```

Terminal, browser tab, or native window — same content, chosen by whichever
channel can currently reach them.

> The title and body come from the caller, so they read in whatever language you
> wrote them in. **The library's own chrome is currently Chinese-only** — buttons,
> validation messages, the terminal prompts. See
> [issues](https://github.com/Morphicai/harness-gui/issues) if that blocks you;
> it is ~20 strings across `channels/web/page.ts` and `channels/tty.ts`.

**3. They notice the open invoices and decline.**

```ts
→ { action: 'cancel', channel: 'web' }
```

**4. The agent stops.**

It reports that the deletion was declined and why it asked. What it must *not*
do is go find a `DELETE FROM` that achieves the same thing — the refusal was
about the outcome, not the syntax. That rule is written into the agent playbook,
because it is the failure mode that matters.

Had nobody been at the keyboard, the answer would have been `timeout` rather
than `cancel` — "nobody is there" and "the answer is no" are different facts, and
the agent reports which one it got.

### The same scenario, one step earlier

The migration needed a 2FA code to connect. Through the SDK:

```ts
const code = await askText({
  title: 'Production database',
  label: 'Verification code',
  secret: true,
})
if (!code) return   // cancelled, timed out, or nobody reachable
```

`code` goes to your process. It never enters a model's context, and it is not in
this transcript — which is why `gui_form` over MCP refuses `password` fields
outright rather than quietly downgrading them to a text box.

## Architecture

```
                    ┌──────────────────────┬──────────────────────┐
    consumers       │  any Node program    │  agent / LLM host    │
                    │  CLI · service       │  Claude Code · …     │
                    └──────────┬───────────┴──────────┬───────────┘
                               │ SDK                  │ MCP
                               │ import 'harness-gui' │ @harness-gui/mcp
                    ┌──────────▼──────────────────────▼───────────┐
                    │              harness-gui                    │
                    │          zero deps · cross-platform         │
                    │                                             │
                    │  protocol  notify show confirm select form  │
                    │  outcome   accept │ cancel │ timeout │      │
                    │                        unsupported          │
                    │                                             │
                    │  content   T1 declarative (markdown/table/  │
                    │              chart/diff/image — every       │
                    │              channel can render it)         │
                    │            T2 raw HTML (browser-class only, │
                    │              fallback REQUIRED)             │
                    └──────────────────┬──────────────────────────┘
                                       │ picks by supports()
        ┌───────────┬──────────────┬───┴────────────┬──────────────┐
        │ scripted  │     tty      │      web       │    daemon    │
        │ canned    │   terminal   │ loopback HTTP  │  single      │
        │ answers   │              │ one-shot token │  instance,   │
        │ for tests │              │ closes after   │  shared UI   │
        └─────┬─────┴──────┬───────┴────────┬───────┴──────┬───────┘
              │            │                │              │ can host
              │            │                │       ┌──────▼───────┐
              │            │                │       │ native shell │
              │            │                │       │ notifications│
              │            │                │       │ tray, stays  │
              │            │                │       │ alive on close│
              │            │                │       └──────┬───────┘
              │            │                │              │ same page
              │            │                │              │ as web
              └────────────┴────────────────┴──────────────┘
                                    │
                                    ▼
                                ( human )
```

### Three design rules

**1. The native shell is not a channel.**
It hosts the *same page* the web channel serves, moved from your browser into its own
window — buying three things a browser tab can't give you: system notifications, a tray
presence, and surviving a window close. Protocol, page, and form logic are shared. There is
no second implementation.

**2. Degrade cleanly; fail loudly.**
No channel can reach a human → the outcome is `unsupported`, and the caller decides.
Shell missing or its web engine absent → report *why*, then fall back to the browser.
What is never acceptable is a window that opens, shows white, and never connects — the
fallback path is good, so taking it costs nothing. Being unable to say why costs a lot.

**3. T2 content must carry a fallback.**
Otherwise the same `show` is a chart in a browser and a blank space in a terminal, and the
caller has no idea it lost anything. Throw at development time rather than silently drop
content at runtime.

## Hosts

`browser`, `native` and `electron` are three *carriers of the same page*, not three
implementations. Rule 1 above applies to all of them: protocol, page and form logic exist
once, in the web channel.

| Host | Status | Buys you | Costs |
|---|---|---|---|
| **browser** | ✅ | zero install, every platform, nothing to distribute | no system notifications, no tray, closing the tab ends it |
| **native** (Zig) | ✅ macOS | notifications, tray, survives window close; **tiny** (3–8 MB) | built per platform; **cannot run Node inside the shell** |
| **electron** | planned | all of the above **+ Node executing inside the shell** | ~150 MB+, packaged per platform |

Electron earns its place for exactly one reason: the shell itself can run Node, so work
triggered from the UI can happen in-shell instead of being routed back to the caller. If
you don't need that, native is a twentyfold size difference in your favour.

## Inbound invocation

Everything above is outbound — your program reaches for a human. The reverse direction is
a web page (or an agent running in one) handing a task to the local install.

A page can talk to a running install over loopback, but it cannot *start* one. That gap is
what a registered URL scheme closes:

```
page ──① try loopback ──► running? ──yes──► HTTP/WS, done
     └─② harness-gui://wake ──► OS launches it ──► ③ retry loopback
```

**Payloads do not travel in the URL.** URLs land in browser history, system logs and crash
reports; the scheme carries a wake-up and a short-lived one-shot handshake code, nothing
more.

A registered scheme is invocable by **any** page on that machine, so the caller is treated
as hostile by construction: its origin is displayed *in the UI* rather than kept as
metadata, an unknown origin has to be paired once by the human before its requests render,
and **the caller can never describe what to execute** — only reference a task the human
already installed locally. Allowing otherwise would make a single URL remote code
execution, which matters most precisely on the host that can run Node.

The scheme brings in a *request*, never an instruction — the same reason approval has to be
out-of-band (point 3 below): a model — or a web page — can construct a request; neither
can construct a human's approval.

Remote agents (a machine elsewhere reaching a specific person) cannot use a scheme at all
and need an outbound-dialled relay instead. Design sketch: `docs/hosts-and-invocation.md`.

## Platforms

The core and the first three channels are platform-independent. The native shell ships per
platform.

| | macOS | Windows | Linux |
|---|---|---|---|
| protocol · scripted · tty | ✅ | ✅ | ✅ |
| web channel | ✅ | ✅ | ✅ |
| daemon IPC | Unix socket | named pipe | Unix socket |
| **native shell** | ✅ | planned | planned |
| scheme registration | `CFBundleURLTypes` | `HKCU\Software\Classes` | planned |

Point `HARNESS_GUI_APP=/path/to/Interact.app` at a shell to use it. Without one the browser
is used and the reason is logged — `nativeShellUnavailableReason()` returns it.

**Planned (not yet published):** prebuilt shells riding along as `optionalDependencies` with
`os`/`cpu` constraints, so npm installs only the one matching your machine and consumers
never run a build step. Failing to install one is deliberately non-fatal — it maps exactly
onto "no shell, use the browser".

```
harness-gui
├─ @harness-gui/shell-darwin-arm64  ┐
├─ @harness-gui/shell-darwin-x64    ├ optionalDependencies (planned)
└─ @harness-gui/shell-win32-x64     ┘   pinned to the exact core version
```

The pinning matters: a mismatched shell fails as a window that opens, shows white, and never
connects. `scripts/sync-shell-versions.mjs` keeps the three versions equal to core's, and
refuses to run if core declares shells the repo doesn't have.

### Windows notes

- **Edge WebView2 Runtime is not guaranteed to exist** (preinstalled on Win11 and recent
  Win10; absent on older machines). Without it the shell would open a white window, so it
  is detected up front and reported as unavailable instead.
- **Bundle shape differs**: on macOS the binary lives at `X.app/Contents/MacOS/…` and the
  working directory must sit *outside* the bundle (the shell resolves resources relatively);
  on Windows the `.exe` is the binary. That difference is contained in one resolver.

## The approval gate

For tools an LLM calls, `requireApproval` is the intended entry point:

```ts
import { requireApproval } from 'harness-gui'

await requireApproval({
  action: 'delete rows',
  title: 'Drop 12 rows?',
  message: 'Soft delete — recoverable from history.',
  preview: { type: 'table', columns: ['id', 'name'], rows: [...] },
})
// throws ApprovalDeniedError unless a human said yes
```

Gated by `HARNESS_GUI`: `off` (default), `on` (ask; proceed if no channel can reach anyone),
`strict` (ask; refuse if no channel can reach anyone). Default off because a library cannot
tell whether anyone is watching — under MCP stdio transport `stdin` is the protocol channel,
not a terminal, and the daemon channel is always nominally "available", so it would spin up
an unwatched window and wait out the timeout. In a headless environment that is not
degrading, it is hanging.

`timeout` and `cancel` are reported separately on purpose: "nobody is there" and "the answer
is no" are different facts, and collapsing them makes failures hard to diagnose.

## Why this exists

Three problems plain text conversation cannot solve:

1. **Visuals have nowhere to go.** A table, a diff, a chart — past a few dozen lines of
   plain text it stops being readable.
2. **Secrets shouldn't pass through the model.** "Model asks → human types it into the
   chat → model forwards it to a tool" puts the verification code in the transcript in
   plaintext.
3. **Approval has to be out-of-band.** A `confirm: true` tool parameter is not a guardrail
   — *the model can fill that in itself*, and the error text usually teaches it how. A model
   can construct a request; it cannot construct a human's approval.

## License

MIT
