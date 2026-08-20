#!/usr/bin/env node
/**
 * stdio 入口。
 *
 * stdout 归 MCP 协议独占 —— 任何日志都必须走 stderr，否则会污染帧、
 * 表现成宿主那边「server 启动了但工具列表是空的」。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { interactMode } from 'harness-gui'
import { createServer } from './server.js'

async function main() {
  if (interactMode() === 'off') {
    process.stderr.write(
      '[harness-gui-mcp] HARNESS_GUI is off — tools are registered but will decline to reach ' +
        'anyone. Set HARNESS_GUI=on (or strict) to enable.\n',
    )
  }
  const server = createServer()
  await server.connect(new StdioServerTransport())
}

main().catch(err => {
  process.stderr.write(`[harness-gui-mcp] fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
