/**
 * 原生外壳 —— 用自家窗口承载 WebChannel 的页面
 *
 * 它**不是一个 Channel**。交互协议、页面、表单逻辑全部复用 WebChannel，
 * 原生壳只是把同一份页面从系统浏览器搬进自家窗口，换来三件浏览器给不了的东西：
 * 系统通知、状态栏常驻、关窗不退出。
 *
 * 页面那边靠 `window.zero` 自行判断跑在哪个容器里（见 channels/web/page.ts），
 * 所以这里不需要往页面注入任何东西。
 *
 * ## 为什么这一层要把「为什么不可用」讲清楚
 *
 * 壳不可用时 daemon 会退回 web 通道，那是条好路 —— 所以退回本身没有损失。
 * 真正要命的是**说不出为什么**：壳装了但引擎缺失、端口常量不匹配，都会表现成
 * 「窗口起来了、白屏、永远连不上」。所以这里除了 `isAvailable()` 还给
 * `unavailableReason()`，让调用方能把原因打进日志。
 */

import { spawn, ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * 原生壳唯一允许加载的端口。
 *
 * **必须与 native-client/src/main.zig 的 `interact_origin` 一致。** 那边是编译期
 * 常量，同时充当桥命令的 origin 白名单 —— 只改一处，壳会直接拒绝加载页面，
 * 而且拒绝得很安静（窗口起来了、白屏、SSE 永远连不上）。
 * test/native.test.ts 里有一条用例在源码存在时会去核对这个数值。
 */
export const NATIVE_PORT = 47100

/** 显式指定壳位置的环境变量（开发时手上往往只有 zig-out 里的产物） */
export const APP_ENV = 'HARNESS_GUI_APP'

/** 支持的平台组合 —— 与预构建壳包的命名一一对应 */
export type ShellTarget = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

/** 当前平台对应的壳包后缀；不支持的平台返回 undefined */
export function shellTarget(): ShellTarget | undefined {
  const k = `${process.platform}-${process.arch}`
  return k === 'darwin-arm64' || k === 'darwin-x64' || k === 'win32-x64' ? k : undefined
}

export interface NativeShellOptions {
  /** bundle 路径或可执行文件路径；不给则按 env → npm 壳包 → 标准位置查找 */
  appPath?: string
  onLog?: (msg: string) => void
}

// ── 候选位置 ────────────────────────────────────────────────────────────────

/**
 * 随 npm 下发的壳包位置。
 *
 * 壳按平台切成独立包、挂在 optionalDependencies 上，npm 只装匹配当前平台的那个 ——
 * 装不上也不会让整个安装失败，正好对应「壳没有就退回 web」。
 * 用 `require.resolve` 而不是拼相对路径：包管理器的提升策略各不相同，硬拼必然踩空。
 */
function npmShellPaths(target: ShellTarget): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkgJson = require.resolve(`@harness-gui/shell-${target}/package.json`)
    const root = path.dirname(pkgJson)
    return process.platform === 'darwin'
      ? [path.join(root, 'Interact.app')]
      : [path.join(root, 'Interact.exe'), path.join(root, 'harness-gui.exe')]
  } catch {
    return []   // 没装那个可选依赖 —— 正常情况，不是错误
  }
}

/** 各平台的常规安装位置 */
function installPaths(): string[] {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return [path.join(home, '.harness-gui', 'Interact.app'), '/Applications/Interact.app']
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    const progs = process.env.ProgramFiles
    return [
      ...(local ? [path.join(local, 'harness-gui', 'Interact.exe')] : []),
      ...(progs ? [path.join(progs, 'harness-gui', 'Interact.exe')] : []),
    ]
  }
  return []
}

// ── 可执行文件定位（按平台，bundle 形态本身就不同）────────────────────────────

/**
 * 从 macOS 的 `.app` 里定位可执行文件。
 *
 * 不去解析 Info.plist 的 CFBundleExecutable：那要引 plist 解析，而这一层是零依赖。
 * MacOS/ 目录下正常只有一个可执行文件，按已知名字试即可；试不到就当没有，
 * 让上层降级到浏览器 —— 猜错一个路径去 spawn，报错会难懂得多。
 */
function macosBinaryIn(appDir: string): string | undefined {
  for (const name of ['native-client', 'Interact', 'harness-gui']) {
    const p = path.join(appDir, 'Contents', 'MacOS', name)
    if (existsSync(p)) return p
  }
  return undefined
}

/**
 * 把一个候选路径解析成可执行文件。
 *
 * macOS 上候选可能是 `.app` 目录也可能是 bundle 里的二进制本身（开发时常见）；
 * Windows 上候选就是 `.exe`。这两种形态的差异只在这里处理，不外泄。
 */
