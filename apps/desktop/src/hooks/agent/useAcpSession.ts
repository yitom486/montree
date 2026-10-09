import { useCallback, useEffect, useRef, useState } from 'react'
import { findBuiltinAcpRuntime, isOk } from '@montree/contracts'
import type {
  AcpAuthMethod,
  AcpConfigOption,
  AcpConnectReadyResult,
  AcpContentBlock,
} from '@montree/contracts'
import type { AcpMessageAttachment } from '@/lib/agent/acp-composer'
import { acpApi } from '@/api/acp-api'
import { buildMontreePromptPrefix } from '@/lib/agent/context/build-prompt-prefix'
import {
  markSessionBootstrapSent,
  shouldSendSessionBootstrap,
} from '@/lib/agent/context/session-bootstrap'
import { resetTurnContextTracker } from '@/lib/agent/context/should-attach-turn-context'
import { listPreferredConfigPatches } from '@/lib/agent/acp-config-preferences'
import { selectFastDefaultOffTarget } from '@/lib/agent/acp-config-menu'
import {
  pickDashCounterpart,
  selectSuffixFastState,
} from '@/lib/agent/acp-model-thinking'
import { acpDevLog, acpDevWarn } from '@/lib/agent/acp-dev-log'
import { flushAcpStreamBuffer, registerStreamAuthReset } from '@/lib/agent/acp-stream-host'
import { formatAcpConnectedMessage } from '@/lib/agent/acp-session-restore'
import {
  selectActiveThreadAgentSessionId,
  selectActiveThreadHasSubstantiveMessages,
} from '@/stores/acp-ui-store'
import { reportAppError } from '@/lib/workspace/report-error'
import { useAcpUiStore } from '@/stores/acp-ui-store'

function activeThreadAgentSessionId(): string | undefined {
  return selectActiveThreadAgentSessionId(useAcpUiStore.getState())
}

/**
 * 用户可见系统消息用运行时显示名（去技术化，不暴露 acp 名词）。
 * dev 日志与 bridge 日志保持 id 不变以便排障。
 */
function resolveAcpRuntimeDisplayName(runtimeId: string): string {
  return findBuiltinAcpRuntime(runtimeId)?.name ?? runtimeId
}

/** 空线程例外提示：当前激活线程是否有本地实质消息，供主进程决定 load 回放压制与否 */
function activeThreadHasLocalHistory(): boolean {
  return selectActiveThreadHasSubstantiveMessages(useAcpUiStore.getState())
}

/** 连接就绪后：把 Zustand 里记住的 Mode/Model 等写回当前 ACP session */
async function applyStoredConfigPreferences(
  sessionId: string,
  runtimeId: string,
  initialOptions: AcpConfigOption[],
): Promise<AcpConfigOption[]> {
  const preferred =
    useAcpUiStore.getState().preferredConfigByRuntime[runtimeId] ?? undefined
  const patches = listPreferredConfigPatches(initialOptions, preferred)
  if (patches.length === 0) return initialOptions

  let latest = initialOptions
  for (const patch of patches) {
    const result = await acpApi.setConfigOption({
      sessionId,
      configId: patch.configId,
      value: patch.value,
    })
    if (!isOk(result)) {
      console.warn('[acp-ui] 套用配置偏好失败', patch, result.error)
      continue
    }
    if (result.value.configOptions.length > 0) {
      latest = result.value.configOptions
    }
  }
  return latest
}

