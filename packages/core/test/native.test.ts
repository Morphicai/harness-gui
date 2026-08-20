/**
 * 原生外壳的接入
 *
 * 这里要钉住的核心是一句话：**没装外壳，一切照旧。**
 * 原生只是把同一份页面换个容器承载，它不在场时不该让任何环境变糟。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NATIVE_PORT, resolveExecutable, isAvailable, launch } from '../src/native/shell.js'

let dir: string
const saved = process.env.HARNESS_GUI_APP

beforeEach(() => {
  dir = join(tmpdir(), `interact-native-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  delete process.env.HARNESS_GUI_APP
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (saved === undefined) delete process.env.HARNESS_GUI_APP
  else process.env.HARNESS_GUI_APP = saved
})

/** 造一个形状合规的 .app */
function fakeApp(name = 'Interact.app', bin = 'native-client'): string {
  const app = join(dir, name)
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'MacOS', bin), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return app
}

describe('定位可执行文件', () => {
  it('给 .app 时钻进 Contents/MacOS', () => {
    const app = fakeApp()
    expect(resolveExecutable(app)).toBe(join(app, 'Contents', 'MacOS', 'native-client'))
  })

  it('直接给二进制也认 —— 开发时手上往往只有 zig-out/bin/native-client', () => {
    const bin = join(dir, 'native-client')
    writeFileSync(bin, '', { mode: 0o755 })
    expect(resolveExecutable(bin)).toBe(bin)
  })

  it('.app 里找不到可执行文件就当没有，而不是拼一个不存在的路径去 spawn', () => {
    const app = join(dir, 'Empty.app')
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    expect(resolveExecutable(app)).toBeUndefined()
  })

  it('走 HARNESS_GUI_APP 环境变量', () => {
    const app = fakeApp()
    process.env.HARNESS_GUI_APP = app
    expect(resolveExecutable()).toBe(join(app, 'Contents', 'MacOS', 'native-client'))
  })

  it('显式路径优先于环境变量', () => {
    process.env.HARNESS_GUI_APP = fakeApp('Env.app')
    const explicit = fakeApp('Explicit.app')
    expect(resolveExecutable(explicit)).toContain('Explicit.app')
  })

  it('路径不存在时不抛，返回 undefined —— 上层要能安静降级', () => {
    expect(resolveExecutable(join(dir, '不存在.app'))).toBeUndefined()
  })
})

describe('可用性', () => {
  it('非 macOS 一律不可用（外壳只编了 macOS）', () => {
    const app = fakeApp()
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      expect(isAvailable(app)).toBe(false)
    } finally {
      Object.defineProperty(process, 'platform', { value: real, configurable: true })
    }
  })

  it('macOS 上找得到才可用', () => {
    if (process.platform !== 'darwin') return
    expect(isAvailable(fakeApp())).toBe(true)
    expect(isAvailable(join(dir, '没有.app'))).toBe(false)
  })
})

describe('拉起', () => {
  it('找不到外壳时抛，错误里要说清楚怎么指定路径', () => {
    expect(() => launch('http://127.0.0.1:1/', { appPath: join(dir, '没有.app') })).toThrow(/HARNESS_GUI_APP/)
  })

  it('把页面地址通过 NATIVE_SDK_FRONTEND_URL 交给外壳', async () => {
    if (process.platform === 'win32') return
    const bin = join(dir, 'probe.sh')
    const out = join(dir, 'seen.txt')
    writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$NATIVE_SDK_FRONTEND_URL" > ${out}\n`, { mode: 0o755 })

    const shell = launch('http://127.0.0.1:47100/?t=abc', { appPath: bin })
    await new Promise(r => shell.child.on('exit', r))
    expect(readFileSync(out, 'utf8')).toBe('http://127.0.0.1:47100/?t=abc')
  })

  it('close() 对已经退出的进程是安全的', async () => {
    if (process.platform === 'win32') return
    const bin = join(dir, 'quick.sh')
    writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const shell = launch('http://x/', { appPath: bin })
    await new Promise(r => shell.child.on('exit', r))
    expect(shell.alive()).toBe(false)
    await expect(shell.close()).resolves.toBeUndefined()
  })
})

describe('端口常量不能和 Zig 那边漂移', () => {
  /*
   * 原生壳的 allowed_origins 是编译期常量兼桥命令白名单。两处不一致的表现极难查：
   * 窗口正常起来、白屏、SSE 永远连不上，没有任何报错。所以用一条测试钉住。
   */
  const zig = join(__dirname, '../../../native-client/src/main.zig')

  it('main.zig 的 interact_origin 端口与 NATIVE_PORT 一致', () => {
    if (!existsSync(zig)) return // 源码不在（已发布的包里就没有），跳过
    const m = readFileSync(zig, 'utf8').match(/interact_origin\s*=\s*"http:\/\/127\.0\.0\.1:(\d+)"/)
    expect(m, 'main.zig 里找不到 interact_origin').toBeTruthy()
    expect(Number(m![1])).toBe(NATIVE_PORT)
  })
})
