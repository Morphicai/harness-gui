import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerGuiTools } from './tools.js'

/* 版本号从 package.json 读，别写死 —— changesets 只改 package.json，
   写死的字面量在下一次发版后就是谎言。
   tsconfig 的 rootDir 是 src、outDir 是 dist，所以源码 src/server.ts 和产物
   dist/server.js 到包根的相对深度一致，这一个路径两边都成立。 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json') as { version: string }

/** 建一个只带 gui_* 工具的 server；宿主自己接传输层 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'harness-gui', version },
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
