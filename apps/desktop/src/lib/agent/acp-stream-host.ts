import { MONTREE_SETTLE_COMPLETE_KIND } from '@montree/contracts'
import { acpApi } from '@/api/acp-api'
import { STREAM_FLUSH_MS, StreamCoalescer, isCoalescableAgentChunk } from '@/lib/agent/stream-coalescer'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useAnnotationAgentStore, annotationOwnsSessionId } from '@/stores/annotation-agent-store'
import { subsessionOwnsSessionId, accumulateSubsessionUpdate, isSubsessionPrompting } from '@/lib/agent/acp-subsession'

/**
 * ACP 流式推送应用级宿主（与组件挂载脱钩）。
 *
 * 原则：后端事件推送流的生命周期由应用自己管理，不由某个面板的挂载与否决定。
 * docked 侧栏常驻、floating HUD 开开关关——订阅若跟组件走，同一 chunk 进两遍
 * 合并器，时间线翻倍、体感就是"复读"。这里进程内只起一份订阅、一个合并器；
 * `startAcpStreamHost` 幂等（重复调用只返回同一个 stop），
 * 停止只发生在显式调用 stop 时（App 卸载，实践中即应用退出）。
 *
 * 实例级 UI 状态（各 AgentPanel 的认证弹窗）通过回调注册表清理——
 * 注册只登记回调，不控制订阅生命周期，实例来去自由。
 */

interface StreamAuthResetter {
  resetAuthUi: () => void
}

const authResetters = new Set<StreamAuthResetter>()

/** 各 AgentPanel 实例登记认证弹窗清理回调；只登记，不影响订阅启停 */
export function registerStreamAuthReset(resetter: StreamAuthResetter): () => void {
  authResetters.add(resetter)
  return () => {
    authResetters.delete(resetter)
  }
}

let streamBuffer: {
  coalescer: StreamCoalescer
  timer: ReturnType<typeof setTimeout> | null
} | null = null

let stopStreamHost: (() => void) | null = null

/** 各发送/取消/断开路径先冲刷再收尾，否则尾部 chunk 可能丢失或错序 */
export function flushAcpStreamBuffer(): void {
  const buf = streamBuffer
  if (!buf) return
  if (buf.timer) {
    clearTimeout(buf.timer)
    buf.timer = null
  }
  const text = buf.coalescer.flush()
  if (text) {
    useAcpUiStore.getState().applySessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: [{ type: 'text', text }],
    })
  }
}

function scheduleStreamFlush(): void {
  const buf = streamBuffer
  if (!buf || buf.timer) return
  buf.timer = setTimeout(() => flushAcpStreamBuffer(), STREAM_FLUSH_MS)
}

/**
 * 启动流式宿主（幂等）。调用方（App 根 `useAcpStreamHost`）持有返回的 stop，
 * 在 effect cleanup 中调用；重复 start 不会重复订阅。
 */
export function startAcpStreamHost(): () => void {
  if (stopStreamHost) return stopStreamHost

  streamBuffer = { coalescer: new StreamCoalescer(), timer: null }

  const offStatus = acpApi.onStatusChanged((event) => {
    const store = useAcpUiStore.getState()
    store.setStatus(event.status, event.errorMessage)
    if (event.sessionId) store.setSession(event.sessionId)
    if (event.status === 'disconnected') {
      // 清「当前连接」；勿清 thread.agentSessionIds（setSession(null) 已按运行时保留）
      store.setSession(null)
      flushAcpStreamBuffer()
      store.finishStreaming()
      for (const resetter of authResetters) resetter.resetAuthUi()
      // 批注：保留 agentSessionIds，仅标记 stale，重连后 session/load 续上
      useAnnotationAgentStore.getState().markSessionsStale()
    }
  })
  const offUpdate = acpApi.onSessionUpdate((event) => {
    // load 定居收尾直达主时间线：先冲刷合并器残留（避免尾部 chunk 在冻结后另起 streaming 气泡），
    // 再冻结；不进批注/副会话分流，不碰 prompting
    const updateKind =
      typeof event.update?.sessionUpdate === 'string' ? event.update.sessionUpdate : ''
    if (updateKind === MONTREE_SETTLE_COMPLETE_KIND) {
      flushAcpStreamBuffer()
      useAcpUiStore.getState().freezeSettledStreaming()
      return
    }
    const ann = useAnnotationAgentStore.getState()
    // 按 sessionId 分流：批注副会话绝不进右侧时间线
    if (annotationOwnsSessionId(ann, event.sessionId)) {
      ann.applySessionUpdate(event.update)
      return
    }
    // 兼容：副会话刚创建、尚未 bind 前的短窗口
    if (ann.capturing) {
      ann.applySessionUpdate(event.update)
      return
    }
    // 按 sessionId 分流：统一副会话工厂（quiz 单例 / toc 每次新建 / 制卡一书一键）
    // 归属任一副会话的增量绝不进右侧时间线，各自回填其 replyBuffer；
    // 任一副会话 prompting 期间的短窗口同样截获（沿旧三路 `|| isXxxPrompting()` 语义）
    if (subsessionOwnsSessionId(event.sessionId) || isSubsessionPrompting()) {
      accumulateSubsessionUpdate(event.sessionId, event.update)
      return
    }
    const chunkText = isCoalescableAgentChunk(event.update)
    if (chunkText) {
      streamBuffer?.coalescer.push(chunkText)
      scheduleStreamFlush()
      return
    }
    flushAcpStreamBuffer()
    useAcpUiStore.getState().applySessionUpdate(event.update)
  })

  const stop = () => {
    if (stopStreamHost !== stop) return
    flushAcpStreamBuffer()
    offStatus()
    offUpdate()
    streamBuffer = null
    stopStreamHost = null
  }
  stopStreamHost = stop
  return stop
}

/** 仅单测用：复位宿主（关订阅、清缓冲） */
export function resetAcpStreamHostForTests(): void {
  stopStreamHost?.()
  authResetters.clear()
}
