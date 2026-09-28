import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 跨平台默认 ACP 数据与配置存储目录（纯 Node 运行环境）：
 * - 优先环境变量 INKDOWN_DATA_DIR / ACP_DATA_DIR
 * - Windows: %LOCALAPPDATA%\inkdown (或 %APPDATA%\inkdown)
 * - macOS: ~/Library/Application Support/inkdown
 * - Linux: $XDG_DATA_HOME/inkdown (或 ~/.local/share/inkdown)
 */
export function getDefaultAgentDataDir(): string {
  if (process.env.INKDOWN_DATA_DIR) {
    return process.env.INKDOWN_DATA_DIR
  }
  if (process.env.ACP_DATA_DIR) {
    return process.env.ACP_DATA_DIR
  }
  if (process.platform === 'win32') {
    return (
      process.env.LOCALAPPDATA ||
      process.env.APPDATA ||
      join(homedir(), 'AppData', 'Local', 'inkdown')
    )
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'inkdown')
  }
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share', 'inkdown')
}
