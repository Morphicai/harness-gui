# 构建原生壳

**已在 darwin-arm64 上验证通过**（2026-08-20，zig 0.16.0 + `@native-sdk/cli` 0.9.0，
产物 3.1 MB）。这份记的是**实测过的**配方 —— CI 照它写，不要凭 README 猜。

## 前置

| | 从哪来 | 备注 |
|---|---|---|
| zig 0.16.0 | 开发机上 `@native-sdk/cli` **可能**已经放了一份在 `~/.native/toolchains/zig-0.16.0/zig`；**CI 里必须自己下** | 见下方警告。`build.zig.zon` 要求 `minimum_zig_version = "0.16.0"` |
| Native SDK | `npm i -g @native-sdk/cli`（**公开 npm**） | `build.zig` 按 `$HOME/{.local,.npm-global,.volta/tools/image/npm}/lib/node_modules/@native-sdk/cli` 找，或用 `NATIVE_SDK_PATH` 显式指定 |

npm 全局前缀若不是 `~/.local`，装完要么设 `NATIVE_SDK_PATH`，要么确认落在上面三个候选之一。

> **别指望 `npm i -g @native-sdk/cli` 会带来 zig。** 那个包只是个 dispatcher，
> 工具链是它在**某次运行时**按需下载到 `~/.native/toolchains/` 的。开发机上碰巧有，
> 全新 runner 上没有 —— 壳构建流水线第一次跑就栽在这儿（`zig 不在预期位置`）。
>
> CI 里从 ziglang.org 直接下并校验 sha256（见 `.github/workflows/shells.yml` 顶部的
> `ZIG_VERSION` / `ZIG_SHA256_*`）。除了确定性，这样也不依赖 CLI 的内部布局。
> 校验和取自 https://ziglang.org/download/index.json 的 `shasum` 字段（就是 sha256），
> 换版本要一起更新。

## 构建

```bash
cd native-client
export ZIG="$HOME/.native/toolchains/zig-0.16.0/zig"
CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/build-mac.mjs   # 不签名
```

产物：`native-client/dist/Interact.app`（3.1 MB，`Contents/MacOS/native-client`）。

`CSC_IDENTITY_AUTO_DISCOVERY=false` 显式跳过签名。公证要另加 `--notarize`，
那会**把二进制上传给 Apple**，所以不会因为环境变量刚好齐了就自动发出去。

## 必须对齐的两个常量

壳里的 origin 是**编译期常量**，同时充当桥命令的 origin 白名单：

```
native-client/src/main.zig:80   const interact_origin = "http://127.0.0.1:47100";
packages/core/src/native/shell.ts:33   export const NATIVE_PORT = 47100
```

**只改一处，壳会拒绝加载页面，而且拒绝得很安静** —— 窗口起来了、白屏、SSE 永远连不上。
`packages/core/test/native.test.ts` 里有一条用例在源码存在时会去核对这个数值。

可执行文件名也要对得上：`resolveExecutable` 依次试
`native-client` / `Interact` / `harness-gui`，当前产物是第一个。

## 怎么验它真的能用

不要只看「进程起来了」。走真实路径（`DaemonChannel` → daemon 的 `present()`，
`ensureViewer()` 挂在那条路上；直接调 `daemon.ui.confirm()` **会绕过拉起逻辑**），
然后在壳自己的 stderr 日志里找这三行：

```
native shell started pid=...                        daemon 拉起了它
name="runtime.frame" message="frame published"      WebView 真的在渲染我们的页面
name="platform.event" event="bridge_message"        页面的 window.zero 桥调用打到了壳上
```

第三行是关键 —— 它证明原生能力（系统通知）的通路是活的，而不只是开了个窗口。
收尾应当看到 `app_shutdown` → `window_closed`：daemon 关闭时窗口跟着收走。

## 跨平台：为什么必须在对应平台上构建

```
build.zig:68  if (selected_platform == .macos and target.result.os.tag != .macos)
                  @panic("-Dplatform=macos requires a macOS target")
```

macOS 的壳要链接 WebKit framework，需要不可分发的 macOS SDK。所以 CI 要多平台 runner：

| 产物 | runner | 状态 |
|---|---|---|
| `shell-darwin-arm64` | `macos-latest` | 配方已验证 |
| `shell-darwin-x64` | `macos-latest`（交叉到 x86_64-macos） | 未验 |
| `shell-win32-x64` | `windows-latest` | 未验；那边 daemon 走命名管道，也从没在 CI 上跑过 |

被删掉的那份 `native-client/.github/workflows/ci.yml` 只在 ubuntu 上跑
`zig build test -Dplatform=null` —— **从来没有构建过可发布的壳**，别把它当先例。

## 下一步的分发

见 README 的 Platforms 一节。要点：`optionalDependencies` + `os`/`cpu` 是主路径
（走 lockfile 完整性、不受 `--ignore-scripts` 影响、离线可用），
显式的 `install-shell` 命令做兜底 —— **不要用 postinstall**。
