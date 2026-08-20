/**
 * 组装 macOS .app —— 开发跑和发布打包共用这一份。
 *
 * 分成两份写的话，「本地测通的」和「实际发出去的」就不是同一个形状了，
 * 而 bundle 结构恰恰会实打实地改变行为：无 bundle 身份时系统通知静默失效
 * （NSUserNotificationCenter 对没有 CFBundleIdentifier 的进程不工作，
 * 而 ObjC 那边 deliverNotification 之后无条件 return 1，程序侧看不见失败）。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

/** 从 app.zon 读字段，避免 Zig 清单和打包脚本各写一份版本号等着漂移 */
export function readManifestField(manifestPath, field) {
  const src = readFileSync(manifestPath, 'utf8')
  const m = src.match(new RegExp(`\\.${field}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

function plist(entries) {
  const body = Object.entries(entries)
    .map(([k, v]) =>
      typeof v === 'boolean'
        ? `  <key>${k}</key><${v}/>`
        : `  <key>${k}</key><string>${v}</string>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`
}

/**
 * 由 1024px PNG 生成 .icns。
 *
 * 图标不是装饰：系统通知横幅左侧显示的就是它，缺了横幅会挂一个占位图，
 * 而「有活儿了叫你」正是这个客户端存在的理由。
 */
function makeIcns(pngPath, outIcns) {
  const iconset = outIcns.replace(/\.icns$/, '.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  // macOS 要求的尺寸矩阵（@1x / @2x 成对）
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale
      const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`
      execFileSync('sips', ['-z', String(px), String(px), pngPath, '--out', join(iconset, name)], {
        stdio: 'ignore',
      })
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', outIcns], { stdio: 'inherit' })
  rmSync(iconset, { recursive: true, force: true })
}

/**
 * 组装 .app，返回 { appPath, execPath }。
 *
 * incremental=true 时只在源二进制更新后才重拷（开发循环每次启动都拷 8MB 没必要）；
 * 发布打包传 false，确保产物干净。
 */
export function buildAppBundle({
  binPath,
  outDir,
  appName,
  bundleId,
  version = '0.1.0',
  iconPng,
  incremental = false,
  agentApp = false,
}) {
  const appPath = join(outDir, `${appName}.app`)
  const contents = join(appPath, 'Contents')
  const macosDir = join(contents, 'MacOS')
  const resDir = join(contents, 'Resources')
  const execName = basename(binPath)
  const execPath = join(macosDir, execName)

  if (!incremental) rmSync(appPath, { recursive: true, force: true })
  mkdirSync(macosDir, { recursive: true })
  mkdirSync(resDir, { recursive: true })

  let iconFile
  if (iconPng && existsSync(iconPng)) {
    iconFile = `${appName}.icns`
    const icns = join(resDir, iconFile)
    if (!incremental || !existsSync(icns)) makeIcns(iconPng, icns)
  }


  writeFileSync(
    join(contents, 'Info.plist'),
    plist({
      CFBundleName: appName,
      CFBundleDisplayName: appName,
      CFBundleIdentifier: bundleId,
      CFBundleExecutable: execName,
      CFBundlePackageType: 'APPL',
      CFBundleVersion: version,
      CFBundleShortVersionString: version,
      LSMinimumSystemVersion: '11.0',
      NSHighResolutionCapable: true,
      /*
       * agentApp（LSUIElement）：纯菜单栏应用，不占 Dock。
       *
       * 对交互客户端来说这是更合适的形态，但它会**改变找回窗口的唯一入口**：
       * 没有 Dock 图标就没有 dock-reopen，隐藏后只能靠状态栏项。
       * 默认关着 —— 目前真机验过的是带 Dock 图标那一版，
       * 开这个开关等于换了一条恢复路径，得重新验一次再作数。
       */
      ...(agentApp ? { LSUIElement: true } : {}),
      ...(iconFile ? { CFBundleIconFile: iconFile } : {}),
    }),
  )

  const stale = !existsSync(execPath) || statSync(binPath).mtimeMs > statSync(execPath).mtimeMs
  if (!incremental || stale) copyFileSync(binPath, execPath)

  return { appPath, execPath }
}
