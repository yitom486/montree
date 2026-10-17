import { MONTREE_SETTLE_COMPLETE_KIND } from '@yitom/contracts'
import { acpApi } from '@/api/acp-api'
import { STREAM_FLUSH_MS, StreamCoalescer, isCoalescableAgentChunk } from '@/lib/agent/stream-coalescer'
import { useAcpUiStore, selectActiveThreadAgentSessionId } from '@/stores/acp-ui-store'
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
  owner: { threadId: string; sessionId: string | null; runtimeId: string } | null
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
  const owner = buf.owner
  buf.owner = null
  const text = buf.coalescer.flush()
  if (!text || !owner) return
  const host = useAcpUiStore.getState()
  const activeSid = selectActiveThreadAgentSessionId(host) ?? host.sessionId
  // A timer belongs to its original thread/session/runtime. Switching drops an orphan;
  // it must never turn buffered old text into a chunk for the newly active conversation.
  if (host.activeThreadId !== owner.threadId || host.selectedRuntimeId !== owner.runtimeId || activeSid !== owner.sessionId) return
  host.applySessionUpdate({ sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text }] })

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

  streamBuffer = { coalescer: new StreamCoalescer(), timer: null, owner: null }

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
      // C2b1：定居早退同样受会话归属保护——过期会话的迟到标记直接丢弃，
      // 否则冲刷会把旧会话尾巴写进新线程、冻结也会落在错误的线程。
      // 与下方常规路径同一判定（两者都无 sessionId 时不拦截）。
      const mainStore = useAcpUiStore.getState()
      const activeMainSid = selectActiveThreadAgentSessionId(mainStore) ?? mainStore.sessionId
      if (event.sessionId && (activeMainSid ? event.sessionId !== activeMainSid :
        mainStore.threads.some(thread => thread.id !== mainStore.activeThreadId &&
          Object.values(thread.agentSessionIds ?? {}).includes(event.sessionId)))) {
        return
      }
      flushAcpStreamBuffer()
      useAcpUiStore.getState().applySessionUpdate(event.update)
      // 宿主先落定待处理用户回放再同步包；再次映射为 finish-turn 会错误地终结恢复回合。
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
    const mainStore = useAcpUiStore.getState()
    const activeMainSid = selectActiveThreadAgentSessionId(mainStore) ?? mainStore.sessionId
    // 严格会话隔离：若事件带有具体 sessionId，且既不是当前主会话、也不是全局广播，
    // 则属于已退役副会话或已切走的过时会话，坚决丢弃，绝不污染主会话
    if (event.sessionId && (activeMainSid ? event.sessionId !== activeMainSid :
        mainStore.threads.some(thread => thread.id !== mainStore.activeThreadId &&
          Object.values(thread.agentSessionIds ?? {}).includes(event.sessionId)))) {
      return
    }

    const chunkText = isCoalescableAgentChunk(event.update)
    if (chunkText) {
      const owner = { threadId: mainStore.activeThreadId, sessionId: activeMainSid, runtimeId: mainStore.selectedRuntimeId }
      const previous = streamBuffer?.owner
      if (previous && (previous.threadId !== owner.threadId || previous.sessionId !== owner.sessionId || previous.runtimeId !== owner.runtimeId)) flushAcpStreamBuffer()
      if (streamBuffer) {
        streamBuffer.owner = owner
        streamBuffer.coalescer.push(chunkText)
      }
      scheduleStreamFlush()
      return
    }
    flushAcpStreamBuffer()
    mainStore.applySessionUpdate(event.update)

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