function toExecutable(candidate: string): string | undefined {
  if (!existsSync(candidate)) return undefined
  if (candidate.endsWith('.app')) return macosBinaryIn(candidate)
  return candidate
}

export function resolveExecutable(appPath?: string): string | undefined {
  const target = shellTarget()
  const candidates = [
    appPath,
    process.env[APP_ENV],
    ...(target ? npmShellPaths(target) : []),
    ...installPaths(),
  ].filter(Boolean) as string[]

  for (const c of candidates) {
    const bin = toExecutable(c)
    if (bin) return bin
  }
  return undefined
}

// ── 平台前置条件 ────────────────────────────────────────────────────────────

/**
 * Windows 上的 WebView2 Runtime 探测。
 *
 * macOS 的 WKWebView 是系统组件，一定在；**Windows 的 Edge WebView2 Runtime 不保证存在**
 * （Win11 与较新 Win10 预装，老机器没有）。缺它的时候壳能起进程、但只会给一个白屏窗口 ——
 * 这正是我们最不想要的那种失败，所以宁可提前判为不可用、退回 web。
 *
 * 按安装目录判断而不是查注册表：查注册表要 spawn `reg`，在这一层引入同步子进程不值得。
 * 代价是可能漏判自带式（fixed-version）部署 —— 那种情况用 `HARNESS_GUI_APP` 显式指定即可。
 */
function webView2Present(): boolean {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean) as string[]
  return roots.some(r => existsSync(path.join(r, 'Microsoft', 'EdgeWebView', 'Application')))
}

/**
 * 说清楚为什么用不了原生壳；能用则返回 undefined。
 *
 * 调用方（daemon）应当把这句话打进日志再退回 web —— 静默降级会让人以为壳坏了。
 */
export function unavailableReason(appPath?: string): string | undefined {
  const target = shellTarget()
  if (!target) {
    return `原生壳没有 ${process.platform}-${process.arch} 的构建，将使用浏览器通道`
  }
  if (process.platform === 'win32' && !webView2Present()) {
    return `未检测到 Edge WebView2 Runtime，原生壳会白屏，改用浏览器通道（装上 WebView2 或用 ${APP_ENV} 指定自带运行时的壳）`
  }
  if (!resolveExecutable(appPath)) {
    return `没找到原生壳（用 ${APP_ENV} 指定其位置），将使用浏览器通道`
  }
  return undefined
}

/** 这台机器现在能不能用原生壳 */
export function isAvailable(appPath?: string): boolean {
  return unavailableReason(appPath) === undefined
}

// ── 启动 ────────────────────────────────────────────────────────────────────

export interface NativeShell {
  readonly child: ChildProcess
  /** 进程是否还活着 */
  alive(): boolean
  /** 关掉它。先 SIGTERM，超时再 SIGKILL */
  close(): Promise<void>
}

/**
 * 拉起外壳，把页面地址通过环境变量交给它。
 *
 * 不 detached：外壳的生命周期挂在 daemon 上。daemon 空闲退出时窗口也该收走 ——
 * 留一个连不上任何东西的托盘图标在那儿，比没有图标更让人困惑。
 */
export function launch(url: string, opts: NativeShellOptions = {}): NativeShell {
  const bin = resolveExecutable(opts.appPath)
  if (!bin) throw new Error(unavailableReason(opts.appPath) ?? '找不到原生外壳')

  const log = opts.onLog ?? (() => {})
  const child = spawn(bin, [], {
    /*
     * macOS 的壳按相对路径找 icon 等资源，工作目录要落在 bundle 外层（.app 的上一级）；
     * Windows 的 exe 就在自己目录里找资源。两者都取「可执行文件所在目录的合适上级」。
     */
    cwd: cwdFor(bin),
    env: { ...process.env, NATIVE_SDK_FRONTEND_URL: url },
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  child.stderr?.on('data', d => log(`[native] ${String(d).trimEnd()}`))
  child.on('error', e => log(`[native] 启动失败：${e.message}`))

  return {
    child,
    alive: () => child.exitCode === null && !child.killed,
    async close() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      for (let i = 0; i < 30 && child.exitCode === null; i++) {
        await new Promise(r => setTimeout(r, 100))
      }
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

/** 启动时的工作目录：macOS 落在 .app 外层，其余落在可执行文件同级 */
function cwdFor(bin: string): string {
  const i = bin.indexOf('.app' + path.sep)
  if (i >= 0) return path.dirname(bin.slice(0, i + 4))
  return path.dirname(bin)
}
