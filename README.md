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
| **MCP** | agents / LLM hosts (Claude Code, Cursor, …) | `harness-gui-mcp`, stdio transport |

## Architecture

```
                    ┌──────────────────────┬──────────────────────┐
    consumers       │  any Node program    │  agent / LLM host    │
                    │  CLI · service       │  Claude Code · …     │
                    └──────────┬───────────┴──────────┬───────────┘
                               │ SDK                  │ MCP
                               │ import 'harness-gui' │ harness-gui-mcp
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

## Platforms

The core and the first three channels are platform-independent. The native shell ships per
platform.

| | macOS | Windows | Linux |
|---|---|---|---|
| protocol · scripted · tty | ✅ | ✅ | ✅ |
| web channel | ✅ | ✅ | ✅ |
| daemon IPC | Unix socket | named pipe | Unix socket |
| **native shell** | ✅ | planned | planned |

Prebuilt shells ride along as `optionalDependencies` with `os`/`cpu` constraints, so npm
installs only the one matching your machine — **no build step for consumers**. Failing to
install one is not fatal; it maps exactly onto "no shell, use the browser".

```
harness-gui
├─ harness-gui-shell-darwin-arm64   ┐
├─ harness-gui-shell-darwin-x64     ├ optionalDependencies
└─ harness-gui-shell-win32-x64      ┘
```

Override discovery with `HARNESS_GUI_APP=/path/to/Interact.app`.

### Windows notes

- **Edge WebView2 Runtime is not guaranteed to exist** (preinstalled on Win11 and recent
  Win10; absent on older machines). Without it the shell would open a white window, so it
  is detected up front and reported as unavailable instead.
- **Bundle shape differs**: on macOS the binary lives at `X.app/Contents/MacOS/…` and the
  working directory must sit *outside* the bundle (the shell resolves resources relatively);
  on Windows the `.exe` is the binary. That difference is contained in one resolver.

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
