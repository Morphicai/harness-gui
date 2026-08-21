---
'harness-gui': minor
---

预构建原生壳开始随 npm 下发。

`harness-gui` 现在声明三个 `optionalDependencies`，npm 按 `os`/`cpu` 只装匹配当前
机器的那一个：

```
@harness-gui/shell-darwin-arm64
@harness-gui/shell-darwin-x64
@harness-gui/shell-win32-x64
```

**装不上不致命** —— 那正好对应「没有壳就用浏览器」，而且 `nativeShellUnavailableReason()`
会说出原因。壳换来的是浏览器给不了的三样：系统通知、状态栏常驻、关窗不退出。

**使用成本没有增加。** 壳是自包含的：`otool -L` 显示每个动态依赖都是
`/System/Library/Frameworks` 或 `/usr/lib/libSystem`，没有 `@rpath`、没有随包分发的
dylib。所以没有工具链、没有 postinstall 下载、没有运行时要装 —— 只多 3 MB。

不用 postinstall 是有意的：那会在 `--ignore-scripts`、企业代理、离线安装下失效，
而 `optionalDependencies` 走 lockfile 的完整性校验。

版本与 `harness-gui` 精确相等，由 `scripts/sync-shell-versions.mjs` 强制 ——
漂移的失败形态是「窗口起来了、白屏、永远连不上」。

Windows 壳只验证了「编得出来」，运行时还没有人试过（那边 daemon 走命名管道、
壳要 WebView2）。装不上或起不来都会退回浏览器并说明原因。
