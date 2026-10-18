import type { StateCreator } from 'zustand'
import { DEFAULT_ACP_RUNTIME_ID, isSameWorkspace } from '@yitom/contracts'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import type { AcpMessageAttachment } from '@/lib/agent/acp-composer'
import {
  finalizeFeedMessages,
  isProposeMarkToolTitle,
} from '@yitom/chat-core'
import { classifyAcpUpdate } from '@/lib/agent/acp-update-adapter'
import { pruneBlankThreads } from '@/lib/agent/acp-thread-prune'
import { acpDevLog } from '@/lib/agent/acp-dev-log'
import {
  dispatchOwnedChatEvent,
  reconcileOwnedChatThreadMetadata,
  updateOwnedChatThreadMessages,
  ensureOwnedChatThread,
  findOwnedChatThread,
} from '@/lib/agent/chat-session-authority'
import { getOwnedChatSessionStore } from '@/lib/agent/chat-session-owner'
import {
  hasReplayScaffoldingMarkers,
  stripReplayScaffolding,
} from '@/lib/agent/context/strip-replay-scaffolding'
import { collectStoreFallbackProposal } from '@/lib/agent/promote-mark-proposals'
import type { MarkProposalStatus } from '@yitom/annotations'
import {
  MAX_THREADS,
  type AcpChatThread,
  type AcpUiStore,
} from './acp-types'
import {
  attachPendingMarkProposals,
  createEmptyThread,
  newId,
  patchActiveThread,
  titleFromMessages,
} from './chat-helpers'

function freezeLightMessages(thread: AcpChatThread): AcpChatMessage[] {
  return dispatchOwnedChatEvent(thread, { type: 'freeze-light' }).messages
}

export interface ChatScrollState {
  scrollTop: number
  pinned: boolean
  windowStart?: number | null
  windowCount?: number
}

export interface ChatSlice {
  threads: AcpChatThread[]
  activeThreadId: string
  historyOpen: boolean
  pendingMarkProposalSnapshotContents: string[]
  /**
   * cursor load 回放清洗中的跨 chunk 悬垂缓冲（不持久化）：
   * user chunk 以未闭合脚手架 opening 结尾时，暂缓渲染、把原文暂存此处，
   * 与下一 user chunk 拼接后再洗；定居收尾 / 切线程 / 清空时落定或丢弃。
   */
  pendingReplayUserText: { threadId: string; raw: string } | null
  /** 活动线程包 feed 的回合冻结状态兼容投影，通用生命周期由包归约。 */
  turnSettled: boolean
  /** 各线程的聊天滚动记忆（scrollTop + 是否贴底），悬浮/侧栏共用，关闭重开原位恢复 */
  chatScrollByThread: Record<string, ChatScrollState>

  setHistoryOpen: (open: boolean) => void
  appendUserMessage: (text: string, attachments?: AcpMessageAttachment[]) => void
  appendSystemMessage: (text: string) => void
  beginAgentReply: () => void
  clearMessages: () => void
  finishStreaming: () => void
  freezeSettledStreaming: () => void
  /**
   * 用户/服务端确认取消后调用：把仍在进行的工具调用显式标 cancelled。
   * 与收尾冻结配合——取消走 cancelled，未获知结果的残留走展示层“状态未知”。
   */
  cancelActiveTools: () => void
  /**
   * 失败回合回滚：prompt 返回失败后，删掉本回合新增的 agent/thought 文本
   * （如额度/网络失败前流进来的错误正文不再以正常气泡残留），工具记录保留。
   * 由发送方传入回合开始时的已有消息 id 快照（id 锚定，不用墙钟）。
   */
  rollbackFailedTurn: (keepIds: string[]) => void
  attachMarkProposalsFromSnapshot: (content: string) => void
  resolveMarkProposal: (proposalId: string, status: Exclude<MarkProposalStatus, 'pending'>) => void
  selectChapterMarkPlan: (entryId: string) => void
  createThread: (workspaceRoot?: string | null, runtimeId?: string) => string
  setThreadCodeMode: (threadId: string, enabled: boolean) => void
  switchThread: (threadId: string) => void
  switchWorkspace: (workspaceRoot?: string) => string
  deleteThread: (threadId: string) => void
  renameThread: (threadId: string, title: string) => void
  applySessionUpdate: (update: Record<string, unknown>) => void
  setChatScroll: (threadId: string, scroll: ChatScrollState) => void
}

export const initialThread = createEmptyThread()

