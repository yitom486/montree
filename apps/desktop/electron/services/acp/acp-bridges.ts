import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import type {
  AcpAuthMethod,
  AcpAuthPreflightResult,
  AcpPermissionOutcome,
  AcpSessionUpdateEvent,
} from '@montree/contracts'
import type {
  MontreeSnapshotArgs,
  MontreeSnapshotResource,
} from '@montree/contracts'
import type { ClientContext } from '@agentclientprotocol/sdk'
import { getAcpRuntimeAdapter } from './runtimes'
import { mapSpawnErrorToAppError } from '../bun-runtime'
import {
  acpState,
  broadcastSettleComplete,
  disarmSuppressSettle,
  slideSuppressSettle,
  type AcpPermissionBridge,
  type AcpSnapshotBridge,
} from './acp-state'

/** 非 codex-acp 运行时的中性 preflight：无本地登录痕迹 → gate 走协议 authMethods 弹向导 */
const NEUTRAL_AUTH_PREFLIGHT: AcpAuthPreflightResult = {
  codexHome: '',
  hasCodexHome: false,
  hasAuthFile: false,
  hasApiKeyEnv: false,
  looksLoggedIn: false,
}

export function toProtocolError(error: unknown, fallback: string): AppError {
  return mapSpawnErrorToAppError(error, fallback)
}

export function requireAgent(allowAuthPhase = false): Result<ClientContext, AppError> {
  if (!acpState.sdkConn) {
    return err({ code: 'ACP_NOT_CONNECTED', message: 'ACP Agent 未连接' })
  }
  if (acpState.status === 'connected') return ok(acpState.sdkConn.agent)
  if (allowAuthPhase && (acpState.status === 'connecting' || acpState.status === 'awaiting_auth')) {
    return ok(acpState.sdkConn.agent)
  }
  return err({ code: 'ACP_NOT_CONNECTED', message: 'ACP Agent 未连接' })
}

export function parseAuthMethods(raw: unknown): AcpAuthMethod[] {
  if (!Array.isArray(raw)) return []
  const parsed: AcpAuthMethod[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id) continue
    parsed.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : row.id,
      description: typeof row.description === 'string' ? row.description : undefined,
      type: typeof row.type === 'string' ? row.type : undefined,
    })
  }
  return parsed
}

/** 防御性取 adapter：`getAcpRuntimeAdapter(id)` 为准，异常时回落中性空 adapter。 */
export function safeGetAdapter(runtimeId: string) {
  try {
    return getAcpRuntimeAdapter(runtimeId)
  } catch (error) {
    console.warn('[acp] getAcpRuntimeAdapter 异常，回落中性 adapter', runtimeId, error)
    return getAcpRuntimeAdapter('__unknown__')
  }
}

export function safeProbeAuth(adapter: ReturnType<typeof getAcpRuntimeAdapter>): AcpAuthPreflightResult {
  try {
    const probed = adapter.probeAuth()
    if (probed && typeof probed === 'object') return probed
  } catch (error) {
    console.warn('[acp] probeAuth 异常，回落中性 preflight', error)
  }
  return { ...NEUTRAL_AUTH_PREFLIGHT }
}

export function safeOrderAuthMethods(
  adapter: ReturnType<typeof getAcpRuntimeAdapter>,
  methodsList: AcpAuthMethod[],
): AcpAuthMethod[] {
  if (!adapter.orderAuthMethods) return methodsList
  try {
    return adapter.orderAuthMethods(methodsList)
  } catch (error) {
    console.warn('[acp] orderAuthMethods 异常，保持原始顺序', error)
    return methodsList
  }
}

export function safeCanSkipInteractiveAuth(
  adapter: ReturnType<typeof getAcpRuntimeAdapter>,
  methodId: string,
  force?: boolean,
): boolean {
  if (!adapter.canSkipInteractiveAuth) return false
  try {
    return adapter.canSkipInteractiveAuth(methodId, force) === true
  } catch (error) {
    console.warn('[acp] canSkipInteractiveAuth 异常，走交互式认证', error)
    return false
  }
}

