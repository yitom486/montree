import type { ChatMessage, ChatToolDiff } from './chat-message'
import type { AcpPlanEntry } from './plan'
import type { ChatMarkProposal } from './mark-promotion'
import type { AcpMessageAttachment } from './attachments'
import { isToolActiveStatus } from './chat-message'
import { enrichAcpToolMessage } from './enrich-tool-message'
import { promoteChapterMarkPlansToLastAgent } from './chapter-mark-plans'
import { promoteMarkProposalsToLastAgent } from './mark-promotion'
import { pruneIntermediateAgentReplies } from './prune-agent-replies'
import { isGenericToolName } from './tool-call-metadata'

/**
 * 聊天事件归约器（E1）：ACP 事件流 → ChatMessage 的纯状态机。
 *
 * 逐字对齐宿主语义（行号指迁移前 `apps/desktop/src/stores/acp/`）：
 * - 文本分支 `chat-slice.ts:729-776`、工具分支 `chat-helpers.ts:240-311`、
 *   工具 chunk `chat-slice.ts:627-679`、计划分支 `chat-slice.ts:543-575`、
 *   占位 `chat-slice.ts:241-264`、冻结 `chat-slice.ts:101-122`、
 *   收尾 `chat-helpers.ts:48-54`、用户/系统追加 `chat-slice.ts:204-237`。
 *
 * 宿主侧保留（非归约器职责）：回放清洗（prompting/脚手架上下文）、合并器
 * 保序（32ms 批量/chunk 可合并判定）、快照旁路队列、单例审批 ingest、
 * 会话/线程隔离过滤、连接状态机。宿主把清洗合并后的干净输入喂给本归约器。
 * 不变量见 `docs/chat-feed-design-input.md §7`，违背任一条即回归。
 */

export interface ChatFeedState {
  messages: ChatMessage[]
  /** 回合已收尾：新建消息不再点亮 streaming，迟到内容只合入正文 */
  turnSettled: boolean
}

export interface ChatFeedCtx {
  now?: () => number
  createId?: (role: string) => string
}

/** 工具调用干净输入（宿主先用 core 解析函数把 ACP 线路命名归一化，不在本归约器处理 `tool_call_id` 双拼） */
export interface ChatFeedToolCall {
  toolCallId: string
  title?: string
  name?: string
  inputSummary?: import('./tool-call-metadata').ToolInputSummary
  kind?: string
  status?: string
  /** 提供即替换（宿主 `toolUpdateContentText` 已算好；缺省沿用旧值） */
  contentText?: string
  /** 提供即替换（含空数组清空；缺省沿用旧值） */
  diffs?: ChatToolDiff[]
  locations?: Array<{ path: string; line?: number }>
}

export type ChatFeedEvent =
  | { type: 'user-append'; text: string; attachments?: AcpMessageAttachment[] }
  | { type: 'system-append'; text: string }
  | { type: 'text-chunk'; role: 'agent' | 'thought' | 'user'; text: string }
  | { type: 'tool-call'; call: ChatFeedToolCall; proposalFallback?: ChatMarkProposal | null }
  | { type: 'tool-chunk'; toolCallId: string; text: string; proposalFallback?: ChatMarkProposal | null }
  | { type: 'plan'; entries: AcpPlanEntry[]; active: boolean }
  | { type: 'begin-reply' }
  | { type: 'finish-turn'; proposalFallback?: ChatMarkProposal | null; settle?: boolean }
  | { type: 'freeze-light' }
  | { type: 'cancel-tools' }
  /**
   * 失败回合回滚：删掉不在 keepIds 中的 agent/thought 文本消息（如额度/网络
   * 失败前流进来的错误正文），工具调用记录保留（执行历史），用户/系统/计划
   * 消息保留。调用方传入回合开始时的已有消息 id 集合（id 锚定，不用墙钟，
   * 同毫秒多回合在 mock/E2E 下也不会误删旧答案）。
   */
  | { type: 'rollback-turn'; keepIds: string[] }

export const CHAT_FEED_MAX_MESSAGES = 300

function hasStreamingAgent(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.role === 'agent' && message.streaming)
}

function emptyAgentIndex(messages: ChatMessage[]): number {
  return messages.findIndex(
    (m) => m.role === 'agent' && m.streaming && !m.text.trim(),
  )
}

