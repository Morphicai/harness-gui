/**
 * 原生壳的平台适配
 *
 * 这一层的价值不在「能不能用」，而在**用不了时说得出为什么**：
 * 平台没构建 / 缺 WebView2 / 没装壳包，三种原因的排查方向完全不同，
 * 混成一句「不可用」等于没说。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shellTarget, unavailableReason, resolveExecutable, isAvailable, APP_ENV } from '../src/native/shell.js'

const saved = { ...process.env }
const realPlatform = process.platform
const realArch = process.arch

function setPlatform(platform: string, arch = process.arch) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: arch, configurable: true })
}

beforeEach(() => {
  /*
   * 把 installPaths() 的标准位置架空：HOME 指到空目录，Windows 的两个前缀清掉。
   *
   * 不这么做的话，凡是断言「找不到壳」的用例都得挂一个 `if (r)` 逃生口 ——
   * 而那意味着在**真装了壳的机器上它们什么都不断言**，看着绿其实空跑。
   * 空跑的用例比红的用例更坏：红的会被修，空跑的不会被发现。
   */
  const home = mkdtempSync(join(tmpdir(), 'hg-home-'))
  process.env.HOME = home
  delete process.env.LOCALAPPDATA
  delete process.env.ProgramFiles
})

afterEach(() => {
  setPlatform(realPlatform, realArch)
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

/** 造一个 macOS bundle 形态的假壳 */
function fakeApp(name = 'Interact.app') {
  const dir = mkdtempSync(join(tmpdir(), 'hg-shell-'))
  const app = join(dir, name)
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'MacOS', 'native-client'), '')
  return app
}

describe('shellTarget', () => {
  it('只认有预构建的平台组合', () => {
    setPlatform('darwin', 'arm64'); expect(shellTarget()).toBe('darwin-arm64')
    setPlatform('win32', 'x64');    expect(shellTarget()).toBe('win32-x64')
  })

  it('没构建的平台返回 undefined，而不是编一个名字', () => {
    setPlatform('linux', 'x64');    expect(shellTarget()).toBeUndefined()
    setPlatform('win32', 'arm64');  expect(shellTarget()).toBeUndefined()
  })
})

describe('unavailableReason —— 三种原因必须可区分', () => {
  it('平台没构建：点明平台，不提壳包（装也没用）', () => {
    setPlatform('linux', 'x64')
    const r = unavailableReason()
    expect(r).toMatch(/linux-x64/)
    expect(r).not.toMatch(/harness-gui-shell/)
  })

  it('★ Windows 缺 WebView2：先于「找不到壳」报出来', () => {
    setPlatform('win32', 'x64')
    // 指一个真实存在的壳，确认它仍然因为引擎缺失而判不可用 ——
    // 否则「壳在但白屏」这种最难查的情况会被漏掉
    process.env[APP_ENV] = fakeApp()
    delete process.env['ProgramFiles(x86)']
    delete process.env.ProgramFiles
    delete process.env.LOCALAPPDATA

    const r = unavailableReason()
    expect(r).toMatch(/WebView2/)
    expect(isAvailable()).toBe(false)
  })

  it('平台支持、引擎在，只是没装壳：给一条现在就能用的出路', () => {
    setPlatform('darwin', 'arm64')
    delete process.env[APP_ENV]
    const r = unavailableReason(join(tmpdir(), 'definitely-absent.app'))
    // 无条件断言 —— HOME 已被架空，所以「找不到壳」是确定的事实，
    // 不再需要 `if (r)` 那种「本机装了壳就不检查」的逃生口
    expect(r).toBeTruthy()
    expect(r).toMatch(new RegExp(APP_ENV))
    // 别让人去装一个还没发布的包 —— 那只会得到 404。壳包上了 npm 之后
    // 可以把包名提示加回来，并同步改这条断言。
    expect(r).not.toMatch(/@harness-gui\/shell-/)
  })
})

describe('resolveExecutable', () => {
  it('macOS 上从 .app 里取出二进制', () => {
    setPlatform('darwin', 'arm64')
    const app = fakeApp()
    expect(resolveExecutable(app)).toBe(join(app, 'Contents', 'MacOS', 'native-client'))
  })

  it('直接给二进制路径也收（开发时手上常常只有它）', () => {
    setPlatform('darwin', 'arm64')
    const bin = join(fakeApp(), 'Contents', 'MacOS', 'native-client')
    expect(resolveExecutable(bin)).toBe(bin)
  })

  it('Windows 上 exe 就是二进制本身', () => {
    setPlatform('win32', 'x64')
    const dir = mkdtempSync(join(tmpdir(), 'hg-shell-'))
    const exe = join(dir, 'Interact.exe')
    writeFileSync(exe, '')
    expect(resolveExecutable(exe)).toBe(exe)
  })

  it('显式路径优先于环境变量', () => {
    setPlatform('darwin', 'arm64')
    const explicit = fakeApp('Explicit.app')
    process.env[APP_ENV] = fakeApp('FromEnv.app')
    expect(resolveExecutable(explicit)).toMatch(/Explicit\.app/)
  })
})
