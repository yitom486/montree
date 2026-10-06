import type {
  ClientApp,
  ClientConnection,
} from '@agentclientprotocol/sdk'
import {
  MONTREE_SETTLE_COMPLETE_KIND,
  type AcpConnectionStatus,
  type AcpPermissionOutcome,
  type AcpPromptCapabilities,
  type AcpSessionUpdateEvent,
  type AcpStatusChangedEvent,
  type MontreeSnapshotArgs,
  type MontreeSnapshotResource,
} from '@montree/contracts'
import type { SdkStreamHandle } from './sdk-client'
import type { SpawnedAcpProcess } from './process-manager'
import type { MontreeMcpServerHandle } from './mcp/montree-mcp-server'
import { AcpTerminalManager } from './acp-terminal'

/** 协议版本（与 Agent initialize 握手协商一致，单点定义供 connection 读写） */
export const PROTOCOL_VERSION = 1

/**
 * load 恢复后历史重放定居窗口时长（单处可调）：
 * cursor 在 `session/load` 响应返回后异步重放历史 `session/update`，
 * 落在请求期压制（try/finally）之外，靠该滑动窗口丢弃。
 */
export const SUPPRESS_SETTLE_WINDOW_MS = 2500

export type AcpSessionUpdateListener = (event: AcpSessionUpdateEvent) => void
export type AcpStatusListener = (event: AcpStatusChangedEvent) => void
export type AcpPermissionBridge = (payload: {
  requestId: number
  sessionId?: string
  params: Record<string, unknown>
}) => Promise<AcpPermissionOutcome>
export type AcpSnapshotBridge = (payload: {
  requestId: number
  resource: MontreeSnapshotResource
  args?: MontreeSnapshotArgs
}) => Promise<string>

/**
 * ACP 客户端单例状态（最底层模块，禁止 import ./acp-* 其他拆分模块，避免循环依赖）。
 * 原 `acp-client.ts` 顶层 `let` 全部收拢至此，connection / session-ops / bridges 经 `acpState` 读写。
 */
export const acpState: {
  sdkApp: ClientApp | null
  sdkConn: ClientConnection | null
  sdkStream: SdkStreamHandle | null
  terminalManager: AcpTerminalManager
  processHandle: SpawnedAcpProcess | null
  sessionId: string | null
  runtimeId: string | null
  workspaceRoot: string | null
  loadSessionSupported: boolean
  resumeSessionSupported: boolean
  cachedPromptCapabilities: AcpPromptCapabilities
  /** 本次连接周期内希望恢复的旧 session（来自 UI thread.agentSessionId） */
  pendingResumeSessionId: string | null
  /**
   * 本次连接周期内激活线程是否有本地实质消息（来自 connect.hasLocalHistory）：
   * false = 空线程（仅系统消息/空白），load 回放仅监视不限流，由回放重建时间线；
   * true/null = 非空或未知，照常压制回放。openSessionAfterAuth 消费后即清空。
   */
  pendingHasLocalHistory: boolean | null
  /** session/load 回放历史时压制转发，避免与本地气泡重复 */
  suppressSessionUpdates: boolean
  /**
   * 定居窗口到期时间戳（ms epoch，0 = 未 arm）：
   * load 恢复成功后由连接编排 arm，窗口内命中的 update 顺延窗口；
   * 非空线程丢弃回放，空线程（monitorOnly）放行回放但同样顺延；
   * 过期或静默超时则广播定居完成收尾；prompt 发起 / disconnect / 新 connect 开始时 disarm。
   */
  suppressSettleUntil: number
  /**
   * 定居窗口监视模式（仅 arm 期间有效）：
   * true = 空线程例外，放行回放并滑动窗口，静默超时后同样广播收尾冻结；
   * false = 照常丢弃窗口内 update。
   */
  suppressSettleMonitorOnly: boolean
  /** 定居窗口静默超时计时器（滑动顺延，fire 即 disarm + 广播收尾；disarm 时清除） */
  settleTimer: ReturnType<typeof setTimeout> | null
  /** 防止连点「连接」时旧 disconnect 拆掉新连接 */
  connectGeneration: number
  cachedAgentName: string | undefined
  cachedAgentVersion: string | undefined
  cachedProtocolVersion: number
  status: AcpConnectionStatus
  permissionBridge: AcpPermissionBridge | null
  snapshotBridge: AcpSnapshotBridge | null
  snapshotRequestSeq: number
  /** 权限请求自增序号（供 UI 回显，无待决 Map，直返 bridge 结果） */
  permissionSeq: number
  montreeMcp: MontreeMcpServerHandle | null
  /** 目录副会话专用端点句柄（懒启动，随 disconnect 关闭） */
  tocMcp: MontreeMcpServerHandle | null
  /** 已绑过退出监听的温进程（复用时刷新代际，避免监听器堆积） */
  exitWatch: { handle: SpawnedAcpProcess; listener: () => void } | null
  sessionUpdateListeners: Set<AcpSessionUpdateListener>
  statusListeners: Set<AcpStatusListener>
  activePromptSessionId: string | null
} = {
  sdkApp: null,
  sdkConn: null,
  sdkStream: null,
  terminalManager: new AcpTerminalManager(),
  processHandle: null,
  sessionId: null,
  runtimeId: null,
  workspaceRoot: null,
  loadSessionSupported: false,
  resumeSessionSupported: false,
  cachedPromptCapabilities: {},
  pendingResumeSessionId: null,
  pendingHasLocalHistory: null,
  suppressSessionUpdates: false,
  suppressSettleUntil: 0,
  suppressSettleMonitorOnly: false,
  settleTimer: null,
  connectGeneration: 0,
  cachedAgentName: undefined,
  cachedAgentVersion: undefined,
  cachedProtocolVersion: PROTOCOL_VERSION,
  status: 'disconnected',
  permissionBridge: null,
  snapshotBridge: null,
  snapshotRequestSeq: 0,
  permissionSeq: 0,
  montreeMcp: null,
  tocMcp: null,
  exitWatch: null,
  sessionUpdateListeners: new Set<AcpSessionUpdateListener>(),
  statusListeners: new Set<AcpStatusListener>(),
  activePromptSessionId: null,
}

