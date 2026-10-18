import type { AcpRpcRequest } from '@yitom/acp-client'
import { isWslPath, windowsToLinuxPath } from '@yitom/contracts'
import { acpState } from './acp-state'
import { currentAcpContext, type AcpContext } from './acp-context'
import { requestSessionWithResources } from './session-open'
import type { MontreeMcpServerHandle } from './mcp/montree-mcp-server'
import { windowMcpEntry } from './mcp/session-config'
import { logAcpDiagnostic } from './mcp/diagnostics'

interface Binding {
  handle: MontreeMcpServerHandle
  name: string
  cwd: string
  meta?: Record<string, unknown>
  disconnects: number
  generation: number
  recovery?: { controller: AbortController; promise: Promise<void> }
}
const bindings = new WeakMap<AcpContext, Map<string, Binding>>()
class RecoveryInvariantError extends Error {}
export class McpRecoveryCancelledError extends Error {}

export function bindSessionMcp(sessionId: string, handle: MontreeMcpServerHandle | null, cwd: string, meta?: Record<string, unknown>, name = 'montree'): void {
  if (!handle?.health) return
  const owner = currentAcpContext()
  let sessions = bindings.get(owner)
  if (!sessions) { sessions = new Map(); bindings.set(owner, sessions) }
  sessions.get(sessionId)?.recovery?.controller.abort()
  sessions.set(sessionId, { handle, cwd, meta, name, generation: acpState.connectGeneration, disconnects: handle.health.disconnects })
}

export function cancelMcpRecovery(sessionId?: string): void {
  const sessions = bindings.get(currentAcpContext())
  if (sessionId !== undefined) sessions?.get(sessionId)?.recovery?.controller.abort()
  else {
    for (const binding of sessions?.values() ?? []) binding.recovery?.controller.abort()
    bindings.delete(currentAcpContext())
  }
}

/** Restore the same session before sending user input; never fall back to session/new. */
export async function ensureSessionMcp(sessionId: string, request: AcpRpcRequest): Promise<void> {
  const owner = currentAcpContext()
  const binding = bindings.get(owner)?.get(sessionId)
  if (!binding) return
  if (owner.closed || binding.generation !== acpState.connectGeneration) {
    throw new McpRecoveryCancelledError('Agent 连接已变更，请重新连接原会话')
  }
  const health = binding.handle.health!
  if (binding.recovery) return binding.recovery.promise
  if ([...bindings.get(owner)!.values()].some((other) => other.recovery)) {
    throw new Error('Agent 正在恢复其他会话的 MCP，请稍后重试')
  }
  if (!health.needsRecovery(binding.disconnects)) return
  const controller = new AbortController()
  const valid = () => {
    if (controller.signal.aborted || owner.closed || acpState.connectGeneration !== binding.generation) {
      throw new McpRecoveryCancelledError('MCP 恢复已取消，Agent 连接已变更')
    }
  }
  const recover = async () => {
    valid()
    if (acpState.activePromptSessionId) throw new Error('Agent 正在处理其他消息，请稍后重试恢复 MCP')
    const methods = [
      ...(acpState.resumeSessionSupported ? ['session/resume'] : []),
      ...(acpState.loadSessionSupported ? ['session/load'] : []),
    ]
    if (!methods.length) throw new Error('Montree 工具连接已断开，当前 Agent 不支持恢复会话，请重新连接 Agent')
    const suppressed = acpState.suppressSessionUpdates
    acpState.suppressSessionUpdates = true
    logAcpDiagnostic('mcp.recovery.started', { sessionId })
    try {
      for (const method of methods) {
        valid()
        const after = health.discoveries
        try {
          const opened = await requestSessionWithResources(request, method, {
            sessionId,
            cwd: isWslPath(binding.cwd) ? windowsToLinuxPath(binding.cwd) : binding.cwd,
            mcpServers: windowMcpEntry(binding.handle, binding.name, binding.cwd),
          }, binding.meta)
          valid()
          if (typeof opened.result.sessionId === 'string' && opened.result.sessionId !== sessionId) {
            throw new RecoveryInvariantError('Agent 恢复返回了其他会话，已停止发送，请重新连接 Agent')
          }
          if (binding.meta?.toolsMode === 'ptc' && !opened.nativeSessionAccepted) {
            throw new RecoveryInvariantError('Agent 恢复时拒绝了 Code mode，请重新连接 Agent')
          }
          await health.waitForDiscovery(after, controller.signal)
          valid()
          if (!health.hasDiscoveredClient) throw new Error('Montree 工具连接再次断开，请重新连接 Agent')
          binding.disconnects = health.disconnects
          logAcpDiagnostic('mcp.recovery.discovered', { sessionId, method })
          return
        } catch (error) {
          valid()
          logAcpDiagnostic('mcp.recovery.failed', { sessionId, method })
          if (error instanceof RecoveryInvariantError) throw error
          if (method === methods.at(-1)) {
            throw new Error(`Montree 工具恢复失败，请重新连接 Agent：${error instanceof Error ? error.message : '未知错误'}`)
          }
        }
      }
    } finally {
      if (acpState.connectGeneration === binding.generation) acpState.suppressSessionUpdates = suppressed
    }
  }
  const promise = recover()
  binding.recovery = { controller, promise }
  try { await promise }
  finally { if (binding.recovery?.promise === promise) binding.recovery = undefined }
}
