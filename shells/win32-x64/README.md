# @harness-gui/shell-win32-x64

Prebuilt native shell for [`harness-gui`](https://www.npmjs.com/package/harness-gui) on
**win32-x64**. You do not install this directly — `harness-gui` lists it as an
`optionalDependency`, and npm picks the one matching your machine via `os`/`cpu`.

Failing to install it is deliberately not fatal: without a shell, `harness-gui` uses the
browser channel and logs the reason. What the shell buys is the three things a browser tab
cannot give you — system notifications, a tray presence, and surviving a window close.

Self-contained: the binary links only OS frameworks, so there is no toolchain or runtime to
install. Requires the Edge WebView2 Runtime (preinstalled on Win11 and recent Win10).

The version always matches `harness-gui` exactly — a mismatched shell fails as a window that
opens, shows white, and never connects.

## License

MIT