export function setStatus(next: AcpConnectionStatus, errorMessage?: string): void {
  acpState.status = next
  const event: AcpStatusChangedEvent = {
    status: next,
    runtimeId: acpState.runtimeId ?? undefined,
    sessionId: acpState.sessionId,
    errorMessage,
  }
  for (const listener of acpState.statusListeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('[acp] status listener error', error)
    }
  }
}

export function onAcpSessionUpdate(listener: AcpSessionUpdateListener): () => void {
  acpState.sessionUpdateListeners.add(listener)
  return () => {
    acpState.sessionUpdateListeners.delete(listener)
  }
}

export function onAcpStatusChanged(listener: AcpStatusListener): () => void {
  acpState.statusListeners.add(listener)
  return () => {
    acpState.statusListeners.delete(listener)
  }
}

export function getAcpStatus(): AcpConnectionStatus {
  return acpState.status
}

export function getAcpSessionId(): string | null {
  return acpState.sessionId
}

function clearSettleTimer(): void {
  if (acpState.settleTimer) {
    clearTimeout(acpState.settleTimer)
    acpState.settleTimer = null
  }
}

function restartSettleTimer(): void {
  clearSettleTimer()
  acpState.settleTimer = setTimeout(onSettleTimerFired, SUPPRESS_SETTLE_WINDOW_MS)
  // 主进程常驻：超时器不撑住事件循环；单测用、心跳无影响
  const timer = acpState.settleTimer as unknown as { unref?: () => void }
  if (typeof timer.unref === 'function') timer.unref()
}

/** 静默超时：窗口内再无回放活动即收尾（disarm + 广播，冻结漏网的 streaming 残留） */
function onSettleTimerFired(): void {
  acpState.settleTimer = null
  if (acpState.suppressSettleUntil === 0) return
  acpState.suppressSettleUntil = 0
  acpState.suppressSettleMonitorOnly = false
  if (process.env.NODE_ENV !== 'production') {
    console.info('[acp:settle] window expired, broadcast settle-complete')
  }
  broadcastSettleComplete()
}

/**
 * load 恢复成功后 arm 定居窗口（即使请求期压制已结束）。
 * monitorOnly = 空线程例外：放行回放（仍滑动窗口 + 静默超时收尾），由回放重建时间线。
 */
export function armSuppressSettle(
  now: number = Date.now(),
  opts?: { monitorOnly?: boolean },
): void {
  acpState.suppressSettleUntil = now + SUPPRESS_SETTLE_WINDOW_MS
  acpState.suppressSettleMonitorOnly = opts?.monitorOnly === true
  restartSettleTimer()
}

/** 窗口内命中回放即顺延（滑动静默，覆盖 load 响应后的异步历史重放） */
export function slideSuppressSettle(now: number = Date.now()): void {
  if (acpState.suppressSettleUntil === 0) return
  acpState.suppressSettleUntil = now + SUPPRESS_SETTLE_WINDOW_MS
  restartSettleTimer()
}

/**
 * 真实更新前放行：prompt 发起 / disconnect / 新 connect 开始时调用。
 * 仅清定居窗口与计时器（静默，不广播：prompt/disconnect 自有 finishStreaming 收尾，
 * 此处广播会把刚 begin 的空 agent 气泡提前冻结）；请求期 suppress 仍归
 * session-open try/finally 与副会话 load 的主人管理。
 */
export function disarmSuppressSettle(): void {
  acpState.suppressSettleUntil = 0
  acpState.suppressSettleMonitorOnly = false
  clearSettleTimer()
}

/**
 * 定居完成收尾广播（经既有 session/update 通道，渲染端冻结残留 streaming，不碰 prompting）：
 * 定居窗口过期（下一条真实更新触发）或静默超时（计时器触发）时调用一次。
 */
export function broadcastSettleComplete(): void {
  const sid =
    acpState.activePromptSessionId ?? acpState.sessionId ?? ''
  const event: AcpSessionUpdateEvent = {
    sessionId: sid,
    update: { sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND },
  }
  for (const listener of acpState.sessionUpdateListeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('[acp] session update listener error', error)
    }
  }
}
