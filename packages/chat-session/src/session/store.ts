import {
  applyChatEvent,
  attachPendingMarkProposals,
  finalizeFeedMessages,
  resolveMarkProposalOnMessages,
  selectChapterMarkPlanOnMessages,
  type AcpMessageAttachment,
  type AcpPlanEntry,
  type ChatFeedEvent,
  type ChatFeedState,
  type ChatFeedToolCall,
} from '@montree/chat-core'
import type { MarkProposalStatus } from '@montree/annotations'
import { DEFAULT_ACP_RUNTIME_ID } from '@montree/contracts'
import type {
  ChatConnectionStatus,
  ChatModelConfig,
  ChatPendingPermission,
  ChatSessionSnapshot,
  ChatStoragePort,
  ChatThread,
  ChatTransportPort,
} from './types'

export interface ChatSessionState {
  threads: ChatThread[]
  activeThreadId: string | null
  pendingPermission: ChatPendingPermission | null
  modelConfig: ChatModelConfig
}

export interface CreateChatSessionStoreOptions {
  createId?: (role: string) => string
  now?: () => number
  storage?: ChatStoragePort
  transport?: ChatTransportPort
  initialRuntimeId?: string
}

/** 与宿主 `MAX_THREADS`（`stores/acp/acp-types.ts:18`）同值 */
export const CHAT_SESSION_MAX_THREADS = 40

export const CHAT_SESSION_NEW_TITLE = '新对话'

