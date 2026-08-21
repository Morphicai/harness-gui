#!/usr/bin/env node
/**
 * macOS 发布构建：编译 → 组装 .app → 签名 →（可选）公证 → 装订。
 *
 * 签名信息**全部来自环境变量**，仓库里不留任何账号信息（沿用 autoproxy-cli 的约定）：
 *   CSC_NAME                     签名身份，如 "Developer ID Application: NAME (TEAMID)"
 *                                不设则由 codesign 从登录钥匙串自动挑选
 *   CSC_IDENTITY_AUTO_DISCOVERY  设为 false 则完全跳过签名，出未签名包
 *   APPLE_ID / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD   公证用
 *
 * 公证要把二进制上传到 Apple，属于外发行为，所以必须显式加 --notarize 才会做，
 * 不会因为「环境变量刚好齐了」就自动发出去。
 *
 * 用法：
 *   node scripts/build-mac.mjs                  构建 + 签名
 *   node scripts/build-mac.mjs --notarize       构建 + 签名 + 公证 + 装订
 *   node scripts/build-mac.mjs --agent-app      纯菜单栏形态（无 Dock 图标）
 *   node scripts/build-mac.mjs --target=x86_64-macos    交叉编译到 Intel
 *
 * 两个 darwin 架构可以在**同一台机器**上出：zig 交叉编译，sysroot 由
 * `xcrun --show-sdk-path` 提供。已在 arm64 机器上编出 x86_64 验证过。
 *   CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/build-mac.mjs   不签名
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildAppBundle, readManifestField } from './bundle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(here, '..')
const MANIFEST = join(APP_DIR, 'app.zon')
const ZIG = process.env.ZIG ?? join(process.env.HOME, '.native/toolchains/zig-0.16.0/zig')

const wantNotarize = process.argv.includes('--notarize')
const agentApp = process.argv.includes('--agent-app')
/** 目标三元组，如 x86_64-macos；不给则编本机架构 */
const target = (process.argv.find(a => a.startsWith('--target=')) ?? '').slice('--target='.length) ||
  process.env.TARGET || ''
/** 产物目录后缀，避免两个架构互相覆盖 */
const outSuffix = target ? '-' + target : ''

const log = (tag, msg) => console.log(`[${tag}] ${msg}`)
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: APP_DIR, ...opts })

/** 身份名里含开发者姓名与 Team ID，日志里一律脱敏 */
const redact = s =>
  String(s)
    .replace(/(Developer ID Application: )[^(]*\(([A-Z0-9]{10})\)/g, '$1<NAME> (<TEAMID>)')
    .replace(/\b[0-9A-F]{40}\b/g, '<SHA1>')

/**
 * 选签名身份。
 *
 * 钥匙串里往往有多个 Developer ID，「取第一个」是在赌。
 * 有 APPLE_TEAM_ID 时按 Team ID 精确匹配 —— 证书的 Team 和公证的 Team 不一致，
 * 公证必然失败，与其上传几分钟后被拒，不如在选证书这一步就对齐。
 */
function resolveIdentity() {
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') return null
  if (process.env.CSC_NAME) return process.env.CSC_NAME

  const out = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' })
  // 每行形如：  1) <40位SHA1> "Developer ID Application: NAME (TEAMID)"
  const all = [...out.matchAll(/([0-9A-F]{40})\s+"(Developer ID Application: [^"]+)"/g)].map(m => ({
    hash: m[1],
    name: m[2],
  }))
  if (all.length === 0) return null

  const team = process.env.APPLE_TEAM_ID
  const pool = team ? all.filter(i => i.name.includes(`(${team})`)) : all
  if (team && pool.length === 0) {
    throw new Error(
      `钥匙串里的 ${all.length} 个 Developer ID 身份没有一个属于 APPLE_TEAM_ID；` +
        `证书 Team 与公证 Team 不一致会导致公证失败 —— 请核对 APPLE_TEAM_ID 或用 CSC_NAME 指定`,
    )
  }
  if (pool.length === 1) return pool[0].name

  /*
   * 多个候选。同名同 Team 是重复项（证书续期或重复导入很常见），任选其一都对，
   * 但按名字签对 codesign 是歧义的 —— 所以改用 SHA-1 指纹，它唯一。
   * 只有名字真的不同才是需要人来决定的选择。
   */
  const names = new Set(pool.map(i => i.name))
  if (names.size === 1) {
    log('sign', `钥匙串里有 ${pool.length} 个同名同 Team 的重复身份，按指纹签第一个`)
    return pool[0].hash
  }
  throw new Error(`匹配到 ${names.size} 个不同的签名身份，用 CSC_NAME 指定具体哪一个`)
}

