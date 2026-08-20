/**
 * @harness-gui/mcp —— 把「向人提问」这件事暴露成 MCP 工具
 *
 * 只做适配：协议、通道、降级全在 `harness-gui` 里，这里不重复实现任何一层。
 */

export { registerGuiTools } from './tools.js'
export { createServer } from './server.js'
