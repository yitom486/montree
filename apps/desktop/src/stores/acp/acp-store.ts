import { create } from 'zustand'
import { useSyncExternalStore } from 'react'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { pruneBlankThreads } from '@/lib/agent/acp-thread-prune'
import { DEFAULT_ACP_RUNTIME_ID } from '@yitom/contracts'
import {
  MAX_THREADS,
  type AcpChatMessage,
  type AcpChatThread,
  type AcpHudDisplayMode,
  type AcpUiStore,
  migrateLegacyThreadSessions,
} from './acp-types'
import { createEmptyThread } from './chat-helpers'
import { createSessionSlice } from './session-slice'
import { createChatSlice } from './chat-slice'
import { createPermissionSlice } from './permission-slice'
import { createHudSlice } from './hud-slice'
import { appApi } from '@/api/app-api'
import { createWindowChatStorage, windowChatStorageKey, windowStorageKey } from './window-storage'
import {
  getOwnedChatSessionStore,
  registerOwnedChatHostSnapshotProvider,
} from '@/lib/agent/chat-session-owner'
import type { ChatSessionStore } from '@yitom/chat-session'
import { reconcileOwnedChatThreadMetadata, isOwnedChatMetadataRouting } from '@/lib/agent/chat-session-authority'


export const ACP_METADATA_STORAGE_KEY = 'montree-acp-metadata/v2'

function ownedThreadProjection(store: ChatSessionStore, metadata: AcpChatThread[]): AcpChatThread[] {
  return store.getState().threads.map(thread => {
    const id = thread.hostThreadId ?? thread.id
    const previous = metadata.find(t => t.id === id)
    if (previous && previous.messages === thread.feed.messages && previous.title === thread.title && previous.runtimeId === thread.runtimeId) return previous
    return { ...(previous ?? createEmptyThread(undefined, thread.runtimeId)), id,
      title: thread.title, runtimeId: thread.runtimeId, messages: thread.feed.messages }
  })
}

function metadataStorage() {
  const scope = appApi.getWindowScopeId()
  const storage = createWindowChatStorage(localStorage, scope)
  // Feed history is saved synchronously by the package. Its routing metadata must
  // survive the same immediate reload; these small records contain no messages.
  return {
    getItem: (key: string) => localStorage.getItem(key) ?? storage.getItem(windowChatStorageKey(scope)),
    setItem: (key: string, raw: string) => storage.setItem(key, raw),
    removeItem: (key: string) => storage.removeItem(key),
  }
}

export const useAcpUiStore = create<AcpUiStore>()(
  persist(
    (...a) => ({
      ...createSessionSlice(...a),
      ...createChatSlice(...a),
      ...createPermissionSlice(...a),
      ...createHudSlice(...a),
    }),
    {
      name: windowStorageKey(ACP_METADATA_STORAGE_KEY, appApi.getWindowScopeId()),
      storage: createJSONStorage(metadataStorage),
      partialize: (state) => ({
        // 重启 / 更新后恢复 Agent 面板展开状态与伴读 HUD 模式
        panelOpen: state.panelOpen,
        hudDisplayMode: state.hudDisplayMode,
        selectedRuntimeId: state.selectedRuntimeId,
        preferredConfigByRuntime: state.preferredConfigByRuntime,
        activeThreadId: state.activeThreadId,
        chatScrollByThread: state.chatScrollByThread,
        threads: state.threads
          .map(({ messages: _messages, ...metadata }) => metadata)
          .slice(0, MAX_THREADS),
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AcpUiStore>
        const freshThreads = current.threads.map((thread) => ({ ...thread, runtimeId: p.selectedRuntimeId || thread.runtimeId }))
        const owner = getOwnedChatSessionStore()
        const metadata = Array.isArray(p.threads) ? p.threads : freshThreads
        const unclaimedEmptyOwner = owner.getState().threads.every(thread =>
          !thread.hostThreadId && thread.feed.messages.length === 0,
        )
        // A fresh package placeholder has no history to arbitrate. Keep the
        // inherited runtime/preferences until the host provisions its first route.
        const rawThreads = unclaimedEmptyOwner
          ? (Array.isArray(p.threads) && p.threads.length > 0
            ? p.threads.map(thread => ({ ...thread, messages: [] }))
            : freshThreads)
          : ownedThreadProjection(owner, metadata)
        const ownedActive = owner.getState().threads.find(t => t.id === owner.getState().activeThreadId)
        const preferredActive = unclaimedEmptyOwner
          ? p.activeThreadId ?? rawThreads[0]?.id
          : ownedActive?.hostThreadId ?? ownedActive?.id ?? p.activeThreadId
        const pruned = pruneBlankThreads(rawThreads, { keepId: preferredActive })
        const ensured = (pruned.length > 0 ? pruned : freshThreads).map(
          migrateLegacyThreadSessions,
        )
        const activeThreadId =
          typeof preferredActive === 'string' &&
          ensured.some((t) => t.id === preferredActive)
            ? preferredActive
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

/** Package emits are projected for legacy readers; projections never feed back into persistence. */
const observedOwners = new WeakSet<ChatSessionStore>()
function reconcileOwnedChatHost(store: ChatSessionStore): void {
  const scope = appApi.getWindowScopeId()
  if (!observedOwners.has(store)) {
    observedOwners.add(store)
    store.subscribe(() => {
      if (appApi.getWindowScopeId() !== scope || isOwnedChatMetadataRouting()) return
      const host = useAcpUiStore.getState()
      const state = store.getState()
      const active = state.threads.find(t => t.id === state.activeThreadId)
      const threads = ownedThreadProjection(store, host.threads)
      const activeThreadId = active?.hostThreadId ?? active?.id ?? host.activeThreadId
      if (threads.length === host.threads.length && threads.every((t, i) => t === host.threads[i]) && activeThreadId === host.activeThreadId && active?.feed.turnSettled === host.turnSettled) return
      useAcpUiStore.setState({ threads, activeThreadId, turnSettled: active?.feed.turnSettled ?? false })
    })
  }
  const host = useAcpUiStore.getState()
  const state = store.getState()
  const hasLinkedThreads = state.threads.some(t => t.hostThreadId)
  if (!hasLinkedThreads && state.threads.every(t => t.feed.messages.length === 0)) {
    reconcileOwnedChatThreadMetadata(store, host)
  } else {
    const threads = ownedThreadProjection(store, host.threads)
    const active = state.threads.find(t => t.id === state.activeThreadId)
    useAcpUiStore.setState({ threads, activeThreadId: active?.hostThreadId ?? active?.id ?? threads[0]!.id,
      turnSettled: active?.feed.turnSettled ?? false })
  }
}

registerOwnedChatHostSnapshotProvider(reconcileOwnedChatHost)
getOwnedChatSessionStore()
useAcpUiStore.persist?.onFinishHydration(() => reconcileOwnedChatHost(getOwnedChatSessionStore()))

export function useAcpPanelOpen() {
  return useAcpUiStore((s) => s.panelOpen)
}

export function useAcpActiveMessages(): AcpChatMessage[] {
  const owner = getOwnedChatSessionStore()
  return useSyncExternalStore(owner.subscribe, () => {
    const state = owner.getState()
    return state.threads.find(thread => thread.id === state.activeThreadId)?.feed.messages ?? EMPTY_MESSAGES
  })
}

const EMPTY_MESSAGES: AcpChatMessage[] = []

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
