import type { StateCreator } from 'zustand'
import {
  DEFAULT_ACP_RUNTIME_ID,
  isSameWorkspace,
  MONTREE_SETTLE_COMPLETE_KIND,
} from '@montree/contracts'
import {
  type AcpChatMessage,
  type AcpChatRole,
  extractTextFromContent,
  flattenToolContent,
  isToolActiveStatus,
} from '@/stores/acp-chat-types'
import type { AcpMessageAttachment } from '@/lib/agent/acp-composer'
import { parseAcpPlanEntries, summarizePlanProgress } from '@/lib/agent/acp-plan'
import { pruneIntermediateAgentReplies } from '@/lib/agent/acp-prune-agent-replies'
import { pruneBlankThreads } from '@/lib/agent/acp-thread-prune'
import { acpDevLog } from '@/lib/agent/acp-dev-log'
import {
  hasReplayScaffoldingMarkers,
  stripReplayScaffolding,
} from '@/lib/agent/context/strip-replay-scaffolding'
import {
  resolveMarkProposalOnMessages,
} from '@/lib/agent/promote-mark-proposals'
import {
  selectChapterMarkPlanOnMessages,
} from '@/lib/agent/promote-chapter-mark-plans'
import { isProposeMarkToolTitle } from '@/lib/agent/parse-mark-proposal'
import type { MarkProposalStatus } from '@montree/annotations'
import {
  MAX_THREADS,
  type AcpChatThread,
  type AcpUiStore,
} from './acp-types'
import {
  applyToolCallUpdate,
  attachPendingMarkProposals,
  createEmptyThread,
  finalizeThreadMessages,
  freezeMessages,
  newId,
  patchActiveThread,
  titleFromMessages,
} from './chat-helpers'

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
  /** 本轮内容是否已被收尾冻结（不持久化）：finishStreaming 置 true；新回合/线程/清空置 false。 */
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
  attachMarkProposalsFromSnapshot: (content: string) => void
  resolveMarkProposal: (proposalId: string, status: Exclude<MarkProposalStatus, 'pending'>) => void
  selectChapterMarkPlan: (entryId: string) => void
  createThread: (workspaceRoot?: string | null, runtimeId?: string) => string
  switchThread: (threadId: string) => void
  switchWorkspace: (workspaceRoot?: string) => string
  deleteThread: (threadId: string) => void
  renameThread: (threadId: string, title: string) => void
  applySessionUpdate: (update: Record<string, unknown>) => void
  setChatScroll: (threadId: string, scroll: ChatScrollState) => void
}

/**
 * 回合收尾冻结（finishStreaming / freezeSettledStreaming 共用）：
 * 残留 streaming 消息一律 streaming=false + updatedAt=now；工具调用只收敛
 * streaming，不推断执行结果——pending（未执行）随回合取消，in_progress /
 * 未知状态保留原值由展示层标“状态未知”，绝不补成 completed。
 * 随后走常规 finalize + 中间态 agent 气泡规整。
 */
