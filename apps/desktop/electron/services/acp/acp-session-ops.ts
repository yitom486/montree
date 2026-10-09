import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import type {
  AcpContentBlock,
  AcpPromptResult,
  AcpSetConfigOptionResult,
} from '@montree/contracts'
import { methods } from '@agentclientprotocol/sdk'
import { parseAcpConfigOptions } from "@yitom/acp-client"
import { resolveAgentCwd } from './agent-sandbox-cwd'
import {
  startTocMcpServer,
  type MontreeMcpServerHandle,
} from './mcp/montree-mcp-server'
import { sdkRequest } from './sdk-client'
import { disposeAllAcpProcesses } from './process-manager'
import { acpState, disarmSuppressSettle, setStatus } from './acp-state'
import {
  handleSnapshotRequest,
  requireAgent,
  toProtocolError,
} from './acp-bridges'
import { disconnectAcp } from './acp-connection'

function mcpServerEntry(handle: MontreeMcpServerHandle, name: string): unknown[] {
  return [
    {
      type: 'http',
      name,
      url: handle.url,
      headers: [{ name: 'Authorization', value: `Bearer ${handle.authToken}` }],
    },
  ]
}

async function ensureTocMcpServer(): Promise<MontreeMcpServerHandle> {
  if (!acpState.tocMcp) {
    acpState.tocMcp = await startTocMcpServer({ readSnapshot: handleSnapshotRequest })
  }
  return acpState.tocMcp
}

export async function loadAcpSession(payload: {
  sessionId: string
  cwd?: string
  secondary?: boolean
}): Promise<
  Result<{ sessionId: string; configOptions: ReturnType<typeof parseAcpConfigOptions> }, AppError>
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
    const result = await sdkRequest<Record<string, unknown>, Record<string, unknown>>(
      a.value,
      methods.agent.session.load,
      {
        sessionId: payload.sessionId,
        cwd,
        mcpServers: acpState.montreeMcp
          ? [
              {
                type: 'http',
                name: 'montree',
                url: acpState.montreeMcp.url,
                headers: [{ name: 'Authorization', value: `Bearer ${acpState.montreeMcp.authToken}` }],
              },
            ]
          : [],
      },
    )
    const id =
      typeof result.sessionId === 'string' ? result.sessionId : payload.sessionId
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
): Promise<Result<{ sessionId: string; configOptions: ReturnType<typeof parseAcpConfigOptions> }, AppError>> {
  const a = requireAgent()
  if (!a.ok) return err(a.error)

  const resolvedCwd = resolveAgentCwd(cwd || acpState.workspaceRoot).cwd

  try {
    const mcpServers =
      toolScope === 'toc'
        ? mcpServerEntry(await ensureTocMcpServer(), 'montree-toc')
        : acpState.montreeMcp
          ? mcpServerEntry(acpState.montreeMcp, 'montree')
          : []
    const result = await sdkRequest<Record<string, unknown>, Record<string, unknown>>(
      a.value,
      methods.agent.session.new,
      {
        cwd: resolvedCwd,
        mcpServers,
      },
    )
    const id = typeof result.sessionId === 'string' ? result.sessionId : null
    if (!id) {
      return err({ code: 'ACP_PROTOCOL_ERROR', message: 'session/new 未返回 sessionId' })
    }
    if (!acpState.workspaceRoot) acpState.workspaceRoot = resolvedCwd
    return ok({
      sessionId: id,
      configOptions: parseAcpConfigOptions(result.configOptions),
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
    return ok({ stopReason })
  } catch (error) {
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
  // App 退出：整树杀干净，不保温
  void disconnectAcp(undefined, { killProcess: true })
  disposeAllAcpProcesses()
}