type ReplayUserOutcome =
  | { kind: 'defer'; pending: { threadId: string; raw: string } }
  | { kind: 'drop' }
  | { kind: 'append'; text: string }

/**
 * user-chunk 回放清洗门限（cursor load 把发过的内容重播为 user chunks 的第二道网）。
 *
 * - 正常用户输入走 `appendUserMessage`，从不到这里；到这里的 user chunk 本就可疑。
 * - 定居/回放语境（`prompting === false`，load 回放只发生在此）或文本含我方标记时清洗；
 * - prompt 回合内（`prompting === true`）且无标记的 chunk 原样返回，零影响；
 * - 有同线程悬垂缓存时一律拼接原文续接再洗（无论 prompting，以保跨 chunk 完整）；
 * - 用户原文粘贴标记串的极端情况随定居门限走，不单独处理。
 */
function consumeReplayUserChunk(
  state: Pick<AcpUiStore, 'activeThreadId' | 'prompting' | 'pendingReplayUserText'>,
  chunk: string,
): ReplayUserOutcome {
  const activeThreadId = state.activeThreadId
  const pending = state.pendingReplayUserText
  const continuing = pending !== null && pending.threadId === activeThreadId
  if (!continuing && state.prompting && !hasReplayScaffoldingMarkers(chunk)) {
    return { kind: 'append', text: chunk }
  }
  const candidate = continuing && pending ? pending.raw + chunk : chunk
  const stripped = stripReplayScaffolding(candidate)
  if (stripped.dangling) {
    return { kind: 'defer', pending: { threadId: activeThreadId, raw: candidate } }
  }
  if (!stripped.text) return { kind: 'drop' }
  return { kind: 'append', text: stripped.text }
}

/** 悬垂落定：把缓存原文强制清洗一次后作为 streaming 用户消息追加（保到达顺序） */
function appendFlushedReplayUserText(t: AcpChatThread, raw: string): AcpChatThread {
  const cleaned = stripReplayScaffolding(raw).text
  if (!cleaned) return t
  const messages: AcpChatMessage[] = [
    ...t.messages,
    {
      id: newId('user'),
      role: 'user' as const,
      text: cleaned,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      streaming: true,
    },
  ]
  return {
    ...t,
    messages,
    title: t.title === '新对话' ? titleFromMessages(messages) : t.title,
    updatedAt: Date.now(),
  }
}

export const createChatSlice: StateCreator<
  AcpUiStore,
  [],
  [],
  ChatSlice
