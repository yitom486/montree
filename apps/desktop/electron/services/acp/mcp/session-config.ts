import { join } from 'node:path'
import type { MontreeMcpServerHandle } from './montree-mcp-server'
import { isWslPath, windowsToLinuxPath } from '@montree/contracts'
import { logAcpDiagnostic } from './diagnostics'

/** Agent owns the stdio child; Montree owns the window broker it connects to. */
export function windowMcpEntry(handle: MontreeMcpServerHandle, name: string, cwd?: string) {
  const wsl = process.platform === 'win32' && Boolean(cwd && isWslPath(cwd))
  const entry = join(__dirname, 'mcp-stdio.js')
  logAcpDiagnostic('mcp.stdio.config', { server: name, environment: wsl ? 'wsl' : 'native', executable: wsl ? windowsToLinuxPath(process.execPath) : process.execPath, entry: wsl ? entry.replaceAll('\\', '/') : entry })
  return [{ name, command: wsl ? windowsToLinuxPath(process.execPath) : process.execPath, args: [wsl ? entry.replaceAll('\\', '/') : entry], env: [
    { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
    { name: 'MONTREE_MCP_PIPE', value: handle.url },
    { name: 'MONTREE_MCP_TOKEN', value: handle.authToken },
    ...(wsl ? [{ name: 'WSLENV', value: [process.env.WSLENV, 'ELECTRON_RUN_AS_NODE', 'MONTREE_MCP_PIPE', 'MONTREE_MCP_TOKEN'].filter(Boolean).join(':') }] : []),
  ] }]
}