export function useAcpSession(workspaceRoot?: string) {
  const setStatus = useAcpUiStore((s) => s.setStatus)
  const setSession = useAcpUiStore((s) => s.setSession)
  const setConfigOptions = useAcpUiStore((s) => s.setConfigOptions)
  const rememberConfigPreference = useAcpUiStore((s) => s.rememberConfigPreference)
  const applySessionUpdate = useAcpUiStore((s) => s.applySessionUpdate)
  const finishStreaming = useAcpUiStore((s) => s.finishStreaming)
  const appendUserMessage = useAcpUiStore((s) => s.appendUserMessage)
  const appendSystemMessage = useAcpUiStore((s) => s.appendSystemMessage)
  const beginAgentReply = useAcpUiStore((s) => s.beginAgentReply)
  const setPrompting = useAcpUiStore((s) => s.setPrompting)
  const setPromptCapabilities = useAcpUiStore((s) => s.setPromptCapabilities)
  const clearMessagesInStore = useAcpUiStore((s) => s.clearMessages)
  const selectedRuntimeId = useAcpUiStore((s) => s.selectedRuntimeId)
  const sessionId = useAcpUiStore((s) => s.sessionId)
  const prompting = useAcpUiStore((s) => s.prompting)

  const [authOpen, setAuthOpen] = useState(false)
  const [authMethods, setAuthMethods] = useState<AcpAuthMethod[]>([])
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  /** 弹窗内 methods 归属的运行时：completeAuth 前必须与当前选中一致，防止串 runtime */
  const [authRuntimeId, setAuthRuntimeId] = useState<string | null>(null)

  /**
   * 连接代际：connect / switchRuntime / sync / disconnect 任一新流程启动即 +1。
   * 渲染端此前对滞后 IPC 响应无任何防线——旧运行时的 needs_auth 会盖掉新连接的
   * connected（标题读 live selectedRuntimeId，methods 却是旧的），必须丢弃。
   */
  const connectionEpochRef = useRef(0)
  const bumpConnectionEpoch = useCallback(() => {
    connectionEpochRef.current += 1
    return connectionEpochRef.current
  }, [])
  // 接收冲刷走应用级宿主（`acp-stream-host`）；各发送/取消/断开路径先冲刷再收尾，
  // 否则尾部 chunk 可能丢失或错序
  const flushBufferedChunks = useCallback(() => {
    flushAcpStreamBuffer()
  }, [])

  useEffect(() => {
    // 本实例只登记认证弹窗清理回调；IPC 订阅的生命周期归应用宿主，
    // 与本组件挂载与否无关（见 `acp-stream-host.ts`）
    return registerStreamAuthReset({
      resetAuthUi: () => {
        setAuthOpen(false)
        setAuthMethods([])
        setAuthRuntimeId(null)
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finalizeConnected = useCallback(
    async (result: AcpConnectReadyResult, prefix: string) => {
      setStatus('connected')
      // 成功即收掉可能残留的认证弹窗（滞后 needs_auth 不应再出现，见 epoch 防线）
      setAuthOpen(false)
      setAuthMethods([])
      setAuthRuntimeId(null)
      setAuthError(null)
      const options = result.configOptions ?? []
      acpDevLog('session configOptions', {
        runtimeId: useAcpUiStore.getState().selectedRuntimeId,
        options,
      })
      setSession(result.sessionId, options)
      setPromptCapabilities(result.promptCapabilities ?? {})
      // 横杠目录写入内存态（无目录=后续逻辑一律跳过，行为与现状一致）
      try {
        const ridForCatalog =
          result.runtimeId?.trim() || useAcpUiStore.getState().selectedRuntimeId
        useAcpUiStore.getState().setModelCatalog(ridForCatalog, result.modelCatalog ?? null)
      } catch {
        // 目录写入失败不阻断连接
      }
      appendSystemMessage(formatAcpConnectedMessage(result, prefix))

      const applied = await applyStoredConfigPreferences(
        result.sessionId,
        useAcpUiStore.getState().selectedRuntimeId,
        options,
      )
      let latest = applied
      // fast 默认关一次：首次连接该运行时若 Agent 默认开且用户从未拨过，关一次并记住；
      // 有存储偏好后永不强改（用户偏好为准）。失败不抛，静默保留 Agent 原值。
      const fastTarget = selectFastDefaultOffTarget(
        applied,
        useAcpUiStore.getState().preferredConfigByRuntime,
        useAcpUiStore.getState().selectedRuntimeId,
      )
      if (fastTarget) {
        const offResult = await acpApi.setConfigOption({
          sessionId: result.sessionId,
          configId: fastTarget.configId,
          value: false,
        })
        if (isOk(offResult)) {
          useAcpUiStore.getState().rememberConfigPreference(
            useAcpUiStore.getState().selectedRuntimeId,
            fastTarget.configId,
            false,
          )
          if (offResult.value.configOptions.length > 0) {
            latest = offResult.value.configOptions
          }
        } else {
          acpDevWarn('fast 默认关闭失败', { configId: fastTarget.configId, error: offResult.error })
        }
      }
      // 尾缀 fast 默认关一次（dash 受控尝试，最后候补）：boolean 版无目标、当前尾缀
      // fast=true、用户从未拨过该模型项、目录有精确 dash off 对应时，静默试一次。
      // 尾缀 listed 版默认关已删除（见 parameterized-model-picker.md §6），此处只试 dash；
      // 成功即记住（“一次”语义），失败静默保留 Agent 原值，不打扰用户。
      if (!fastTarget) {
        try {
          const suffix = selectSuffixFastState(latest)
          const rid = useAcpUiStore.getState().selectedRuntimeId
          const cid = suffix?.configId.trim() ?? ''
          const stored = cid ? (useAcpUiStore.getState().preferredConfigByRuntime[rid]?.[cid] ?? null) : '__skip__'
          if (suffix?.checked && cid && (stored == null || stored === '')) {
            const modelOpt = latest.find((o) => o.configId === suffix.configId)
            const currentValue =
              typeof modelOpt?.currentValue === 'string' ? modelOpt.currentValue : null
            const dashOff =
              currentValue && result.modelCatalog && result.modelCatalog.length > 0
                ? pickDashCounterpart(result.modelCatalog, currentValue, {
                    key: 'fast',
                    value: 'false',
                  })
                : null
            if (dashOff) {
              const dashResult = await acpApi.setConfigOption({
                sessionId: result.sessionId,
                configId: suffix.configId,
                value: dashOff,
              })
              if (isOk(dashResult)) {
                useAcpUiStore.getState().rememberConfigPreference(rid, suffix.configId, dashOff)
                if (dashResult.value.configOptions.length > 0) {
                  latest = dashResult.value.configOptions
                }
              } else {
                acpDevWarn('fast 默认关闭失败（dash 候补）', {
                  configId: suffix.configId,
                  error: dashResult.error,
                })
              }
            }
          }
        } catch (error) {
          acpDevWarn('fast 默认关闭异常（dash 候补）', error)
        }
      }
      if (latest !== options) {
        setConfigOptions(latest)
      }

      if (
        result.requestedSessionId &&
        !result.sessionRestored &&
        (result.restoreAttempts?.length ?? 0) > 0
      ) {
        acpDevWarn('session restore fell back to new', {
          requestedSessionId: result.requestedSessionId,
          newSessionId: result.sessionId,
          restoreAttempts: result.restoreAttempts,
          restoreMethod: result.restoreMethod,
        })
      } else {
        acpDevLog('session ready', {
          sessionId: result.sessionId,
          sessionRestored: result.sessionRestored,
          restoreMethod: result.restoreMethod,
          requestedSessionId: result.requestedSessionId,
        })
      }
    },
    [appendSystemMessage, setConfigOptions, setPromptCapabilities, setSession, setStatus],
  )

  const connect = useCallback(async () => {
    const cwd = workspaceRoot?.trim() || undefined
    const statusNow = useAcpUiStore.getState().status
    if (statusNow === 'connecting' || statusNow === 'awaiting_auth') {
      appendSystemMessage('正在连接中，请稍候…')
      return
    }
    const epoch = bumpConnectionEpoch()
    setStatus('connecting')
    setAuthError(null)
    const resumeSessionId = activeThreadAgentSessionId()
    const displayName = resolveAcpRuntimeDisplayName(selectedRuntimeId)
    appendSystemMessage(
      resumeSessionId
        ? `正在连接 ${displayName}（尝试恢复会话 ${resumeSessionId.slice(0, 8)}…）…`
        : `正在连接 ${displayName}${cwd ? '' : '（网页会话）'}…`,
    )
    const result = await acpApi.connect({
      runtimeId: selectedRuntimeId,
      cwd,
      resumeSessionId,
      hasLocalHistory: activeThreadHasLocalHistory(),
    })
    // 滞后响应：连接期间用户已切走（新流程 bump 了 epoch），一律丢弃
    if (epoch !== connectionEpochRef.current) return
    if (!isOk(result)) {
      setStatus('error', result.error.message, result.error.code)
      reportAppError(result.error)
      appendSystemMessage(`连接失败：${result.error.message}`)
      return
    }

    if (result.value.phase === 'needs_auth') {
      // 防串 runtime：只接受归属当前选中运行时的认证请求
      if (result.value.runtimeId !== useAcpUiStore.getState().selectedRuntimeId) return
      setStatus('awaiting_auth')
      setAuthMethods(result.value.authMethods)
      setAuthRuntimeId(result.value.runtimeId)
      setAuthOpen(true)
      appendSystemMessage('需要认证：请选择登录方式')
      return
    }

    await finalizeConnected(result.value, '已连接')
  }, [
    appendSystemMessage,
    bumpConnectionEpoch,
    finalizeConnected,
    selectedRuntimeId,
    setStatus,
    workspaceRoot,
  ])

  // 子会话连接请求信令（制卡/测验）：nonce 变化且当前未连/出错时，
  // 走完整 connect（含认证弹窗与 epoch 防线）。认证仍需用户点一下——
  // 这是唯一需要主 UI 出面的环节，子会话自己绝不碰 auth 状态机。
  const connectRequestedAt = useAcpUiStore((s) => s.connectRequestedAt)
  useEffect(() => {
    if (!connectRequestedAt) return
    const statusNow = useAcpUiStore.getState().status
    if (statusNow === 'disconnected' || statusNow === 'error') {
      void connect()
    }
  }, [connectRequestedAt, connect])

  const completeAuth = useCallback(
    async (methodId: string) => {
      // 弹窗打开后用户可能已切换 Agent：归属不一致则拒绝，避免把旧方式发给新服务端
      if (
        authRuntimeId !== null &&
        authRuntimeId !== useAcpUiStore.getState().selectedRuntimeId
      ) {
        setAuthError('已切换 Agent，该登录方式已过期，请重新连接。')
        return
      }
      setAuthBusy(true)
      setAuthError(null)
      const result = await acpApi.authenticate({ methodId })
      setAuthBusy(false)
      if (!isOk(result)) {
        setAuthError(result.error.message)
        reportAppError(result.error)
        return
      }
      setAuthOpen(false)
      setAuthMethods([])
      setAuthRuntimeId(null)
      await finalizeConnected(result.value, '已认证并连接')
    },
    [authRuntimeId, finalizeConnected],
  )

  const cancelAuth = useCallback(async () => {
    bumpConnectionEpoch()
    setAuthOpen(false)
    setAuthMethods([])
    setAuthRuntimeId(null)
    setAuthError(null)
    await acpApi.disconnect()
    setSession(null)
    setStatus('disconnected')
    appendSystemMessage('已取消认证')
  }, [appendSystemMessage, bumpConnectionEpoch, setSession, setStatus])

  const disconnect = useCallback(async () => {
    bumpConnectionEpoch()
    const result = await acpApi.disconnect()
    if (!isOk(result)) {
      reportAppError(result.error)
      return
    }
    setSession(null)
    setStatus('disconnected')
    flushBufferedChunks()
    finishStreaming()
    setAuthOpen(false)
    appendSystemMessage('已断开连接（本对话会话 id 已保留，重连时可恢复）')
  }, [appendSystemMessage, bumpConnectionEpoch, finishStreaming, flushBufferedChunks, setSession, setStatus])

  /**
   * 切换 ACP 运行时：若当前正处于连接态，会自动断开旧运行时并立即连接新运行时；若处于离线态，直接连接新运行时。
   */
  const switchRuntime = useCallback(
    async (nextRuntimeId: string) => {
      const current = useAcpUiStore.getState().selectedRuntimeId
      if (!nextRuntimeId) return
      if (nextRuntimeId === current) {
        if (useAcpUiStore.getState().status === 'disconnected') {
          void connect()
        }
        return
      }
      useAcpUiStore.getState().setSelectedRuntimeId(nextRuntimeId)
      const statusNow = useAcpUiStore.getState().status
      if (
        statusNow === 'connected' ||
        statusNow === 'connecting' ||
        statusNow === 'awaiting_auth'
      ) {
        await disconnect()
        // disconnect 内部已 bump epoch，此处重新捕获，之后只认本流程的响应
        const epoch = bumpConnectionEpoch()
        const cwd = workspaceRoot?.trim() || undefined
        setStatus('connecting')
        setAuthError(null)
        const resumeSessionId = activeThreadAgentSessionId()
        const nextDisplayName = resolveAcpRuntimeDisplayName(nextRuntimeId)
        appendSystemMessage(
          resumeSessionId
            ? `正在切换至 ${nextDisplayName}（尝试恢复会话 ${resumeSessionId.slice(0, 8)}…）…`
            : `正在切换至 ${nextDisplayName}${cwd ? '' : '（网页会话）'}…`,
        )
        const result = await acpApi.connect({
          runtimeId: nextRuntimeId,
          cwd,
          resumeSessionId,
          hasLocalHistory: activeThreadHasLocalHistory(),
        })
        if (epoch !== connectionEpochRef.current) return
        if (!isOk(result)) {
          setStatus('error', result.error.message, result.error.code)
          reportAppError(result.error)
          appendSystemMessage(`连接失败：${result.error.message}`)
          return
        }

        if (result.value.phase === 'needs_auth') {
          // 防串 runtime：旧流程滞后返回的 needs_auth 直接丢弃
          if (result.value.runtimeId !== useAcpUiStore.getState().selectedRuntimeId) return
          setStatus('awaiting_auth')
          setAuthMethods(result.value.authMethods)
          setAuthRuntimeId(result.value.runtimeId)
          setAuthOpen(true)
          appendSystemMessage('需要认证：请选择登录方式')
          return
        }

        await finalizeConnected(result.value, `已连接至 ${resolveAcpRuntimeDisplayName(nextRuntimeId)}`)
      } else {
        void connect()
      }
    },
    [appendSystemMessage, bumpConnectionEpoch, connect, disconnect, finalizeConnected, setStatus, workspaceRoot],
  )

  // 子会话运行时切换请求信令（目录/制卡/测验）
  const runtimeSwitchRequestedAt = useAcpUiStore((s) => s.runtimeSwitchRequestedAt)
  const requestedRuntimeId = useAcpUiStore((s) => s.requestedRuntimeId)
  useEffect(() => {
    if (!runtimeSwitchRequestedAt || !requestedRuntimeId) return
    void switchRuntime(requestedRuntimeId)
  }, [runtimeSwitchRequestedAt, requestedRuntimeId, switchRuntime])

  /**
   * 对齐 Agent 到当前本地线程：离线会自动连接；已连接则按需重连并 resume。
   * - 当前运行时下有 agentSessionIds[id] → connect(resume)
   * - 无 → connect(new)（换运行时后旧会话不会跨 Agent 串线）
   * @param forceReconnect 工作区 cwd 变更时强制重连（即使 sessionId 已对齐）
   */
  const syncAgentSessionToActiveThread = useCallback(async (
    forceReconnect = false,
  ): Promise<boolean> => {
    const cwd = workspaceRoot?.trim() || undefined
    const statusNow = useAcpUiStore.getState().status
    if (statusNow === 'connecting' || statusNow === 'awaiting_auth') {
      acpDevLog('sync skip: status busy', { statusNow })
      return false
    }
    if (useAcpUiStore.getState().prompting) {
      appendSystemMessage('请先停止当前回合，再切换历史对话。')
      return false
    }

    const epoch = bumpConnectionEpoch()
    const resumeSessionId = activeThreadAgentSessionId()
    const liveSessionId = useAcpUiStore.getState().sessionId?.trim() || undefined
    const alreadyAligned =
      !forceReconnect &&
      statusNow === 'connected' &&
      Boolean(resumeSessionId) &&
      Boolean(liveSessionId) &&
      resumeSessionId === liveSessionId

    if (alreadyAligned) {
      acpDevLog('sync skip: already on target session', { resumeSessionId })
      return true
    }

    const wasOnline = statusNow === 'connected' || statusNow === 'error'
    acpDevLog('sync start', {
      statusNow,
      wasOnline,
      forceReconnect,
      resumeSessionId: resumeSessionId ?? null,
      liveSessionId: liveSessionId ?? null,
      runtimeId: selectedRuntimeId,
      cwd: cwd ?? '(sandbox)',
    })

    setStatus('connecting')
    setAuthError(null)
    appendSystemMessage(
      resumeSessionId
        ? wasOnline
          ? `正在切换到历史会话 ${resumeSessionId.slice(0, 8)}…`
          : `正在连接并恢复历史会话 ${resumeSessionId.slice(0, 8)}…`
        : wasOnline
          ? '正在为当前对话创建新的 Agent 会话…'
          : `正在连接 ${resolveAcpRuntimeDisplayName(selectedRuntimeId)}${cwd ? '' : '（网页会话）'}…`,
    )

    if (wasOnline) {
      const disconnected = await acpApi.disconnect()
      if (!isOk(disconnected)) {
        acpDevWarn('sync disconnect failed', disconnected.error)
        setStatus('error', disconnected.error.message, disconnected.error.code)
        reportAppError(disconnected.error)
        appendSystemMessage(`切换会话失败：${disconnected.error.message}`)
        return false
      }
      setSession(null)
      flushBufferedChunks()
      finishStreaming()
      setStatus('connecting')
    }

    const result = await acpApi.connect({
      runtimeId: selectedRuntimeId,
      cwd,
      resumeSessionId,
      hasLocalHistory: activeThreadHasLocalHistory(),
    })
    if (epoch !== connectionEpochRef.current) return false
    if (!isOk(result)) {
      acpDevWarn('sync connect failed', result.error)
      setStatus('error', result.error.message, result.error.code)
      reportAppError(result.error)
      appendSystemMessage(`连接失败：${result.error.message}`)
      return false
    }

    if (result.value.phase === 'needs_auth') {
      if (result.value.runtimeId !== useAcpUiStore.getState().selectedRuntimeId) {
        // 滞后于切换的旧响应：静默丢弃
        return false
      }
      acpDevLog('sync needs auth', { methods: result.value.authMethods.length })
      setStatus('awaiting_auth')
      setAuthMethods(result.value.authMethods)
      setAuthRuntimeId(result.value.runtimeId)
      setAuthOpen(true)
      appendSystemMessage('需要认证：请选择登录方式')
      return false
    }

    const prefix = resumeSessionId
      ? wasOnline
        ? '已切换历史会话'
        : '已连接并恢复历史会话'
      : wasOnline
        ? '已为当前对话新建会话'
        : '已连接'

    await finalizeConnected(result.value, prefix)
    acpDevLog('sync done', {
      sessionId: result.value.sessionId,
      sessionRestored: result.value.sessionRestored,
      restoreAttempts: result.value.restoreAttempts,
    })
    return true
  }, [
    appendSystemMessage,
    bumpConnectionEpoch,
    finalizeConnected,
    finishStreaming,
    flushBufferedChunks,
    selectedRuntimeId,
    setSession,
    setStatus,
    workspaceRoot,
  ])

  /** 打开 / 关闭用户工作区时，已连接会话需换 cwd（沙箱 ↔ 本地目录） */
  const cwdKeyRef = useRef<string | undefined>(undefined)
  const cwdReadyRef = useRef(false)
  useEffect(() => {
    const next = workspaceRoot?.trim() || undefined
    if (!cwdReadyRef.current) {
      cwdReadyRef.current = true
      cwdKeyRef.current = next
      return
    }
    if (cwdKeyRef.current === next) return
    cwdKeyRef.current = next
    if (useAcpUiStore.getState().status !== 'connected') return
    if (useAcpUiStore.getState().prompting) return
    appendSystemMessage(
      next
        ? '已打开本地工作区，正在将 Agent 切到该目录…'
        : '本地工作区已关闭，正在切换为网页会话…',
    )
    void syncAgentSessionToActiveThread(true)
  }, [appendSystemMessage, syncAgentSessionToActiveThread, workspaceRoot])

  const sendPrompt = useCallback(
    async (payload: {
      text: string
      prompt: AcpContentBlock[]
      messageAttachments?: AcpMessageAttachment[]
    }) => {
      if (useAcpUiStore.getState().prompting) return
      if (!payload.prompt.length) return

      let sid = useAcpUiStore.getState().sessionId
      if (!sid) {
        acpDevLog('sendPrompt: offline, auto-connect before send')
        const ok = await syncAgentSessionToActiveThread()
        sid = useAcpUiStore.getState().sessionId
        if (!ok || !sid) {
          appendSystemMessage('自动连接未完成，请完成认证后再发送。')
          return
        }
      }

      appendUserMessage(payload.text, payload.messageAttachments)
      setPrompting(true)
      beginAgentReply()
      const includeBootstrap = shouldSendSessionBootstrap(sid)
      const prefix = buildMontreePromptPrefix(useAcpUiStore.getState().activeThreadId, {
        includeBootstrap,
      })
      const result = await acpApi.prompt({
        sessionId: sid,
        prompt: [...prefix, ...payload.prompt],
      })
      if (isOk(result) && includeBootstrap) {
        markSessionBootstrapSent(sid)
      }
      flushBufferedChunks()
      finishStreaming()
      if (!isOk(result)) {
        reportAppError(result.error)
        appendSystemMessage(`发送失败：${result.error.message}`)
        return
      }
      if (result.value.stopReason && result.value.stopReason !== 'end_turn') {
        appendSystemMessage(`回合结束：${result.value.stopReason}`)
      }
    },
    [
      appendSystemMessage,
      appendUserMessage,
      beginAgentReply,
      finishStreaming,
      setPrompting,
      syncAgentSessionToActiveThread,
      flushBufferedChunks,
    ],
  )

  /** 清空时间线等于重新开场：turn-context 计数一并归零 */
  const clearMessages = useCallback(() => {
    resetTurnContextTracker(useAcpUiStore.getState().activeThreadId)
    clearMessagesInStore()
  }, [clearMessagesInStore])

  const cancel = useCallback(async () => {
    const sid = useAcpUiStore.getState().sessionId
    if (!sid) return
    const result = await acpApi.cancel({ sessionId: sid })
    if (!isOk(result)) {
      reportAppError(result.error)
      return
    }
    useAcpUiStore.getState().clearPendingPermission()
    flushBufferedChunks()
    finishStreaming()
  }, [finishStreaming, flushBufferedChunks])

  const setModel = useCallback(
    async (configId: string, value: string | boolean): Promise<boolean> => {
      const sid = useAcpUiStore.getState().sessionId
      if (!sid) return false
      const runtimeId = useAcpUiStore.getState().selectedRuntimeId
      const result = await acpApi.setConfigOption({ sessionId: sid, configId, value })
      // 报错收敛：失败只返回 false，由面板调用方弹一个 toast；此处不写全局 toast、不写时间线
      if (!isOk(result)) {
        return false
      }
      rememberConfigPreference(runtimeId, configId, value)
      if (result.value.configOptions.length > 0) {
        setConfigOptions(result.value.configOptions)
      }
      return true
    },
    [rememberConfigPreference, setConfigOptions],
  )

  return {
    connect,
    disconnect,
    switchRuntime,
    syncAgentSessionToActiveThread,
    sendPrompt,
    cancel,
    setModel,
    clearMessages,
    sessionId,
    prompting,
    authOpen,
    authMethods,
    authBusy,
    authError,
    completeAuth,
    cancelAuth,
  }
}