/** 收尾：prune → enrich → 提议 promote → 章计划 promote（宿主 `finalizeThreadMessages(prune…)` 同序） */
export function finalizeFeedMessages(
  messages: ChatMessage[],
  proposalFallback: ChatMarkProposal | null = null,
): ChatMessage[] {
  return promoteChapterMarkPlansToLastAgent(
    promoteMarkProposalsToLastAgent(
      pruneIntermediateAgentReplies(messages).map((m) =>
        m.role === 'tool' ? enrichAcpToolMessage(m) : m,
      ),
      proposalFallback,
    ),
  )
}

function finalizeIfQuiet(
  messages: ChatMessage[],
  proposalFallback: ChatMarkProposal | null = null,
): ChatMessage[] {
  return hasStreamingAgent(messages) ? messages : finalizeFeedMessages(messages, proposalFallback)
}

function freezeStreaming(messages: ChatMessage[], now: number): ChatMessage[] {
  return messages.map((m) => {
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
}

export function applyChatEvent(
  state: ChatFeedState,
  event: ChatFeedEvent,
  ctx: ChatFeedCtx = {},
): ChatFeedState {
  const now = ctx.now ?? Date.now
  const createId = ctx.createId ?? ((role: string) => `${role}-${now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`)

  switch (event.type) {
    case 'user-append': {
      const message: ChatMessage = {
        id: createId('user'),
        role: 'user',
        text: event.text,
        createdAt: now(),
        ...(event.attachments && event.attachments.length > 0 ? { attachments: event.attachments } : {}),
      }
      return { ...state, messages: [...state.messages, message] }
    }

    case 'system-append': {
      const message: ChatMessage = {
        id: createId('sys'),
        role: 'system',
        text: event.text,
        createdAt: now(),
      }
      return { ...state, messages: [...state.messages, message] }
    }

    case 'text-chunk': {
      if (!event.text) return state
      const { role } = event
      const messages = state.messages.map(m => role !== 'thought' && m.role === 'thought' && m.streaming
        ? { ...m, streaming: false, updatedAt: now() } : m)
      const last = messages[messages.length - 1]
      if (last && last.role === role && last.streaming) {
        messages[messages.length - 1] = { ...last, text: last.text + event.text, updatedAt: now() }
        return { ...state, messages }
      }
      const emptyIdx = emptyAgentIndex(messages)
      if (role === 'agent' && emptyIdx >= 0) {
        messages[emptyIdx] = {
          ...messages[emptyIdx]!,
          text: event.text,
          updatedAt: now(),
          streaming: true,
        }
        return { ...state, messages }
      }
      const next: ChatMessage = {
        id: createId(role),
        role,
        text: event.text,
        createdAt: now(),
        updatedAt: now(),
        // 冻结后到达的迟到 chunk：正文照常合入，但不再点亮 streaming——
        // 否则另起一条永不落定的流式气泡。
        streaming: !state.turnSettled,
      }
      if (role === 'thought' && emptyIdx >= 0) messages.splice(emptyIdx, 0, next)
      else messages.push(next)
      return { ...state, messages }
    }

    case 'tool-call': {
      const { toolCallId } = event.call
      if (!toolCallId) return state
      const startsTool = !state.messages.some(m => m.role === 'tool' && m.toolCallId === toolCallId)
        || event.call.status === 'pending' || event.call.status === 'in_progress'
      const messages = state.messages.map(m => startsTool && m.role === 'thought' && m.streaming
        ? { ...m, streaming: false, updatedAt: now() } : m)
      const idx = messages.findIndex((m) => m.role === 'tool' && m.toolCallId === toolCallId)
      const prev = idx >= 0 ? messages[idx] : undefined
      const status = event.call.status ?? prev?.toolStatus ?? 'pending'
      const title = event.call.title ?? prev?.toolTitle ?? '工具调用'
      const kind = event.call.kind ?? prev?.toolKind ?? 'other'
      const contentText = event.call.contentText ?? prev?.toolContentText ?? prev?.text ?? ''
      const base: ChatMessage = {
        id: prev?.id ?? createId('tool'),
        role: 'tool',
        toolCallId,
        toolKind: kind,
        toolStatus: status,
        toolTitle: title,
        toolName: event.call.name && !(prev?.toolName && isGenericToolName(event.call.name))
          ? event.call.name : prev?.toolName,
        toolInputSummary: event.call.inputSummary
          ? { ...prev?.toolInputSummary, ...event.call.inputSummary } : prev?.toolInputSummary,
        toolContentText: contentText,
        toolDiffs: (event.call.diffs ?? prev?.toolDiffs)?.length
          ? (event.call.diffs ?? prev?.toolDiffs)
          : undefined,
        toolLocations: event.call.locations ?? prev?.toolLocations,
        text: contentText || title,
        createdAt: prev?.createdAt ?? now(),
        updatedAt: now(),
        streaming: isToolActiveStatus(status),
        markProposal: prev?.markProposal,
        markProposalStatus: prev?.markProposalStatus,
        markProposals: prev?.markProposals,
        chapterMarkPlan: prev?.chapterMarkPlan,
      }
      const message = enrichAcpToolMessage(base)
      if (idx >= 0) messages[idx] = message
      else {
        const emptyIdx = emptyAgentIndex(messages)
        if (emptyIdx >= 0) messages.splice(emptyIdx, 0, message)
        else messages.push(message)
      }
      return { ...state, messages: finalizeIfQuiet(messages, event.proposalFallback ?? null) }
    }

    case 'tool-chunk': {
      if (!event.toolCallId || !event.text) return state
      const messages = [...state.messages]
      const idx = messages.findIndex(
        (m) => m.role === 'tool' && m.toolCallId === event.toolCallId,
      )
      if (idx < 0) {
        messages.push({
          id: createId('tool'),
          role: 'tool',
          toolCallId: event.toolCallId,
          toolTitle: '工具调用',
          toolKind: 'other',
          toolStatus: 'in_progress',
          toolContentText: event.text,
          text: event.text,
          createdAt: now(),
          streaming: true,
        })
      } else {
        const prev = messages[idx]!
        const merged = `${prev.toolContentText ?? prev.text ?? ''}${event.text}`
        messages[idx] = {
          ...prev,
          toolContentText: merged,
          text: merged,
          // 回合已收尾标记的工具：迟到内容落定合入，不再点亮流式
          streaming: prev.turnEnded === true ? false : isToolActiveStatus(prev.toolStatus),
          updatedAt: now(),
          toolStatus: prev.toolStatus ?? 'in_progress',
        }
      }
      return { ...state, messages: finalizeIfQuiet(messages, event.proposalFallback ?? null) }
    }

    case 'plan': {
      const messages = [...state.messages]
      const idx = messages.findIndex((m) => m.role === 'plan')
      const prev = idx >= 0 ? messages[idx] : undefined
      const next: ChatMessage = {
        id: prev?.id ?? createId('plan'),
        role: 'plan',
        text: event.entries.map((e) => e.content).join('\n'),
        planEntries: event.entries,
        createdAt: prev?.createdAt ?? now(),
        updatedAt: now(),
        streaming: event.active,
      }
      if (idx >= 0) messages[idx] = next
      else {
        const emptyIdx = emptyAgentIndex(messages)
        if (emptyIdx >= 0) messages.splice(emptyIdx, 0, next)
        else messages.push(next)
      }
      return { ...state, messages }
    }

    case 'begin-reply': {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'agent' && last.streaming) return { ...state, turnSettled: false }
      return {
        turnSettled: false,
        messages: [
          ...state.messages,
          {
            id: createId('agent'),
            role: 'agent',
            text: '',
            createdAt: now(),
            updatedAt: now(),
            streaming: true,
          },
        ],
      }
    }

    case 'finish-turn': {
      const frozen = freezeStreaming(state.messages, now())
      return {
        turnSettled: event.settle === false ? state.turnSettled : true,
        messages: finalizeFeedMessages(frozen, event.proposalFallback ?? null),
      }
    }

    case 'freeze-light': {
      // 切线程轻冻：仅收 streaming + 300 裁剪 + blob 脱钩，不打 turnEnded、不改 status、不 enrich
      return {
        ...state,
        messages: state.messages.slice(-CHAT_FEED_MAX_MESSAGES).map((m) => {
          const base = m.streaming ? { ...m, streaming: false } : m
          if (!base.attachments?.length) return base
          return {
            ...base,
            attachments: base.attachments.map((a) =>
              a.previewUrl?.startsWith('blob:') ? { ...a, previewUrl: undefined } : a,
            ),
          }
        }),
      }
    }

    case 'cancel-tools': {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.role === 'tool' && m.streaming && isToolActiveStatus(m.toolStatus)
            ? { ...m, toolStatus: 'cancelled' }
            : m,
        ),
      }
    }

    case 'rollback-turn': {
      const keep = new Set(event.keepIds)
      return {
        ...state,
        messages: state.messages.filter(
          (m) => (m.role !== 'agent' && m.role !== 'thought') || keep.has(m.id),
        ),
      }
    }
  }
}
