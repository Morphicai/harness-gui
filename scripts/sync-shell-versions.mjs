#!/usr/bin/env node
/**
 * 把 harness-gui 的 optionalDependencies 对齐到它自己的版本。
 *
 * 壳按平台切成独立包，`harness-gui` 用**精确版本**钉住它们 —— 版本一旦漂移，
 * 装出来的壳和 core 就可能不匹配，而失败形态是「窗口起来了、白屏」，
 * 极难排查（端口常量对不上就是这个症状）。
 *
 * 所以在 `changeset version` 之后跑这一步：读 core 的新版本，覆盖三个壳依赖，
 * 并把壳包自己的 version 也推平。changesets 的 `fixed` 组能保证它们一起发，
 * 但 core 里那三行精确依赖得有人来写。
 *
 * 壳包还不存在时这个脚本是空转 —— 那是预期状态，不是错误。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const corePath = join(root, 'packages/core/package.json')
const core = JSON.parse(readFileSync(corePath, 'utf8'))
const version = core.version

const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64']
const present = targets.filter(t => existsSync(join(root, `packages/shell-${t}/package.json`)))

if (present.length === 0) {
  console.log('sync-shell-versions: 还没有壳包，跳过')
  if (core.optionalDependencies) {
    // 壳包不存在却声明了依赖 → 每次安装都会打一串 404
    console.error('sync-shell-versions: core 声明了 optionalDependencies 但壳包不在仓库里')
    process.exit(1)
  }
  process.exit(0)
}

const optional = {}
for (const t of present) {
  const p = join(root, `packages/shell-${t}/package.json`)
  const pkg = JSON.parse(readFileSync(p, 'utf8'))
  if (pkg.version !== version) {
    pkg.version = version
    writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`sync-shell-versions: ${pkg.name} → ${version}`)
  }
  optional[pkg.name] = version
}

const before = JSON.stringify(core.optionalDependencies ?? {})
core.optionalDependencies = optional
if (JSON.stringify(optional) !== before) {
  writeFileSync(corePath, JSON.stringify(core, null, 2) + '\n')
  console.log(`sync-shell-versions: harness-gui 的 optionalDependencies 已对齐到 ${version}`)
}
