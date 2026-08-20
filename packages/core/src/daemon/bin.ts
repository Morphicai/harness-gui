#!/usr/bin/env node
/**
 * daemon 进程入口。由 DaemonChannel 按需拉起，一般不用手动跑。
 *
 * 手动跑（排查用）：
 *   node dist/daemon/bin.js
 *   INTERACT_IDLE_MS=0 node dist/daemon/bin.js   # 常驻不自动退出
 */

import { Daemon } from './server.js'

async function main() {
  const idle = process.env.INTERACT_IDLE_MS ? Number(process.env.INTERACT_IDLE_MS) : undefined
  const verbose = process.env.INTERACT_VERBOSE === '1'

  const daemon = new Daemon({
    idleTimeoutMs: Number.isFinite(idle) ? idle : undefined,
    onLog: verbose ? m => console.error(`[interact-daemon] ${m}`) : undefined,
  })

  const owned = await daemon.start()
  if (!owned) {
    // 已经有 daemon 在跑 —— 安静退出。两个消费者同时冷启动时必然走到这里，
    // 不是错误，报错反而会让调用方以为出了问题
    if (verbose) console.error('[harness-gui-daemon] another instance is already running; exiting')
    process.exit(0)
  }

  if (verbose) console.error(`[harness-gui-daemon] ready pid=${process.pid}`)

  const bye = () => {
    void daemon.close().then(() => process.exit(0))
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

void main()