export function setAcpPermissionBridge(bridge: AcpPermissionBridge | null): void {
  acpState.permissionBridge = bridge
}

export function setAcpSnapshotBridge(bridge: AcpSnapshotBridge | null): void {
  acpState.snapshotBridge = bridge
}

export async function handlePermissionRequest(
  permSessionId: string | undefined,
  params: Record<string, unknown>,
): Promise<AcpPermissionOutcome> {
  console.info('[acp] handlePermissionRequest', {
    hasBridge: Boolean(acpState.permissionBridge),
    optionCount: Array.isArray(params.options) ? params.options.length : 0,
  })
  if (!acpState.permissionBridge) {
    // 无 bridge 时直接 cancelled，禁静默 allow
    console.warn('[acp] permissionBridge 不可用，直接 cancelled（禁静默 allow）')
    return { outcome: 'cancelled' }
  }

  acpState.permissionSeq += 1
  const requestId = acpState.permissionSeq
  const sid = permSessionId?.trim() ? permSessionId : (acpState.sessionId ?? undefined)
  try {
    const outcome = await acpState.permissionBridge({ requestId, sessionId: sid, params })
    console.info('[acp] permissionBridge 返回', { requestId, outcome })
    return outcome
  } catch (error) {
    console.error('[acp] permissionBridge 异常，cancelled', error)
    return { outcome: 'cancelled' }
  }
}

/** DEV 诊断：回放压制去向（验证定居窗口是否生效；生产静默） */
function devLogSettleDrop(params: Record<string, unknown>, window: string): void {
  if (process.env.NODE_ENV === 'production') return
  const update =
    params.update && typeof params.update === 'object'
      ? (params.update as Record<string, unknown>)
      : undefined
  console.info('[acp:settle] update dropped', {
    window,
    kind: typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : '?',
    sessionId: typeof params.sessionId === 'string' ? params.sessionId.slice(0, 8) : '?',
  })
}

export function emitSessionUpdate(params: Record<string, unknown>): void {
  const now = Date.now()
  // 请求期压制：只丢弃不滑动，arm 由连接编排在 load 恢复成功后执行
  if (acpState.suppressSessionUpdates) {
    devLogSettleDrop(params, 'request-window')
    return
  }
  if (acpState.suppressSettleUntil > now) {
    // 定居窗口内命中：顺延窗口；非空线程丢弃回放，空线程（monitorOnly）放行重建
    slideSuppressSettle(now)
    if (!acpState.suppressSettleMonitorOnly) {
      devLogSettleDrop(params, 'settle-window')
      return
    }
  } else if (acpState.suppressSettleUntil !== 0) {
    // 定居窗口过期：本条真实更新先放行，随后广播收尾（冻结漏网的 streaming 残留，不等 prompt）
    disarmSuppressSettle()
    forwardSessionUpdate(params)
    broadcastSettleComplete()
    return
  }
  forwardSessionUpdate(params)
}

function forwardSessionUpdate(params: Record<string, unknown>): void {  const sid =
    typeof params.sessionId === 'string' && params.sessionId.trim()
      ? params.sessionId.trim()
      : (acpState.activePromptSessionId ?? acpState.sessionId ?? '')
  const update =
    params.update && typeof params.update === 'object'
      ? (params.update as Record<string, unknown>)
      : params
  const event: AcpSessionUpdateEvent = { sessionId: sid, update }
  for (const listener of acpState.sessionUpdateListeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('[acp] session update listener error', error)
    }
  }
}

export async function handleSnapshotRequest(
  resource: MontreeSnapshotResource,
  args?: MontreeSnapshotArgs,
): Promise<string> {
  if (!acpState.snapshotBridge) {
    throw new Error('Montree 快照桥未就绪，请稍后重试')
  }
  acpState.snapshotRequestSeq += 1
  return await acpState.snapshotBridge({ requestId: acpState.snapshotRequestSeq, resource, args })
}
