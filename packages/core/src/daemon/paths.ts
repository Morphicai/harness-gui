/**
 * daemon 的落地路径
 */

import * as os from 'node:os'
import * as path from 'node:path'

/**
 * socket 路径。
 *
 * 刻意用很短的名字：Unix domain socket 的路径有 ~104 字节硬上限（sun_path），
 * 放在深目录里加个长文件名就会以 EINVAL 失败，而且报错完全看不出是长度问题。
 *
 * macOS 没有 XDG_RUNTIME_DIR，所以统一落在 ~/.harness-gui 下，而不是各平台各一套。
 */
export function socketPath(): string {
  if (process.env.INTERACT_SOCKET) return process.env.INTERACT_SOCKET
  if (process.platform === 'win32') return '\\\\.\\pipe\\harness-gui'
  return path.join(os.homedir(), '.harness-gui', 'd.sock')
}

export function socketDir(): string {
  return path.dirname(socketPath())
}