function freezeSettledTurn(t: AcpChatThread): AcpChatThread {
  const now = Date.now()
  const frozen = t.messages.map((m) => {
    if (!m.streaming) return m
    if (m.role === 'tool' && isToolActiveStatus(m.toolStatus)) {
      return {
        ...m,
        streaming: false,
        updatedAt: now,
        toolStatus: m.toolStatus === 'pending' ? 'cancelled' : m.toolStatus,
        // 回合收尾标记：内容已落定可解析，但执行结果仍未知（展示不进成功）
        turnEnded: true,
      }
    }
    return { ...m, streaming: false, updatedAt: now }
  })
  return {
    ...t,
    updatedAt: now,
    messages: finalizeThreadMessages(pruneIntermediateAgentReplies(frozen)),
  }
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

  appendUserMessage: (text, attachments) =>
    set((s) => ({
      pendingMarkProposalSnapshotContents: [],
      // 本地新输入 supersede 未落定的回放悬垂（load 半截时用户直接说话）
      pendingReplayUserText: null,
      ...patchActiveThread(s, (t) => {
        const messages = [
          ...t.messages,
          {
            id: newId('user'),
            role: 'user' as const,
            text,
            createdAt: Date.now(),
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          },
        ]
        return {
          ...t,
          messages,
          title: t.title === '新对话' ? titleFromMessages(messages) : t.title,
          updatedAt: Date.now(),
        }
      }),
    })),

  appendSystemMessage: (text) =>
    set((s) =>
      patchActiveThread(s, (t) => ({
        ...t,
        messages: [
          ...t.messages,
          { id: newId('sys'), role: 'system', text, createdAt: Date.now() },
        ],
        updatedAt: Date.now(),
      })),
    ),

  beginAgentReply: () =>
    set((s) => {
      const patched = patchActiveThread(s, (t) => {
        const last = t.messages[t.messages.length - 1]
        if (last?.role === 'agent' && last.streaming) return t
        return {
          ...t,
          messages: [
            ...t.messages,
            {
              id: newId('agent'),
              role: 'agent',
              text: '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              streaming: true,
            },
          ],
          updatedAt: Date.now(),
        }
      })
      // 新回合开场：迟到标记清零，后续 chunk 正常点亮流式
      return { ...patched, turnSettled: false }
    }),

  clearMessages: () =>
    set((s) => ({
      pendingMarkProposalSnapshotContents: [],
      pendingReplayUserText: null,
      turnSettled: false,
      ...patchActiveThread(s, (t) => ({
        ...t,
        messages: [],
        title: '新对话',
        updatedAt: Date.now(),
      })),
    })),

  finishStreaming: () =>
    set((s) => ({
      prompting: false,
      turnSettled: true,
      ...patchActiveThread(s, freezeSettledTurn),
    })),

  // 定居收尾：复用 finishStreaming 的冻结语义，但不碰 prompting。
  // load 恢复时 prompting 本就 false（断言式保持：prompt 回合的收尾仍走 finishStreaming）。
  freezeSettledStreaming: () => set((s) => ({ ...patchActiveThread(s, freezeSettledTurn) })),

  cancelActiveTools: () =>
    set((s) =>
      patchActiveThread(s, (t) => {
        const now = Date.now()
        let changed = false
        const messages = t.messages.map((m) => {
          if (m.role === 'tool' && m.streaming && isToolActiveStatus(m.toolStatus)) {
            changed = true
            return { ...m, toolStatus: 'cancelled' as const, updatedAt: now }
          }
          return m
        })
        return changed ? { ...t, messages, updatedAt: now } : t
      }),
    ),

  attachMarkProposalsFromSnapshot: (content) =>
    set((s) => {
      let remaining = [...s.pendingMarkProposalSnapshotContents, content]
      let attachedCount = 0
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
            : finalizeThreadMessages(attached.messages),
          updatedAt: Date.now(),
        }
      })
      acpDevLog('mark-proposal snapshot result', {
        chars: content.length,
        attachedCount,
        queuedCount: remaining.length,
      })
      return { ...patched, pendingMarkProposalSnapshotContents: remaining }
    }),

  resolveMarkProposal: (proposalId, status) =>
    set((s) =>
      patchActiveThread(s, (t) => ({
        ...t,
        messages: resolveMarkProposalOnMessages(t.messages, proposalId, status),
        updatedAt: Date.now(),
      })),
    ),

  selectChapterMarkPlan: (entryId) =>
    set((s) =>
      patchActiveThread(s, (t) => ({
        ...t,
        messages: selectChapterMarkPlanOnMessages(t.messages, entryId),
        updatedAt: Date.now(),
      })),
    ),

  createThread: (workspaceRoot, runtimeId) => {
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
          ? { ...t, messages: freezeMessages(t.messages), updatedAt: Date.now() }
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
    return thread.id
  },

  switchWorkspace: (workspaceRoot) => {
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
        ? { ...t, messages: freezeMessages(t.messages), updatedAt: Date.now() }
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

    return targetThreadId
  },


  switchThread: (threadId) => {
    const s = get()
    if (threadId === s.activeThreadId) return
    if (s.prompting) return
    const target = s.threads.find((t) => t.id === threadId)
    if (!target) return
    const frozen = s.threads.map((t) =>
      t.id === s.activeThreadId
        ? { ...t, messages: freezeMessages(t.messages), updatedAt: Date.now() }
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
  },

  deleteThread: (threadId) =>
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
    }),

  renameThread: (threadId, title) =>
    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === threadId
          ? { ...t, title: title.trim() || '新对话', updatedAt: Date.now() }
          : t,
      ),
    })),

  applySessionUpdate: (update) => {
    const kind =
      typeof update.sessionUpdate === 'string' ? update.sessionUpdate : ''

    if (kind === MONTREE_SETTLE_COMPLETE_KIND) {
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

    if (kind === 'config_option_update' || kind === 'config_options_update') {
      return
    }

    if (kind === 'plan' || kind === 'plan_update') {
      const entries = parseAcpPlanEntries(update)
      if (entries.length === 0 && kind === 'plan_update') {
        // 空 entries 视为清空该计划卡片
      }
      const summary = summarizePlanProgress(entries)
      set((s) =>
        patchActiveThread(s, (t) => {
          const messages = [...t.messages]
          const idx = messages.findIndex((m) => m.role === 'plan')
          const prev = idx >= 0 ? messages[idx] : undefined
          const next: AcpChatMessage = {
            id: prev?.id ?? newId('plan'),
            role: 'plan',
            text: entries.map((e) => e.content).join('\n'),
            planEntries: entries,
            createdAt: prev?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
            streaming: summary.active,
          }
          if (idx >= 0) messages[idx] = next
          else {
            const emptyAgentIdx = messages.findIndex(
              (m) => m.role === 'agent' && m.streaming && !m.text.trim(),
            )
            if (emptyAgentIdx >= 0) messages.splice(emptyAgentIdx, 0, next)
            else messages.push(next)
          }
          return { ...t, messages, updatedAt: Date.now() }
        }),
      )
      return
    }

    if (kind === 'tool_call' || kind === 'tool_call_update') {
      set((s) => {
        let remaining = s.pendingMarkProposalSnapshotContents
        let attachedCount = 0
        let proposalToolTitle: string | undefined
        const toolCallId =
          typeof update.toolCallId === 'string'
            ? update.toolCallId
            : typeof update.tool_call_id === 'string'
              ? update.tool_call_id
              : undefined
        const patched = patchActiveThread(s, (t) => {
          const updated = applyToolCallUpdate(t.messages, update)
          const currentTool = [...updated]
            .reverse()
            .find(
              (message) =>
                message.role === 'tool' &&
                message.toolCallId === toolCallId,
            )
          proposalToolTitle = currentTool?.toolTitle
          const attached = attachPendingMarkProposals(updated, remaining)
          remaining = attached.remaining
          attachedCount = attached.attachedCount
          const hasStreamingAgent = attached.messages.some(
            (message) => message.role === 'agent' && message.streaming,
          )
          return {
            ...t,
            messages: hasStreamingAgent
              ? attached.messages
              : finalizeThreadMessages(attached.messages),
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

    if (kind === 'tool_call_content_chunk') {
      const toolCallId =
        typeof update.toolCallId === 'string' ? update.toolCallId : ''
      if (!toolCallId) return
      const chunkText = flattenToolContent(
        update.content !== undefined ? [update.content] : update.content,
      )
      if (!chunkText) return
      set((s) =>
        patchActiveThread(s, (t) => {
          const messages = [...t.messages]
          const idx = messages.findIndex(
            (m) => m.role === 'tool' && m.toolCallId === toolCallId,
          )
          if (idx < 0) {
            messages.push({
              id: newId('tool'),
              role: 'tool',
              toolCallId,
              toolTitle: '工具调用',
              toolKind: 'other',
              toolStatus: 'in_progress',
              toolContentText: chunkText,
              text: chunkText,
              createdAt: Date.now(),
              streaming: true,
            })
          } else {
            const prev = messages[idx]!
            const merged = `${prev.toolContentText ?? prev.text ?? ''}${chunkText}`
            messages[idx] = {
              ...prev,
              toolContentText: merged,
              text: merged,
              // 回合已收尾标记的工具：迟到内容落定合入，不再点亮流式
              // （解析经 turnEnded 放行，结果状态仍由展示层如实表达）
              streaming: prev.turnEnded === true ? false : isToolActiveStatus(prev.toolStatus),
              updatedAt: Date.now(),
              toolStatus: prev.toolStatus ?? 'in_progress',
            }
          }
          const hasStreamingAgent = messages.some(
            (message) => message.role === 'agent' && message.streaming,
          )
          return {
            ...t,
            messages: hasStreamingAgent ? messages : finalizeThreadMessages(messages),
            updatedAt: Date.now(),
          }
        }),
      )
      return
    }

    const text = extractTextFromContent(update.content)
    if (
      !text &&
      kind !== 'agent_message_chunk' &&
      kind !== 'agent_thought_chunk' &&
      kind !== 'user_message_chunk'
    ) {
      return
    }

    const role: AcpChatRole =
      kind === 'agent_thought_chunk'
        ? 'thought'
        : kind === 'user_message_chunk'
          ? 'user'
          : 'agent'

    if (!text) return

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
        const messages = [...t.messages]
        const last = messages[messages.length - 1]
        if (last && last.role === role && last.streaming) {
          messages[messages.length - 1] = {
            ...last,
            text: last.text + effectiveText,
            updatedAt: Date.now(),
          }
          return { ...t, messages, updatedAt: Date.now() }
        }

        const emptyAgentIdx = messages.findIndex(
          (m) => m.role === 'agent' && m.streaming && !m.text.trim(),
        )

        if (role === 'agent' && emptyAgentIdx >= 0) {
          messages[emptyAgentIdx] = {
            ...messages[emptyAgentIdx]!,
            text: effectiveText,
            updatedAt: Date.now(),
            streaming: true,
          }
          return { ...t, messages, updatedAt: Date.now() }
        }

        const nextMsg: AcpChatMessage = {
          id: newId(role),
          role,
          text: effectiveText,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          // 冻结后到达的迟到 chunk（prompt 结果先于文本通知的竞态）：
          // 正文照常合入，但不再点亮 streaming——否则另起一条永不落定的
          // 流式气泡。回放重建走通路（turnSettled 为 false）不受影响。
          streaming: !s.turnSettled,
        }

        if (role === 'thought' && emptyAgentIdx >= 0) {
          messages.splice(emptyAgentIdx, 0, nextMsg)
        } else {
          messages.push(nextMsg)
        }
        return { ...t, messages, updatedAt: Date.now() }
      }),
    }))
  },
})
