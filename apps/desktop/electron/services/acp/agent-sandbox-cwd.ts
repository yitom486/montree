import { mkdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { app } from 'electron'
import { currentAcpContext } from './acp-context'
import { logAcpDiagnostic } from './mcp/diagnostics'

export type AgentCwdSource = 'workspace' | 'sandbox'

export interface ResolvedAgentCwd {
  cwd: string
  source: AgentCwdSource
}

/** 无用户工作区时 ACP session/new 使用的沙箱目录（仅满足协议 cwd，非用户文档树）。 */
export function ensureAgentSandboxCwd(): string {
  const scope = currentAcpContext()
  const dir = scope.id === 'default'
    ? join(app.getPath('userData'), 'agent-sandbox')
    : join(app.getPath('userData'), 'agent-sandbox', scope.id)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function resolveAgentCwd(preferred?: string | null): ResolvedAgentCwd {
  const trimmed = preferred?.trim()
  if (trimmed) {
    // 剥离 Windows 扩展路径前缀 \\?\，避免进入 Go 编写的 agy_acp_server 导致 file://%3F/ panic
    const normalized = trimmed.replace(/^\\\\\?\\/, '')
    // 相对路径会被 Agent 再次按子进程 cwd 拼接；旧缓存不能直接进入会话或 spawn。
    if (isAbsolute(normalized)) {
      try {
        if (statSync(normalized).isDirectory()) return { cwd: normalized, source: 'workspace' }
      } catch { /* 已删除或不可访问的工作区使用应用沙箱 */ }
    }
    logAcpDiagnostic('agent.cwd.fallback', { reason: isAbsolute(normalized) ? 'unavailable-directory' : 'relative-path' })
  }
  return { cwd: ensureAgentSandboxCwd().replace(/^\\\\\?\\/, ''), source: 'sandbox' }
}