function defaultCreateId(role: string): string {
  return `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 对齐宿主 `titleFromMessages`（`stores/acp/chat-helpers.ts:41-50`）：首条 user 文本压空 36 字截断 */
function titleFromUserText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return CHAT_SESSION_NEW_TITLE
  return t.length > 36 ? `${t.slice(0, 36)}…` : t
}

function emptyFeed(): ChatFeedState {
  return { messages: [], turnSettled: false }
}

function createThread(
  id: string,
  runtimeId: string,
  title: string = CHAT_SESSION_NEW_TITLE,
): ChatThread {
  return { id, runtimeId, title, feed: emptyFeed() }
}

export interface ChatSessionStore {
  getState(): ChatSessionState
  subscribe(listener: () => void): () => void
  /** S1 仅透出注入的 transport（不调用发送）；实际发送由宿主完成 */
  getTransport(): ChatTransportPort | undefined
  newThread(runtimeId?: string): string
  /** 定向接入宿主线程；迟到消息 provision 不改变当前 active/runtime。 */
  ensureHostThread(hostThreadId: string, runtimeId?: string, activate?: boolean): string
  /** 初始化或宿主持久化恢复时迁入权威历史，替换旧版无关联的影子快照。 */
  reconcileHostThreads(threads: ChatThread[], activeHostThreadId: string): void
  /** 宿主规范化回放后只替换一个线程，不改变当前选择或其它线程。 */
  syncHostThread(thread: ChatThread): void
  switchThread(threadId: string): void
  appendUser(text: string, opts?: { attachments?: AcpMessageAttachment[]; threadId?: string }): void
  beginReply(threadId?: string): void
  ingestTextChunk(text: string, threadId?: string): void
  ingestThoughtChunk(text: string, threadId?: string): void
  ingestToolCall(call: ChatFeedToolCall, threadId?: string): void
  ingestToolChunk(toolCallId: string, text: string, threadId?: string): void
  ingestPlan(entries: AcpPlanEntry[], active: boolean, threadId?: string): void
  finishTurn(threadId?: string, opts?: { settle?: boolean }): void
  /**
   * 定居收尾（P4b 新增，对齐宿主 `freezeSettledStreaming` 的冻结部分）：
   * 等价 `finishTurn(threadId, { settle: false })`——冻结 streaming 但不置
   * turnSettled（回放分批到达，中间态保持 streaming，由收尾统冻）；
   * prompting 留宿主（包内无 prompting 态）。
   */
  freezeSettled(threadId?: string): void
  cancelTools(threadId?: string): void
  freezeLight(threadId?: string): void
  /**
   * 系统消息追加（P4b 新增，对齐宿主 `appendSystemMessage` 的 feed 部分）：
   * 经 `system-append` 事件；宿主侧回放清洗/标题逻辑不在此（system 不参与标题）。
   */
  appendSystem(text: string, threadId?: string): void
  /**
   * 失败回合回滚（P4b 新增，对齐宿主 `rollbackFailedTurn`）：
   * 经 `rollback-turn` 事件删本回合新增 agent/thought（id 锚定），工具记录保留；
   * 长度不变时不 emit（对齐宿主“无新增即原样返回”）。
   */
  rollbackFailedTurn(keepIds: string[], threadId?: string): void
  /**
   * 提议决议（P4b 新增，对齐宿主 `resolveMarkProposal`）：
   * 经 core `resolveMarkProposalOnMessages` 纯 map 三处同刷 status。
   */
  resolveProposal(proposalId: string, status: Exclude<MarkProposalStatus, 'pending'>, threadId?: string): void
  /**
   * 章计划选定（P4b 新增，对齐宿主 `selectChapterMarkPlan`）：
   * 经 core `selectChapterMarkPlanOnMessages` 纯 map（选中 selected，其余 pending dismiss）。
   */
  selectChapterPlan(entryId: string, threadId?: string): void
  /**
   * 快照旁路挂载（P4b 新增，对齐宿主 `attachMarkProposalsFromSnapshot` 的 feed+队列部分）：
   * 包内迷你队列（内存态，不持久化——persist 只存 threads/activeThreadId/modelConfig）；
   * 语义照抄宿主：incoming 先入队再匹配，未命中保留最后 3 条；
   * 命中后无 streaming agent 即 finalize 收尾（fallback 恒 null：包内无 annotation store
   * 依赖；宿主有 fallback 时以宿主为准，等价比对须保持 fallback 为空）。
   */
  attachSnapshot(content: string, threadId?: string): void
  /**
   * 删除线程（P4b 新增，对齐宿主 `deleteThread` 的线程表部分）：
   * 宿主侧滚动记忆/ prompting 清理留宿主；未知 threadId no-op；
   * 当前运行时无剩余线程时建同 runtime 空白线程并切 active（对齐宿主兜底）。
   */
  deleteThread(threadId: string): void
  /**
   * 重命名线程（P4b 新增，对齐宿主 `renameThread`）：
   * `title.trim() || '新对话'`；未知 threadId no-op。
   */
  renameThread(threadId: string, title: string): void
  /**
   * 审批单例写入（S1 新增，对应宿主 `ingestPermissionRequest` 的纯状态部分）：
   * 单槽覆盖 + toolCall 落时间线（经 `tool-call` 事件，无 id 时归约器 no-op，
   * 对齐宿主“无 id 仍消费、时间线不动”语义）。
   * threadId 可选：指定时间线目标线程（镜像按宿主线程路由透传），缺省写 active。
   */
  requestPermission(permission: ChatPendingPermission, threadId?: string): void
  /** 对齐宿主 `clearPendingPermission`（`permission-slice.ts:22-32`）：requestId 守卫，不一致不清空 */
  clearPermission(requestId?: number): void
  /**
   * 连接状态机（S1 新增，对应宿主 `setStatus` 的纯状态部分）：
   * disconnected/error 清 pending（对齐 `session-slice.ts:135-145`）。
   */
  setConnectionStatus(status: ChatConnectionStatus): void
  selectModel(modelId: string): void
  selectRuntime(runtimeId: string): void
  setThinking(level: string): void
  /**
   * 清空 active 线程 messages（P3 新增，对齐宿主 `clearMessages` 的纯 feed 部分）：
   * 线程身份保留，标题重置为新对话，feed 置空并收尾 turnSettled=false；
   * 无 active 线程时 no-op；变更后 emit（含 persist）通知订阅者。
   */
  clearActiveThread(): void
}

/**
 * 纯 TS 会话 store（无 react，本批不写 hooks/JSX）：
 * - 所有 feed 变更全经 core `applyChatEvent`，作用于目标线程 feed；
 * - threadId 路由：事件带 threadId 时写对应线程（S1 新增隔离语义，宿主只写 active）；
 *   未知 threadId → no-op；
 * - 每次变更后经 storage port 落盘（pendingPermission 不落盘，同宿主）。
 */
export function createChatSessionStore(opts: CreateChatSessionStoreOptions = {}): ChatSessionStore {
  const createId = opts.createId ?? defaultCreateId
  const now = opts.now ?? Date.now
  const storage = opts.storage
  const transport = opts.transport
  const initialRuntimeId = opts.initialRuntimeId ?? DEFAULT_ACP_RUNTIME_ID

  let listeners = new Set<() => void>()

  function freshState(): ChatSessionState {
    const thread = createThread(createId('thread'), initialRuntimeId)
    return {
      threads: [thread],
      activeThreadId: thread.id,
      pendingPermission: null,
      modelConfig: { runtimeId: initialRuntimeId },
    }
  }

  let state: ChatSessionState = (() => {
    try {
      const snapshot = storage?.load()
      if (
        snapshot &&
        Array.isArray(snapshot.threads) &&
        snapshot.threads.length > 0 &&
        snapshot.modelConfig &&
        typeof snapshot.modelConfig.runtimeId === 'string'
      ) {
        return {
          threads: snapshot.threads,
          activeThreadId:
            snapshot.activeThreadId != null &&
            snapshot.threads.some((t) => t.id === snapshot.activeThreadId)
              ? snapshot.activeThreadId
              : snapshot.threads[0]!.id,
          pendingPermission: null,
          modelConfig: { ...snapshot.modelConfig },
        }
      }
    } catch {
      // 存储损坏时回落空白态（宿主迁移失败同策略：宁可空线程不崩）
    }
    return freshState()
  })()

  function persist(): void {
    try {
      storage?.save({
        threads: state.threads,
        activeThreadId: state.activeThreadId,
        modelConfig: { ...state.modelConfig },
      })
    } catch {
      // 落盘失败不影响内存态
    }
  }

  function emit(): void {
    persist()
    for (const listener of [...listeners]) listener()
  }

  function resolveThread(threadId?: string): ChatThread | undefined {
    if (threadId !== undefined) return state.threads.find((t) => t.id === threadId)
    if (state.activeThreadId == null) return undefined
    return state.threads.find((t) => t.id === state.activeThreadId)
  }

  function applyToThread(threadId: string | undefined, event: ChatFeedEvent): void {
    const target = resolveThread(threadId)
    if (!target) return
    const feed = applyChatEvent(target.feed, event, { createId, now })
    if (feed === target.feed) return
    state = {
      ...state,
      threads: state.threads.map((t) => (t.id === target.id ? { ...t, feed } : t)),
    }
    emit()
  }

  function freezeFeed(feed: ChatFeedState): ChatFeedState {
    return applyChatEvent(feed, { type: 'freeze-light' }, { createId, now })
  }

  /**
   * 快照旁路迷你队列（内存态，不持久化：persist 落盘快照无此字段，见上接口注）。
   * 宿主同名队列在 zustand state 内（同样不持久化，见 acp-types 注释）。
   */
  let pendingSnapshotContents: string[] = []

  function patchThreadFeed(threadId: string | undefined, messages: ChatFeedState['messages']): void {
    const target = resolveThread(threadId)
    if (!target) return
    state = {
      ...state,
      threads: state.threads.map((t) =>
        t.id === target.id ? { ...t, feed: { ...target.feed, messages } } : t,
      ),
    }
    emit()
  }

  return {
    getState(): ChatSessionState {
      return state
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getTransport(): ChatTransportPort | undefined {
      return transport
    },

    newThread(runtimeId?: string): string {
      const rid = runtimeId ?? state.modelConfig.runtimeId
      const id = createId('thread')
      const thread = createThread(id, rid)
      const threads = state.threads.map((t) =>
        t.id === state.activeThreadId ? { ...t, feed: freezeFeed(t.feed) } : t,
      )
      state = {
        ...state,
        threads: [thread, ...threads].slice(0, CHAT_SESSION_MAX_THREADS),
        activeThreadId: id,
      }
      emit()
      return id
    },

    ensureHostThread(hostThreadId, runtimeId, activate = false): string {
      const existing = state.threads.find((t) => t.hostThreadId === hostThreadId || t.id === hostThreadId)
      const id = existing?.id ?? createId('thread')
      const target: ChatThread = existing
        ? { ...existing, hostThreadId, runtimeId: runtimeId ?? existing.runtimeId }
        : { ...createThread(id, runtimeId ?? state.modelConfig.runtimeId), hostThreadId }
      let threads = existing
        ? state.threads.map((t) => t.id === id ? target : t)
        : [target, ...state.threads]
      if (activate && id !== state.activeThreadId) {
        threads = threads.map((t) => t.id === state.activeThreadId ? { ...t, feed: freezeFeed(t.feed) } : t)
      }
      const active = threads.find((t) => t.id === state.activeThreadId)
      threads = threads.slice(0, CHAT_SESSION_MAX_THREADS)
      // 后台线程不能挤掉当前可见线程。
      if (!activate && active && !threads.some((t) => t.id === active.id)) {
        threads = [...threads.slice(0, CHAT_SESSION_MAX_THREADS - 1), active]
      }
      state = {
        ...state,
        threads,
        ...(activate ? {
          activeThreadId: id,
          modelConfig: { ...state.modelConfig, runtimeId: target.runtimeId },
        } : {}),
      }
      emit()
      return id
    },

    reconcileHostThreads(threads, activeHostThreadId): void {
      if (threads.length === 0) return
      const reconciled = threads.map((thread) => {
        const hostThreadId = thread.hostThreadId ?? thread.id
        const existing = state.threads.find((t) => t.hostThreadId === hostThreadId || t.id === hostThreadId)
        return { ...thread, id: existing?.id ?? thread.id, hostThreadId }
      })
      const active = reconciled.find((t) => t.hostThreadId === activeHostThreadId) ?? reconciled[0]!
      state = {
        ...state,
        threads: reconciled,
        activeThreadId: active.id,
        modelConfig: { ...state.modelConfig, runtimeId: active.runtimeId },
        pendingPermission: null,
      }
      pendingSnapshotContents = []
      emit()
    },

    syncHostThread(thread): void {
      const hostThreadId = thread.hostThreadId ?? thread.id
      const existing = state.threads.find((t) => t.hostThreadId === hostThreadId || t.id === hostThreadId)
      const next = { ...thread, hostThreadId, id: existing?.id ?? thread.id }
      let threads = existing
        ? state.threads.map((t) => t.id === existing.id ? next : t)
        : [next, ...state.threads]
      const active = threads.find((t) => t.id === state.activeThreadId)
      threads = threads.slice(0, CHAT_SESSION_MAX_THREADS)
      if (active && !threads.some((t) => t.id === active.id)) {
        threads = [...threads.slice(0, CHAT_SESSION_MAX_THREADS - 1), active]
      }
      state = { ...state, threads }
      emit()
    },

    switchThread(threadId: string): void {
      if (threadId === state.activeThreadId) return
      if (!state.threads.some((t) => t.id === threadId)) return
      const threads = state.threads.map((t) =>
        t.id === state.activeThreadId ? { ...t, feed: freezeFeed(t.feed) } : t,
      )
      const target = threads.find((t) => t.id === threadId)!
      state = { ...state, threads, activeThreadId: threadId, modelConfig: { ...state.modelConfig, runtimeId: target.runtimeId } }
      emit()
    },

    appendUser(text, opts): void {
      const target = resolveThread(opts?.threadId)
      if (!target) return
      const feed = applyChatEvent(
        target.feed,
        { type: 'user-append', text, ...(opts?.attachments ? { attachments: opts.attachments } : {}) },
        { createId, now },
      )
      state = {
        ...state,
        threads: state.threads.map((t) =>
          t.id === target.id
            ? {
                ...t,
                feed,
                title: t.title === CHAT_SESSION_NEW_TITLE ? titleFromUserText(text) : t.title,
              }
            : t,
        ),
      }
      emit()
    },

    beginReply(threadId?: string): void {
      applyToThread(threadId, { type: 'begin-reply' })
    },

    ingestTextChunk(text: string, threadId?: string): void {
      applyToThread(threadId, { type: 'text-chunk', role: 'agent', text })
    },

    ingestThoughtChunk(text: string, threadId?: string): void {
      applyToThread(threadId, { type: 'text-chunk', role: 'thought', text })
    },

    ingestToolCall(call: ChatFeedToolCall, threadId?: string): void {
      applyToThread(threadId, { type: 'tool-call', call })
    },

    ingestToolChunk(toolCallId: string, text: string, threadId?: string): void {
      applyToThread(threadId, { type: 'tool-chunk', toolCallId, text })
    },

    ingestPlan(entries: AcpPlanEntry[], active: boolean, threadId?: string): void {
      applyToThread(threadId, { type: 'plan', entries, active })
    },

    finishTurn(threadId?: string, opts?: { settle?: boolean }): void {
      // settle:false 即定居收尾（freezeSettled）：冻结 streaming 但 turnSettled 保持。
      // 包内无 annotation store，proposalFallback 恒为 null（宿主有 fallback 时以宿主为准）。
      if (opts?.settle === false) applyToThread(threadId, { type: 'finish-turn', settle: false })
      else applyToThread(threadId, { type: 'finish-turn' })
    },

    freezeSettled(threadId?: string): void {
      applyToThread(threadId, { type: 'finish-turn', settle: false })
    },

    cancelTools(threadId?: string): void {
      applyToThread(threadId, { type: 'cancel-tools' })
    },

    freezeLight(threadId?: string): void {
      applyToThread(threadId, { type: 'freeze-light' })
    },

    appendSystem(text: string, threadId?: string): void {
      applyToThread(threadId, { type: 'system-append', text })
    },

    rollbackFailedTurn(keepIds: string[], threadId?: string): void {
      const target = resolveThread(threadId)
      if (!target) return
      const feed = applyChatEvent(target.feed, { type: 'rollback-turn', keepIds }, { createId, now })
      if (feed.messages.length === target.feed.messages.length) return
      state = {
        ...state,
        threads: state.threads.map((t) => (t.id === target.id ? { ...t, feed } : t)),
      }
      emit()
    },

    resolveProposal(proposalId: string, status, threadId?: string): void {
      const target = resolveThread(threadId)
      if (!target) return
      patchThreadFeed(
        target.id,
        resolveMarkProposalOnMessages(target.feed.messages, proposalId, status),
      )
    },

    selectChapterPlan(entryId: string, threadId?: string): void {
      const target = resolveThread(threadId)
      if (!target) return
      patchThreadFeed(
        target.id,
        selectChapterMarkPlanOnMessages(target.feed.messages, entryId),
      )
    },

    attachSnapshot(content: string, threadId?: string): void {
      let remaining = [...pendingSnapshotContents, content]
      const target = resolveThread(threadId)
      if (!target) {
        pendingSnapshotContents = remaining.slice(-3)
        return
      }
      const attached = attachPendingMarkProposals(target.feed.messages, remaining)
      remaining = attached.remaining.slice(-3)
      const hasStreamingAgent = attached.messages.some(
        (message) => message.role === 'agent' && message.streaming,
      )
      const messages = hasStreamingAgent
        ? attached.messages
        : finalizeFeedMessages(attached.messages, null)
      pendingSnapshotContents = remaining
      patchThreadFeed(target.id, messages)
    },

    deleteThread(threadId: string): void {
      if (!state.threads.some((t) => t.id === threadId)) return
      let threads = state.threads.filter((t) => t.id !== threadId)
      const currentRuntimeId = state.modelConfig.runtimeId
      const runtimeThreads = threads.filter(
        (t) => (t.runtimeId || DEFAULT_ACP_RUNTIME_ID) === currentRuntimeId,
      )
      if (runtimeThreads.length === 0) {
        const fresh = createThread(createId('thread'), currentRuntimeId)
        threads = [fresh, ...threads]
        state = { ...state, threads, activeThreadId: fresh.id }
        emit()
        return
      }
      state = {
        ...state,
        threads,
        activeThreadId: state.activeThreadId === threadId ? runtimeThreads[0]!.id : state.activeThreadId,
      }
      emit()
    },

    renameThread(threadId: string, title: string): void {
      if (!state.threads.some((t) => t.id === threadId)) return
      const next = title.trim() || CHAT_SESSION_NEW_TITLE
      state = {
        ...state,
        threads: state.threads.map((t) => (t.id === threadId ? { ...t, title: next } : t)),
      }
      emit()
    },

    requestPermission(permission: ChatPendingPermission, threadId?: string): void {
      const target = resolveThread(threadId)
      state = { ...state, pendingPermission: permission }
      if (target && permission.toolCallId) {
        const toolCall: ChatFeedToolCall = {
          toolCallId: permission.toolCallId,
          title:
            permission.toolCall != null && typeof permission.toolCall.title === 'string'
              ? (permission.toolCall.title as string)
              : permission.summary,
          kind:
            permission.toolCall != null && typeof permission.toolCall.kind === 'string'
              ? (permission.toolCall.kind as string)
              : 'other',
          status:
            permission.toolCall != null && typeof permission.toolCall.status === 'string'
              ? (permission.toolCall.status as string)
              : 'pending',
        }
        const feed = applyChatEvent(target.feed, { type: 'tool-call', call: toolCall }, { createId, now })
        state = {
          ...state,
          threads: state.threads.map((t) => (t.id === target.id ? { ...t, feed } : t)),
        }
      }
      emit()
    },

    clearPermission(requestId?: number): void {
      if (
        requestId != null &&
        state.pendingPermission &&
        state.pendingPermission.requestId !== requestId
      ) {
        return
      }
      if (!state.pendingPermission) return
      state = { ...state, pendingPermission: null }
      emit()
    },

    setConnectionStatus(status: ChatConnectionStatus): void {
      if (status === 'disconnected' || status === 'error') {
        if (!state.pendingPermission) return
        state = { ...state, pendingPermission: null }
        emit()
      }
    },

    selectModel(modelId: string): void {
      if (state.modelConfig.modelId === modelId) return
      state = { ...state, modelConfig: { ...state.modelConfig, modelId } }
      emit()
    },

    selectRuntime(runtimeId: string): void {
      if (!runtimeId || state.modelConfig.runtimeId === runtimeId) return
      state = { ...state, modelConfig: { ...state.modelConfig, runtimeId } }
      emit()
    },

    setThinking(level: string): void {
      if (state.modelConfig.thinkingLevel === level) return
      state = { ...state, modelConfig: { ...state.modelConfig, thinkingLevel: level } }
      emit()
    },

    clearActiveThread(): void {
      if (state.activeThreadId == null) return
      const target = state.threads.find((t) => t.id === state.activeThreadId)
      if (!target) return
      if (target.feed.messages.length === 0 && target.feed.turnSettled === false && target.title === CHAT_SESSION_NEW_TITLE) return
      state = {
        ...state,
        threads: state.threads.map((t) =>
          t.id === target.id ? { ...t, title: CHAT_SESSION_NEW_TITLE, feed: emptyFeed() } : t,
        ),
      }
      emit()
    },
  }
}
