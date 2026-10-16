import { useMemo, useSyncExternalStore } from 'react'
import type { ChatSessionStore } from './store'
import type { ChatThread } from './types'

/**
 * React 绑定（S2）：`store.subscribe` 已在 S1 就绪（变更即通知），此处只读不改语义。
 * store 方法均为闭包（不依赖 `this`），直接透传给 `useSyncExternalStore` 安全。
 */
export function useChatSessionStore(store: ChatSessionStore) {
  return useSyncExternalStore(store.subscribe, store.getState)
}

export function useActiveThread(store: ChatSessionStore): ChatThread | undefined {
  const state = useChatSessionStore(store)
  if (state.activeThreadId == null) return undefined
  return state.threads.find((t) => t.id === state.activeThreadId)
}

export interface ChatActions {
  /**
   * 发送文本：先本地 `appendUser + beginReply` 落子（user 气泡 + 空 agent 占位），
   * 再调 `transport.sendText(threadId, text)`；transport 缺省时仅本地落子，
   * 由宿主后续 `ingest*` 回填（不抛错、不静默吞字）。
   * 空白文本直接忽略。
   */
  sendText(text: string): void
  /** 取消：transport 缺省也照常本地 `cancelTools`（进行中工具标 cancelled）。 */
  cancel(): void
  selectModel(modelId: string): void
  /** 切换运行时：只写 `modelConfig.runtimeId`；线程亲和由应用侧管理（对齐宿主按 runtime 分桶语义）。 */
  selectRuntime(runtimeId: string): void
  setThinking(level: string): void
  /**
   * 审批响应：读当前 `pendingPermission.requestId` 调
   * `transport.respondPermission(requestId, optionId)` 后 `clearPermission`；
   * 无 pending 或无 transport 时仅做本地能做的部分（无 pending 直接 no-op）。
   * transport 失败静默（连接态由宿主 `setConnectionStatus` 另行同步）。
   */
  respondPermission(optionId: string | null): void
}

export function useChatActions(store: ChatSessionStore): ChatActions {
  return useMemo<ChatActions>(
    () => ({
      sendText(text: string): void {
        if (!text.trim()) return
        let threadId = store.getState().activeThreadId
        if (threadId == null) threadId = store.newThread()
        store.appendUser(text, { threadId })
        store.beginReply(threadId)
        const transport = store.getTransport()
        if (transport) {
          void transport.sendText(threadId, text).catch(() => {})
        }
      },

      cancel(): void {
        const { activeThreadId } = store.getState()
        if (activeThreadId != null) {
          void store.getTransport()?.cancel(activeThreadId).catch(() => {})
        }
        store.cancelTools()
      },

      selectModel(modelId: string): void {
        store.selectModel(modelId)
      },

      selectRuntime(runtimeId: string): void {
        store.selectRuntime(runtimeId)
      },

      setThinking(level: string): void {
        store.setThinking(level)
      },

      respondPermission(optionId: string | null): void {
        const pending = store.getState().pendingPermission
        if (!pending) return
        const { requestId } = pending
        void store.getTransport()?.respondPermission(requestId, optionId).catch(() => {})
        store.clearPermission(requestId)
      },
    }),
    [store],
  )
}
