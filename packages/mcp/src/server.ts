import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerGuiTools } from './tools.js'

/** 建一个只带 gui_* 工具的 server；宿主自己接传输层 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'harness-gui', version: '0.1.0' },
    {
      instructions:
        'Tools for reaching the human operating this session. gui_confirm gates anything ' +
        'irreversible or outward-facing — its answer comes from a person, not from you. ' +
        'gui_show is the right place for long or richly formatted output: it renders properly ' +
        'and does not consume context. Requires HARNESS_GUI=on in the server environment.',
    },
  )
  registerGuiTools(server)
  return server
}
