import { requestSessionWithResources } from './session-open'
import { resolvePromptMode } from './native-binding'
import type { AppError } from '@yitom/contracts'
import { err, ok, type Result, isWslPath, windowsToLinuxPath } from '@yitom/contracts'
import type {
  AcpContentBlock,
  AcpPromptResult,
  AcpSetConfigOptionResult,
} from '@yitom/contracts'
import { methods } from '@agentclientprotocol/sdk'
import { parseAcpConfigOptions } from "@yitom/acp-client"
import { resolveAgentCwd } from './agent-sandbox-cwd'
import {
  type MontreeMcpServerHandle,
} from './mcp/montree-mcp-server'
import { startWindowMcpServer, stopWindowMcpServers } from './mcp/stdio-server'
import { windowMcpEntry } from './mcp/session-config'
import { logAcpDiagnostic } from './mcp/diagnostics'
import { sdkRequest } from './sdk-client'
import { disposeAllAcpProcesses } from './process-manager'
import { acpState, claimAcpSession, disarmSuppressSettle, setStatus } from './acp-state'
import {
  handleSnapshotRequest,
  requireAgent,
  toProtocolError,
} from './acp-bridges'
import { detachSdkStreamNow, disconnectAcp } from './acp-connection'
import { currentAcpContext, listAcpContexts, runInAcpContext } from './acp-context'

function sessionPromptMode(nativeSessionAccepted:boolean, restored:boolean) {
  const binding=acpState.connectionBinding
  return resolvePromptMode({eligible:binding?.eligible ?? false,versionSupported:binding?.versionSupported ?? false,
    bindingReady:Boolean(binding?.profileTag) && (!binding?.sessionMeta || nativeSessionAccepted),
    restoreMethod:restored ? 'load' : 'new',nativeSessionAccepted}).mode
}

function mcpServerEntry(handle: MontreeMcpServerHandle, name: string, cwd?: string): unknown[] {
  return windowMcpEntry(handle, name, cwd)
}

async function ensureTocMcpServer(): Promise<MontreeMcpServerHandle> {
  if (!acpState.tocMcp) {
    acpState.tocMcp = await startWindowMcpServer({ readSnapshot: handleSnapshotRequest }, 'toc')
  }
  return acpState.tocMcp
}

export async function loadAcpSession(payload: {
  sessionId: string
  cwd?: string
  secondary?: boolean
}): Promise<
  Result<{ sessionId: string; configOptions: ReturnType<typeof parseAcpConfigOptions>; promptMode?: import('@yitom/contracts').AcpPromptMode }, AppError>
> {
  const a = requireAgent()
  if (!a.ok) return err(a.error)
  if (!acpState.loadSessionSupported) {
    return err({
      code: 'ACP_PROTOCOL_ERROR',
      message: '当前 Agent 未声明 loadSession 能力',
    })
  }

  const cwd = resolveAgentCwd(payload.cwd || acpState.workspaceRoot).cwd

  const secondary = payload.secondary === true
  if (secondary) acpState.suppressSessionUpdates = true

  try {
    const opened = await requestSessionWithResources(
      (method,params)=>sdkRequest(a.value,method,params),
      methods.agent.session.load,
      {
        sessionId: payload.sessionId,
        cwd,
        mcpServers: acpState.montreeMcp ? mcpServerEntry(acpState.montreeMcp, 'montree', cwd) : [],
      },
      acpState.connectionBinding?.sessionMeta,
    )
    const result=opened.result
    const id =
      typeof result.sessionId === 'string' ? result.sessionId : payload.sessionId
    if (currentAcpContext().closed) throw new Error('Agent 所属窗口已关闭')
    claimAcpSession(id)
    if (!secondary) {
      acpState.sessionId = id
      acpState.workspaceRoot = cwd
      setStatus('connected')
    } else if (!acpState.workspaceRoot) {
      acpState.workspaceRoot = cwd
    }
    return ok({
      sessionId: id,
      configOptions: parseAcpConfigOptions(result.configOptions),
      promptMode:sessionPromptMode(opened.nativeSessionAccepted, true),
    })
  } catch (error) {
    return err(toProtocolError(error, '加载会话失败'))
  } finally {
    if (secondary) acpState.suppressSessionUpdates = false
  }
}

/**
 * 在已连接的 Agent 进程上再建一条 session（如批注助手）。
 * **不**覆盖主面板的 sessionId，避免副会话抢走主会话身份。
 * cwd 可省略：沿用 connect 时记下的 workspaceRoot。
 * toolScope='toc' 时只挂目录工具表（目录副会话专用，主会话看不到）。
 */
