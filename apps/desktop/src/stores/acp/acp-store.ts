import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { pruneBlankThreads } from '@/lib/agent/acp-thread-prune'
import { createThrottledStorage } from '@/lib/agent/throttled-storage'
import { DEFAULT_ACP_RUNTIME_ID } from '@montree/contracts'
import {
  MAX_THREADS,
  type AcpChatMessage,
  type AcpHudDisplayMode,
  type AcpUiStore,
  migrateLegacyThreadSessions,
} from './acp-types'
import { freezeMessages } from './chat-helpers'
import { createSessionSlice } from './session-slice'
import { createChatSlice } from './chat-slice'
import { createPermissionSlice } from './permission-slice'
import { createHudSlice } from './hud-slice'

export const useAcpUiStore = create<AcpUiStore>()(
  persist(
    (...a) => ({
      ...createSessionSlice(...a),
      ...createChatSlice(...a),
      ...createPermissionSlice(...a),
      ...createHudSlice(...a),
    }),
    {
      name: 'montree-acp-ui',
      storage: createJSONStorage(() => createThrottledStorage(localStorage, 1500)),
      partialize: (state) => ({
        // 重启 / 更新后恢复 Agent 面板展开状态与伴读 HUD 模式
        panelOpen: state.panelOpen,
        hudDisplayMode: state.hudDisplayMode,
        selectedRuntimeId: state.selectedRuntimeId,
        preferredConfigByRuntime: state.preferredConfigByRuntime,
        activeThreadId: state.activeThreadId,
        chatScrollByThread: state.chatScrollByThread,
        threads: pruneBlankThreads(state.threads)
          .map((t) => ({
            ...t,
            messages: freezeMessages(t.messages),
          }))
          .slice(0, MAX_THREADS),
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AcpUiStore>
        const rawThreads =
          Array.isArray(p.threads) && p.threads.length > 0
            ? p.threads
            : current.threads
        const pruned = pruneBlankThreads(rawThreads)
        const ensured = (pruned.length > 0 ? pruned : current.threads).map(
          migrateLegacyThreadSessions,
        )
        const activeThreadId =
          typeof p.activeThreadId === 'string' &&
          ensured.some((t) => t.id === p.activeThreadId)
            ? p.activeThreadId
            : ensured[0]!.id
        const preferredConfigByRuntime =
          p.preferredConfigByRuntime && typeof p.preferredConfigByRuntime === 'object'
            ? p.preferredConfigByRuntime
            : current.preferredConfigByRuntime
        // 旧持久化可能存着错位态（activeThread.runtimeId ≠ selectedRuntimeId，
        // 即本次修复的串线根因）：以线程归属为真相源，对齐 selected，避免重开
        // 即把 codex 历史载入 opencode 视图。
        const activeThread = ensured.find((t) => t.id === activeThreadId)
        const activeRuntimeId =
          activeThread?.runtimeId || DEFAULT_ACP_RUNTIME_ID
        const persistedSelected =
          typeof p.selectedRuntimeId === 'string' && p.selectedRuntimeId.trim()
            ? p.selectedRuntimeId
            : activeRuntimeId
        const selectedRuntimeId =
          persistedSelected === activeRuntimeId ? persistedSelected : activeRuntimeId
        return {
          ...current,
          ...p,
          panelOpen: Boolean(p.panelOpen),
          hudDisplayMode: (p.hudDisplayMode as AcpHudDisplayMode) ?? 'floating',
          threads: ensured,
          activeThreadId,
          selectedRuntimeId,
          preferredConfigByRuntime,
          prompting: false,
          composerFocusNonce: 0,
          composerInsertNonce: 0,
          status: 'disconnected',
          sessionId: null,
          configOptions: [],
          promptCapabilities: {},
          modelCatalogByRuntime: {},
          pendingPermission: null,
        }
      },
    },
  ),
)

export function useAcpPanelOpen() {
  return useAcpUiStore((s) => s.panelOpen)
}

export function useAcpActiveMessages(): AcpChatMessage[] {
  return useAcpUiStore(
    useShallow((s) => {
      const thread = s.threads.find((t) => t.id === s.activeThreadId)
      return thread?.messages ?? []
    }),
  )
}

export function useAcpPendingPermission() {
  return useAcpUiStore((s) => s.pendingPermission)
}

/**
 * Agent 面板外壳所需的状态。
 *
 * 不返回当前线程的 messages/threads 数组，避免流式消息更新时让标题栏、
 * 配置栏和输入栏一起重渲染。消息列表通过 useAcpActiveMessages 单独订阅。
 */
export function useAcpChatShell() {
  return useAcpUiStore(
    useShallow((s) => {
      const thread = s.threads.find((t) => t.id === s.activeThreadId)
      return {
        status: s.status,
        statusError: s.statusError,
        statusErrorCode: s.statusErrorCode,
        configOptions: s.configOptions,
        promptCapabilities: s.promptCapabilities,
        prompting: s.prompting,
        selectedRuntimeId: s.selectedRuntimeId,
        activeTitle: thread && thread.title !== '新对话' ? thread.title : null,
      }
    }),
  )
}

export function useAcpChatView() {
  return useAcpUiStore(
    useShallow((s) => {
      const thread = s.threads.find((t) => t.id === s.activeThreadId)
      return {
        status: s.status,
        sessionId: s.sessionId,
        statusError: s.statusError,
        configOptions: s.configOptions,
        promptCapabilities: s.promptCapabilities,
        messages: thread?.messages ?? [],
        prompting: s.prompting,
        selectedRuntimeId: s.selectedRuntimeId,
        activeThreadId: s.activeThreadId,
        threads: s.threads,
        historyOpen: s.historyOpen,
        pendingPermission: s.pendingPermission,
      }
    }),
  )
}