> = (set, get) => ({
  threads: [initialThread],
  activeThreadId: initialThread.id,
  currentWorkspaceRoot: undefined,
  historyOpen: false,
  pendingMarkProposalSnapshotContents: [],
  pendingReplayUserText: null,
  chatScrollByThread: {},
  turnSettled: false,

  setChatScroll: (threadId, scroll) =>
    set((s) => ({
      chatScrollByThread: { ...s.chatScrollByThread, [threadId]: scroll },
    })),

  setHistoryOpen: (open) => set({ historyOpen: open }),

  appendUserMessage: (text, attachments) => {
    set((s) => ({
      pendingMarkProposalSnapshotContents: [],
      // 本地新输入 supersede 未落定的回放悬垂（load 半截时用户直接说话）
      pendingReplayUserText: null,
      ...patchActiveThread(s, (t) => {
        const feed = dispatchOwnedChatEvent(t, { type: 'user-append', text, attachments })
        const messages = feed.messages
        return {
          ...t,
          messages,
          title: t.title === '新对话' ? titleFromMessages(messages) : t.title,
          updatedAt: Date.now(),
        }
      }),
    }))
  },

  appendSystemMessage: (text) => {
    set((s) =>
      patchActiveThread(s, (t) => {
        const feed = dispatchOwnedChatEvent(t, { type: 'system-append', text })
        return { ...t, messages: feed.messages, updatedAt: Date.now() }
      }),
    )
  },

  beginAgentReply: () => {
    set((s) => {
      const patched = patchActiveThread(s, (t) => {
        const feed = dispatchOwnedChatEvent(t, { type: 'begin-reply' })
        if (feed.messages === t.messages) return t
        return { ...t, messages: feed.messages, updatedAt: Date.now() }
      })
      // 新回合开场：迟到标记清零，后续 chunk 正常点亮流式
      return { ...patched, turnSettled: false }
    })
  },

  clearMessages: () => {
    set((s) => ({
      pendingMarkProposalSnapshotContents: [],
      pendingReplayUserText: null,
      turnSettled: false,
      ...patchActiveThread(s, (t) => {
        const next = { ...t, messages: [] as AcpChatMessage[], title: '新对话', updatedAt: Date.now() }
        updateOwnedChatThreadMessages(next, next.messages, false)
        return next
      }),
    }))
  },

  finishStreaming: () => {
    set((s) => {
      const proposalFallback = collectStoreFallbackProposal()
      return {
        prompting: false,
        turnSettled: true,
        ...patchActiveThread(s, (t) => {
          const feed = dispatchOwnedChatEvent(t, { type: 'finish-turn', proposalFallback })
          return { ...t, messages: feed.messages, updatedAt: Date.now() }
        }),
      }
    })
  },

  // 定居收尾：复用 finishStreaming 的冻结语义，但不碰 prompting。
  // load 恢复时 prompting 本就 false（断言式保持：prompt 回合的收尾仍走 finishStreaming）。
  freezeSettledStreaming: () => {
    set((s) => {
      const proposalFallback = collectStoreFallbackProposal()
      return {
        ...patchActiveThread(s, (t) => {
          const feed = dispatchOwnedChatEvent(t, { type: 'finish-turn', proposalFallback, settle: false })
          return { ...t, messages: feed.messages, updatedAt: Date.now() }
        }),
      }
    })
  },

  cancelActiveTools: () => {
    set((s) =>
      patchActiveThread(s, (t) => {
        const feed = dispatchOwnedChatEvent(t, { type: 'cancel-tools' })
        const now = Date.now()
        let changed = false
        const messages = feed.messages.map((m, i) => {
          if (m !== t.messages[i]) {
            changed = true
            return { ...m, updatedAt: now }
          }
          return m
        })
        if (!changed) return t
        return { ...t, messages, updatedAt: now }
      }),
    )
  },

  rollbackFailedTurn: (keepIds) => {
    set((s) =>
      patchActiveThread(s, (t) => {
        const feed = dispatchOwnedChatEvent(t, { type: 'rollback-turn', keepIds })
        if (feed.messages.length === t.messages.length) return t
        return { ...t, messages: feed.messages, updatedAt: Date.now() }
      }),
    )
  },

  attachMarkProposalsFromSnapshot: (content) => {
    set((s) => {
      let remaining = [...s.pendingMarkProposalSnapshotContents, content]
      let attachedCount = 0
      const proposalFallback = collectStoreFallbackProposal()
      const patched = patchActiveThread(s, (t) => {
        const attached = attachPendingMarkProposals(t.messages, remaining)
        remaining = attached.remaining.slice(-3)
        attachedCount = attached.attachedCount
        const hasStreamingAgent = attached.messages.some(
          (message) => message.role === 'agent' && message.streaming,
        )
        return {
          ...t,
          messages: hasStreamingAgent
            ? attached.messages
            : finalizeFeedMessages(attached.messages, proposalFallback),
          updatedAt: Date.now(),
        }
      })
      acpDevLog('mark-proposal snapshot result', {
        chars: content.length,
        attachedCount,
        queuedCount: remaining.length,
      })
      return { ...patched, pendingMarkProposalSnapshotContents: remaining }
    })
  },

  resolveMarkProposal: (proposalId, status) => {
    set((s) =>
      patchActiveThread(s, (t) => {
        const pkg = getOwnedChatSessionStore()
        pkg.resolveProposal(proposalId, status, ensureOwnedChatThread(t).id)
        return { ...t, messages: findOwnedChatThread(pkg, t.id)!.feed.messages, updatedAt: Date.now() }
      }),
    )
  },

  selectChapterMarkPlan: (entryId) => {
    set((s) =>
      patchActiveThread(s, (t) => {
        const pkg = getOwnedChatSessionStore()
        pkg.selectChapterPlan(entryId, ensureOwnedChatThread(t).id)
        return { ...t, messages: findOwnedChatThread(pkg, t.id)!.feed.messages, updatedAt: Date.now() }
      }),
    )
  },

  createThread: (workspaceRoot, runtimeId) => {
    const pkg = getOwnedChatSessionStore()
    const ws =
      workspaceRoot === null
        ? undefined
        : workspaceRoot !== undefined
          ? workspaceRoot
          : get().currentWorkspaceRoot
    const rId = runtimeId ?? get().selectedRuntimeId
    const prevSelected = get().selectedRuntimeId
    const thread = createEmptyThread(ws, rId)
    set((s) => {
      const frozen = s.threads.map((t) =>
        t.id === s.activeThreadId
          ? { ...t, messages: freezeLightMessages(t), updatedAt: Date.now() }
          : t,
      )
      // 新建时丢掉其它空白草稿（含刚离开的空会话）
      const kept = pruneBlankThreads(frozen)
      const threads = [thread, ...kept].slice(0, MAX_THREADS)
      // 显式跨 runtime 建线程时同样对齐 selected，避免 active 与 selected 错位
      const runtimeChanged = rId !== prevSelected
      return {
        threads,
        activeThreadId: thread.id,
        currentWorkspaceRoot: ws,
        ...(runtimeChanged ? { selectedRuntimeId: rId } : {}),
        prompting: false,
        turnSettled: false,
        historyOpen: false,
        pendingMarkProposalSnapshotContents: [],
        pendingReplayUserText: null,
        ...(runtimeChanged
          ? { configOptions: [], promptCapabilities: {}, pendingPermission: null }
          : {}),
      }
    })
    // 生命周期边界同步完整线程表，包含宿主的空草稿修剪与历史上限。
    reconcileOwnedChatThreadMetadata(pkg, get())
    return thread.id
  },

  switchWorkspace: (workspaceRoot) => {
    const pkg = getOwnedChatSessionStore()
    const s = get()
    const targetWs = workspaceRoot?.trim() || undefined
    const currentThread = s.threads.find((t) => t.id === s.activeThreadId)

    if (
      isSameWorkspace(s.currentWorkspaceRoot, targetWs) &&
      currentThread &&
      isSameWorkspace(currentThread.workspaceRoot, targetWs)
    ) {
      return s.activeThreadId
    }

    const currentRuntimeId = s.selectedRuntimeId || DEFAULT_ACP_RUNTIME_ID

    // 冻结当前正在进行的线程消息
    const frozen = s.threads.map((t) =>
      t.id === s.activeThreadId
        ? { ...t, messages: freezeLightMessages(t), updatedAt: Date.now() }
        : t,
    )

    // 切走时清理空白草稿
    const kept = pruneBlankThreads(frozen)

    // 寻找目标工作区下属于当前 Agent 运行时的历史线程
    const matching = kept.filter(
      (t) =>
        (t.runtimeId || DEFAULT_ACP_RUNTIME_ID) === currentRuntimeId &&
        isSameWorkspace(t.workspaceRoot, targetWs),
    )

    let targetThreadId: string
    let nextThreads = kept

    if (matching.length > 0) {
      const sorted = [...matching].sort((a, b) => b.updatedAt - a.updatedAt)
      targetThreadId = sorted[0]!.id
    } else {
      // 目标工作区尚无会话：创建专属空白线程
      const fresh = createEmptyThread(targetWs, currentRuntimeId)
      nextThreads = [fresh, ...kept].slice(0, MAX_THREADS)
      targetThreadId = fresh.id
    }

    set({
      currentWorkspaceRoot: targetWs,
      threads: nextThreads,
      activeThreadId: targetThreadId,
      prompting: false,
      turnSettled: false,
      historyOpen: false,
      pendingMarkProposalSnapshotContents: [],
      pendingReplayUserText: null,
      pendingPermission: null,
    })
    reconcileOwnedChatThreadMetadata(pkg, get())

    return targetThreadId
  },

  switchThread: (threadId) => {
    const pkg = getOwnedChatSessionStore()
    const s = get()
    if (threadId === s.activeThreadId) return
    if (s.prompting) return
    const target = s.threads.find((t) => t.id === threadId)
    if (!target) return
    const frozen = s.threads.map((t) =>
      t.id === s.activeThreadId
        ? { ...t, messages: freezeLightMessages(t), updatedAt: Date.now() }
        : t,
    )
    // 切走时若原会话空白则删除；目标会话即使空白也保留
    const threads = pruneBlankThreads(frozen, { keepId: threadId })
    // 线程↔运行时绑定：线程是归属真相源，切到异 runtime 线程时自动对齐
    // selectedRuntimeId，否则后续 setSession/append 经 patchActiveThread 会把
    // 新 runtime 消息写进旧 thread（codex 历史混入 opencode 视图之根因）。
    // 对齐时同步清空旧 runtime 残留的模型选项/能力/审批（同 setSelectedRuntimeId 语义）。
    const targetRuntimeId = target.runtimeId || DEFAULT_ACP_RUNTIME_ID
    const runtimeChanged = targetRuntimeId !== s.selectedRuntimeId
    set({
      activeThreadId: threadId,
      ...(runtimeChanged ? { selectedRuntimeId: targetRuntimeId } : {}),
      prompting: false,
      turnSettled: false,
      historyOpen: false,
      threads,
      pendingMarkProposalSnapshotContents: [],
      pendingReplayUserText: null,
      ...(runtimeChanged
        ? { configOptions: [], promptCapabilities: {}, pendingPermission: null }
        : {}),
    })
    reconcileOwnedChatThreadMetadata(pkg, get())
  },

  deleteThread: (threadId) => {
    const pkg = getOwnedChatSessionStore()
    set((s) => {
      let threads = s.threads.filter((t) => t.id !== threadId)
      const chatScrollByThread = { ...s.chatScrollByThread }
      delete chatScrollByThread[threadId]
      const currentRuntimeId = s.selectedRuntimeId
      const runtimeThreads = threads.filter(
        (t) => (t.runtimeId || DEFAULT_ACP_RUNTIME_ID) === currentRuntimeId,
      )
      if (runtimeThreads.length === 0) {
        const fresh = createEmptyThread(undefined, currentRuntimeId)
        threads = [fresh, ...threads]
        return {
          threads,
          activeThreadId: fresh.id,
          prompting: false,
          chatScrollByThread,
        }
      }
      const activeThreadId =
        s.activeThreadId === threadId ? runtimeThreads[0]!.id : s.activeThreadId
      return { threads, activeThreadId, prompting: false, chatScrollByThread }
    })
    // 宿主可能为当前运行时补建新草稿，按实际结果同步其稳定身份。
    reconcileOwnedChatThreadMetadata(pkg, get())
  },

  renameThread: (threadId, title) => {
    const pkg = getOwnedChatSessionStore()

    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId
          ? { ...t, title: title.trim() || '新对话', updatedAt: Date.now() }
          : t,
      ),
    }))
    reconcileOwnedChatThreadMetadata(pkg, get())
  },

  setThreadCodeMode: (threadId, enabled) => {
    const pkg = getOwnedChatSessionStore()
    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId ? { ...t, codeMode: enabled === true, updatedAt: Date.now() } : t,
      ),
    }))
    reconcileOwnedChatThreadMetadata(pkg, get())
  },

  applySessionUpdate: (update) => {
    // 协议识别与字段归一化全在 `classifyAcpUpdate`（纯适配，复用包 mapper）；
    // 本层只按意图调用包权威归约器及更新宿主业务元数据，线程归属/回放清洗/快照旁路顺序一律不变。
    const intent = classifyAcpUpdate(update)
    if ('unknownKind' in intent && intent.unknownKind !== undefined) {
      acpDevLog('unknown session update kind', { kind: intent.unknownKind })
    }

    switch (intent.type) {
      case 'ignored':
        return

      case 'settle-complete': {
        // 主进程定居收尾：先把回放清洗悬垂落定（有则成泡、无则丢），再冻结残留，
        // 不新增空泡，不碰 prompting
        const st = get()
        const pending = st.pendingReplayUserText
        if (pending && pending.threadId === st.activeThreadId && pending.raw) {
          set((s) => ({
            pendingReplayUserText: null,
            ...patchActiveThread(s, (t) => appendFlushedReplayUserText(t, pending.raw)),
          }))
        } else if (pending) {
          set({ pendingReplayUserText: null })
        }
        get().freezeSettledStreaming()
        return
      }

      case 'tool-content-chunk': {
        const { toolCallId, text: chunkText } = intent
        set((s) => {
          const proposalFallback = collectStoreFallbackProposal()
          return patchActiveThread(s, (t) => {
            const feed = dispatchOwnedChatEvent(t, { type: 'tool-chunk', toolCallId, text: chunkText, proposalFallback })
            return { ...t, messages: feed.messages, updatedAt: Date.now() }
          })
        })
        return
      }

      // ACP usage_update：线程级纯记录（used/size/cost + `_meta.thinkingTokens`，
      // 缺省不写该键），只写当前线程的 `usage`，不新建消息，不碰其他分支。
      // usage 是宿主产品元数据，不映射为包 feed 事件；
      // 包 `ChatThread` 也是刻意最小提炼（非 feed 宿主态不进包），显示直读宿主线程。
      case 'usage': {
        const { usage } = intent
        set((s) =>
          patchActiveThread(s, (t) => ({ ...t, usage, updatedAt: Date.now() })),
        )
        return
      }
      case 'plan': {
        const { entries, active } = intent
        set((s) =>
          patchActiveThread(s, (t) => {
            const feed = dispatchOwnedChatEvent(t, { type: 'plan', entries, active })
            return { ...t, messages: feed.messages, updatedAt: Date.now() }
          }),
        )
        return
      }

      case 'tool-call': {
        const call = intent.call
        const toolCallId = intent.toolCallId
        // 无 id 时归约器 no-op，但仍需消费快照旁路并按 quiet 收尾（保原语义）
        set((s) => {
          let remaining = s.pendingMarkProposalSnapshotContents
          let attachedCount = 0
          let proposalToolTitle: string | undefined
          const proposalFallback = collectStoreFallbackProposal()
          const patched = patchActiveThread(s, (t) => {
            const base = call
              ? dispatchOwnedChatEvent(t, { type: 'tool-call', call, proposalFallback }).messages
              : t.messages
            const currentTool = [...base]
              .reverse()
              .find(
                (message) =>
                  message.role === 'tool' &&
                  message.toolCallId === toolCallId,
              )
            proposalToolTitle = currentTool?.toolTitle
            const attached = attachPendingMarkProposals(base, remaining)
            remaining = attached.remaining
            attachedCount = attached.attachedCount
            // 归约器已内聚 tool 更新的 finalize-if-quiet；此处仅为快照挂载后的
            // 增量收尾（幂等， streaming agent 存在则延迟）。
            const hasStreamingAgent = attached.messages.some(
              (message) => message.role === 'agent' && message.streaming,
            )
            return {
              ...t,
              messages: hasStreamingAgent
                ? attached.messages
                : finalizeFeedMessages(attached.messages, proposalFallback),
              updatedAt: Date.now(),
            }
          })
          if (isProposeMarkToolTitle(proposalToolTitle)) {
            acpDevLog('mark-proposal tool update', {
              toolCallId,
              title: proposalToolTitle,
              status: update.status,
              queuedBefore: s.pendingMarkProposalSnapshotContents.length,
              attachedCount,
              queuedAfter: remaining.length,
            })
          }
          return { ...patched, pendingMarkProposalSnapshotContents: remaining }
        })
        return
      }

      case 'plan-remove': {
        // 计划删除：经包归约器 plan-remove 删单例卡（与包 ingest 同语义）。
        set((s) =>
          patchActiveThread(s, (t) => {
            const feed = dispatchOwnedChatEvent(t, { type: 'plan-remove' })
            if (feed.messages === t.messages) return t
            return { ...t, messages: feed.messages, updatedAt: Date.now() }
          }),
        )
        return
      }

      case 'text': {
        const { role, text } = intent
        // cursor load 回放清洗（第二道网）：仅 user-chunk 分支洗脚手架。
        // 悬垂（defer）时暂缓渲染、缓存原文等下一 chunk；洗空（drop）即丢弃该消息。
        let effectiveText = text
        if (role === 'user') {
          const outcome = consumeReplayUserChunk(get(), text)
          if (outcome.kind === 'defer') {
            set({ pendingReplayUserText: outcome.pending })
            return
          }
          if (outcome.kind === 'drop') {
            if (get().pendingReplayUserText) set({ pendingReplayUserText: null })
            return
          }
          effectiveText = outcome.text
        } else {
          // 非 user chunk 到达时若有同线程悬垂，先落定以保到达顺序
          //（同消息的撕裂 chunk 总是连续同 role，这是纯防御）
          const st = get()
          const pending = st.pendingReplayUserText
          if (pending && pending.threadId === st.activeThreadId && pending.raw) {
            set((s) => ({
              pendingReplayUserText: null,
              ...patchActiveThread(s, (t) => appendFlushedReplayUserText(t, pending.raw)),
            }))
          } else if (pending) {
            set({ pendingReplayUserText: null })
          }
        }

        set((s) => ({
          ...(role === 'user' ? { pendingReplayUserText: null } : {}),
          ...patchActiveThread(s, (t) => {
            const feed = dispatchOwnedChatEvent(t, { type: 'text-chunk', role, text: effectiveText })
            return { ...t, messages: feed.messages, updatedAt: Date.now() }
          }),
        }))
        return
      }

      default: {
        // 到达即覆盖缺口（编译期）：适配层意图新增而未接线时此处报错。
        const _exhaustive: never = intent
        return _exhaustive
      }
    }
  },
})