export async function createAcpSession(
  cwd?: string,
  toolScope: 'full' | 'toc' = 'full',
): Promise<Result<{ sessionId: string; configOptions: ReturnType<typeof parseAcpConfigOptions>; promptMode?: import('@yitom/contracts').AcpPromptMode }, AppError>> {
  const a = requireAgent()
  if (!a.ok) return err(a.error)

  const resolvedCwd = resolveAgentCwd(cwd || acpState.workspaceRoot).cwd

  try {
    const mcpServers =
      toolScope === 'toc'
        ? mcpServerEntry(await ensureTocMcpServer(), 'montree-toc', resolvedCwd)
        : acpState.montreeMcp
          ? mcpServerEntry(acpState.montreeMcp, 'montree', resolvedCwd)
          : []
    const sessionCwd = isWslPath(resolvedCwd) ? windowsToLinuxPath(resolvedCwd) : resolvedCwd
    const opened = await requestSessionWithResources(
      (method,params)=>sdkRequest(a.value,method,params),
      methods.agent.session.new,
      {
        cwd: sessionCwd,
        mcpServers,
      },
      toolScope === 'full' ? acpState.connectionBinding?.sessionMeta : undefined,
    )
    const result=opened.result
    const id = typeof result.sessionId === 'string' ? result.sessionId : null
    if (!id) {
      return err({ code: 'ACP_PROTOCOL_ERROR', message: 'session/new 未返回 sessionId' })
    }
    if (currentAcpContext().closed) throw new Error('Agent 所属窗口已关闭')
    claimAcpSession(id)
    if (!acpState.workspaceRoot) acpState.workspaceRoot = resolvedCwd
    return ok({
      sessionId: id,
      configOptions: parseAcpConfigOptions(result.configOptions),
      promptMode:toolScope === 'full' ? sessionPromptMode(opened.nativeSessionAccepted,false) : 'compatibility',
    })
  } catch (error) {
    return err(toProtocolError(error, '创建会话失败'))
  }
}

export async function setAcpConfigOption(payload: {
  sessionId: string
  configId: string
  value: string | boolean | number
}): Promise<Result<AcpSetConfigOptionResult, AppError>> {
  const a = requireAgent()
  if (!a.ok) return err(a.error)

  try {
    const result = await sdkRequest<Record<string, unknown>, Record<string, unknown>>(
      a.value,
      methods.agent.session.setConfigOption,
      {
        sessionId: payload.sessionId,
        configId: payload.configId,
        value: payload.value,
      },
    )
    const configOptions = parseAcpConfigOptions(
      result.configOptions ?? result,
    )
    // 部分 Agent 直接返回数组
    const parsed =
      configOptions.length > 0
        ? configOptions
        : parseAcpConfigOptions(Array.isArray(result) ? result : [])
    return ok({ configOptions: parsed })
  } catch (error) {
    return err(toProtocolError(error, '设置配置项失败'))
  }
}

export async function promptAcp(payload: {
  sessionId: string
  prompt: AcpContentBlock[]
}): Promise<Result<AcpPromptResult, AppError>> {
  const a = requireAgent()
  if (!a.ok) return err(a.error)

  const prompt = Array.isArray(payload.prompt) ? payload.prompt : []
  if (prompt.length === 0) {
    return err({ code: 'ACP_PROTOCOL_ERROR', message: 'prompt 不能为空' })
  }

  const prevActiveSessionId = acpState.activePromptSessionId
  logAcpDiagnostic('acp.prompt.started', { sessionId: payload.sessionId })
  acpState.activePromptSessionId = payload.sessionId
  // 真实用户 prompt 发起前放行：load 重放定居窗口到此结束，后续 updates 均为真实增量
  disarmSuppressSettle()
  try {
    const result = await sdkRequest<Record<string, unknown>, Record<string, unknown>>(
      a.value,
      methods.agent.session.prompt,
      {
        sessionId: payload.sessionId,
        prompt,
      },
      600_000, // prompt 涉及多步工具调用或视觉大模型解析，超时放宽至 600s（10分钟），避免大部头教材密集目录解析时前端过早判超时
    )
    const stopReason = typeof result.stopReason === 'string' ? result.stopReason : 'end_turn'
    logAcpDiagnostic('acp.prompt.completed', { sessionId: payload.sessionId })
    return ok({ stopReason })
  } catch (error) {
    logAcpDiagnostic('acp.prompt.failed', { sessionId: payload.sessionId })
    try {
      void a.value.notify(methods.agent.session.cancel, { sessionId: payload.sessionId })
    } catch {
      // 忽略竞态
    }
    return err(toProtocolError(error, '发送 prompt 失败'))
  } finally {
    acpState.activePromptSessionId = prevActiveSessionId
  }
}

export function cancelAcp(payload: { sessionId: string }): Result<void, AppError> {
  const a = requireAgent()
  if (!a.ok) return a
  try {
    void a.value.notify(methods.agent.session.cancel, { sessionId: payload.sessionId })
    return ok(undefined)
  } catch (error) {
    return err(toProtocolError(error, '取消失败'))
  }
}

export function disposeAllAcp(): void {
  // App 退出：先同步摘掉各上下文桥接（unpipe + destroy），再整树杀干净，不保温。
  // 顺序即修复——kill 同步先 `stdin.end()`，而 disconnect 排队后执行；
  // 桥若还连着，排队的收尾写入必抛 ERR_STREAM_WRITE_AFTER_END（主进程弹窗）。
  // 退出期 best-effort：后两步的拒绝一律吞掉，不许变成 unhandledRejection 弹窗。
  for (const context of listAcpContexts()) {
    context.closed = true
    runInAcpContext(context, () => {
      detachSdkStreamNow()
      void disconnectAcp(undefined, { killProcess: true }).catch(() => undefined)
      void stopWindowMcpServers().catch(() => undefined)
    })
  }
  disposeAllAcpProcesses()
}