function main() {
  const version = readManifestField(MANIFEST, 'version') ?? '0.1.0'
  const bundleId = readManifestField(MANIFEST, 'id') ?? 'dev.native_sdk.interact-client'

  // ---- 1. 编译 release ----
  const zigArgs = ['build', '-Doptimize=ReleaseFast']
  if (target) zigArgs.push(`-Dtarget=${target}`)
  log('build', `zig ${zigArgs.join(' ')}`)
  run(ZIG, zigArgs)
  const binPath = join(APP_DIR, 'zig-out/bin/native-client')
  if (!existsSync(binPath)) throw new Error(`构建产物不存在：${binPath}`)

  // ---- 2. 组装 .app（发布不做增量，确保产物干净）----
  // 目标不同时分目录：zig-out/bin 会被下一次构建覆盖，两个架构同放一处必然串味
  const outDir = join(APP_DIR, 'dist' + outSuffix)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const { appPath } = buildAppBundle({
    binPath,
    outDir,
    appName: 'Interact',
    bundleId,
    version,
    iconPng: join(APP_DIR, 'assets/icon.png'),
    incremental: false,
    agentApp,
  })
  log('bundle', `${appPath}${agentApp ? '（纯菜单栏形态）' : ''}`)

  // ---- 3. 签名 ----
  const identity = resolveIdentity()
  if (!identity) {
    log('sign', '跳过签名（CSC_IDENTITY_AUTO_DISCOVERY=false 或钥匙串里没有 Developer ID 身份）')
    log('done', `未签名产物：${appPath}`)
    return
  }
  log('sign', redact(identity))

  /*
   * --options runtime 是强化运行时，公证的硬前提。
   * --timestamp 必须打（公证要求安全时间戳），所以不能用 timestamp: none 那个绕国内网络的偏方。
   *
   * 不带 --entitlements：这个壳只链系统框架，不加载第三方 dylib，JS 跑在 WKWebView
   * 自己的（Apple 签名的）进程里 —— 不需要 Electron 那套 allow-jit /
   * allow-unsigned-executable-memory / disable-library-validation 的豁免。
   * 真需要时把 build/entitlements.mac.plist 放进来，下面会自动带上。
   */
  const ents = join(APP_DIR, 'build/entitlements.mac.plist')
  const signArgs = [
    '--force',
    '--sign', identity,
    '--options', 'runtime',
    '--timestamp',
  ]
  if (existsSync(ents)) {
    signArgs.push('--entitlements', ents)
    log('sign', `带 entitlements：${ents}`)
  }
  try {
    // 这里不能用 stdio:'inherit' —— codesign 的诊断走 stderr，
    // 继承出去就进不了 err.message，下面那条已知失败模式就识别不到
    execFileSync('codesign', [...signArgs, appPath], { cwd: APP_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    const detail = String(err.stderr ?? '') + String(err.message ?? '')
    if (detail.trim()) console.error(redact(detail.trim()))
    /*
     * 已知失败模式（2026-08-15 本机实测，结论存 docs/mac-signing.md）：
     *   Warning: unable to build chain to self-signed root for signer "..."
     *   errSecInternalComponent
     *
     * 那句 "unable to build chain" 是**误导性警告**，证书链其实是好的：
     * `security verify-cert -p codeSign` 返回 verification successful。
     *
     * 决定性对照：同一个 codesign、同一个文件，
     *   - 用真实身份（哪怕不带任何选项）→ errSecInternalComponent
     *   - ad-hoc 签名 `-s -`（不需要私钥）→ 成功
     * 所以卡的是**私钥的使用权限**，不是链、不是网络、不是会话。
     *
     * 已逐条排除：证书未过期（到 2031）、G2 中间证书在钥匙串（到 2031）、
     * Apple Root CA 在系统根钥匙串、TSA 可达（去掉 --timestamp 同样失败）、
     * 钥匙串已解锁、搜索列表正确、会话是 Aqua（不是无头会话）、
     * 显式 --keychain 亦然、三张身份表现完全一致。
     *
     * 最可能的成因是私钥 ACL 的 partition list 缺 apple-tool:，
     * 常见于 .p12 非交互导入或系统迁移之后。修法见 docs/mac-signing.md。
     */
    if (/errSecInternalComponent|unable to build chain/.test(detail)) {
      throw new Error(
        'codesign 用不了这个私钥（errSecInternalComponent）。证书链本身是好的 —— ' +
          'ad-hoc 签名能过、verify-cert 也通过，所以问题在私钥的访问权限，多半是 ' +
          'partition list 缺 apple-tool:。修复步骤见 docs/mac-signing.md；' +
          '暂时出未签名包：CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/build-mac.mjs',
      )
    }
    throw err
  }

  log('verify', 'codesign --verify --deep --strict')
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])

  if (!wantNotarize) {
    log('done', `已签名产物：${appPath}`)
    log('done', '未公证 —— 加 --notarize 才会上传到 Apple（外发行为，需要你明确要求）')
    return
  }

  // ---- 4. 公证 ----
  const { APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD } = process.env
  const missing = ['APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_SPECIFIC_PASSWORD'].filter(k => !process.env[k])
  if (missing.length) {
    throw new Error(`公证缺少环境变量：${missing.join(' / ')}（放进 .env.signing，别提交进仓库）`)
  }

  const zipPath = join(outDir, 'Interact.zip')
  log('notarize', '打包并上传到 Apple 公证服务（会等结果，可能几分钟）')
  run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath])
  run('xcrun', [
    'notarytool', 'submit', zipPath,
    '--apple-id', APPLE_ID,
    '--team-id', APPLE_TEAM_ID,
    '--password', APPLE_APP_SPECIFIC_PASSWORD, // 只作为参数传给 notarytool，不打印
    '--wait',
  ])

  log('staple', 'xcrun stapler staple')
  run('xcrun', ['stapler', 'staple', appPath])

  log('verify', 'spctl 门禁评估')
  run('spctl', ['-a', '-vvv', '-t', 'install', appPath])

  rmSync(zipPath, { force: true })
  log('done', `已签名并公证：${appPath}`)
}

try {
  main()
} catch (err) {
  console.error(`[failed] ${redact(err.message)}`)
  process.exit(1)
}
