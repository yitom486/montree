import { DEFAULT_ACP_RUNTIME_ID } from '@montree/contracts'
import {
  type AcpChatMessage,
  flattenToolContent,
  isToolActiveStatus,
  parseToolDiffs,
  parseToolLocations,
} from '@/stores/acp-chat-types'
import { enrichAcpToolMessage } from '@/lib/agent/enrich-tool-message'
import { pruneBlankThreads } from '@/lib/agent/acp-thread-prune'
import {
  promoteChapterMarkPlansToLastAgent,
} from '@/lib/agent/promote-chapter-mark-plans'
import {
  promoteMarkProposalsToLastAgent,
} from '@/lib/agent/promote-mark-proposals'
import {
  isProposeMarkToolTitle,
  parseMarkProposalsFromTool,
} from '@/lib/agent/parse-mark-proposal'
import {
  MAX_MESSAGES_PER_THREAD,
  type AcpChatThread,
  type AcpUiStore,
} from './acp-types'

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyThread(
  workspaceRoot?: string,
  runtimeId = DEFAULT_ACP_RUNTIME_ID,
): AcpChatThread {
  const now = Date.now()
  return {
    id: newId('thread'),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    workspaceRoot,
    runtimeId,
    agentSessionIds: {},
    messages: [],
  }
}

export function finalizeThreadMessages(messages: AcpChatMessage[]): AcpChatMessage[] {
  return promoteChapterMarkPlansToLastAgent(
    promoteMarkProposalsToLastAgent(
      messages.map((m) => (m.role === 'tool' ? enrichAcpToolMessage(m) : m)),
    ),
  )
}

export function titleFromMessages(messages: AcpChatMessage[]): string {
  const user = messages.find(
    (m) => m.role === 'user' && (m.text.trim() || (m.attachments?.length ?? 0) > 0),
  )
  if (!user) return '新对话'
  const t = user.text.replace(/\s+/g, ' ').trim()
  if (t) return t.length > 36 ? `${t.slice(0, 36)}…` : t
  const first = user.attachments?.[0]?.name
  return first ? `附件 · ${first}` : '新对话'
}

/**
 * 空线程例外判定：线程是否有本地实质消息。
 * 仅系统消息或空白视为无历史（load 回放应放行重建）；出现任一 user/agent（含
 * 空占位 streaming 气泡）即视为有历史，回放照常压制。
 */
export function threadHasSubstantiveMessages(
  thread: Pick<AcpChatThread, 'messages'>,
): boolean {
  return thread.messages.some((m) => m.role !== 'system')
}

export function freezeMessages(messages: AcpChatMessage[]): AcpChatMessage[] {
  return messages.slice(-MAX_MESSAGES_PER_THREAD).map((m) => {
    const base = m.streaming ? { ...m, streaming: false } : m
    if (!base.attachments?.length) return base
    return {
      ...base,
      attachments: base.attachments.map((a) =>
        a.previewUrl?.startsWith('blob:')
          ? { ...a, previewUrl: undefined }
          : a,
      ),
    }
  })
}

export function ensureThreadList(threads: AcpChatThread[], workspaceRoot?: string): {
  threads: AcpChatThread[]
  activeThreadId: string
} {
  if (threads.length === 0) {
    const fresh = createEmptyThread(workspaceRoot)
    return { threads: [fresh], activeThreadId: fresh.id }
  }
  return { threads, activeThreadId: threads[0]!.id }
}

export function openPanelPreservingThread(
  state: Pick<AcpUiStore, 'threads' | 'activeThreadId'>,
  workspaceRoot?: string,
): Pick<AcpUiStore, 'threads' | 'activeThreadId' | 'historyOpen'> {
  const pruned = pruneBlankThreads(state.threads, { keepId: state.activeThreadId })
  const next = ensureThreadList(pruned, workspaceRoot)
  const activeThreadId = next.threads.some((t) => t.id === state.activeThreadId)
    ? state.activeThreadId
    : next.activeThreadId
  return { threads: next.threads, activeThreadId, historyOpen: false }
}

export function ensureActiveThreadForRuntime(
  state: Pick<AcpUiStore, 'threads' | 'activeThreadId'> & {
    selectedRuntimeId?: string
  },
): { threads: AcpChatThread[]; activeThreadId: string } {
  const runtimeId = state.selectedRuntimeId || DEFAULT_ACP_RUNTIME_ID
  const active = state.threads.find((t) => t.id === state.activeThreadId)
  if (active && (active.runtimeId || DEFAULT_ACP_RUNTIME_ID) === runtimeId) {
    return { threads: state.threads, activeThreadId: state.activeThreadId }
  }
  const candidates = state.threads
    .filter((t) => (t.runtimeId || DEFAULT_ACP_RUNTIME_ID) === runtimeId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (candidates.length > 0) {
    return { threads: state.threads, activeThreadId: candidates[0]!.id }
  }
  const fresh = createEmptyThread(undefined, runtimeId)
  return { threads: [fresh, ...state.threads], activeThreadId: fresh.id }
}

export function patchActiveThread(
  state: Pick<AcpUiStore, 'threads' | 'activeThreadId'> & {
    selectedRuntimeId?: string
  },
  patch: (thread: AcpChatThread) => AcpChatThread,
): { threads: AcpChatThread[]; activeThreadId?: string } {
  // 线程↔运行时绑定防线：若 activeThread.runtimeId 与 selectedRuntimeId 不一致，
  // 说明此前经跨 runtime switchThread（或旧持久化）进入了错位态。此处绝不把
  // 异 runtime 消息写入当前 thread，而是先纠偏到对的线程（同 runtime 最新；
  // 无则建专属空线程），再 patch。调用方 spread 返回值即可自动切 active。
  const ensured = ensureActiveThreadForRuntime(state)
  const threads = ensured.threads.map((t) =>
    t.id === ensured.activeThreadId ? patch(t) : t,
  )
  if (ensured.activeThreadId !== state.activeThreadId) {
    return { threads, activeThreadId: ensured.activeThreadId }
  }
  return { threads }
}

export interface MarkProposalAttachResult {
  messages: AcpChatMessage[]
  attached: boolean
  toolCallId?: string
  proposalCount?: number
}

export function attachMarkProposalsToCurrentTurn(
  messages: AcpChatMessage[],
  content: string,
): MarkProposalAttachResult {
  let turnStart = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      turnStart = i
      break
    }
  }

  let index = -1
  for (let i = messages.length - 1; i > turnStart; i -= 1) {
    const message = messages[i]
    if (
      message?.role === 'tool' &&
      !message.markProposal &&
      !message.markProposals?.length &&
      isProposeMarkToolTitle(message.toolTitle)
    ) {
      index = i
      break
    }
  }
  if (index < 0) return { messages, attached: false }

  const tool = messages[index]!
  const proposals = parseMarkProposalsFromTool(tool.toolTitle, content, tool.toolCallId)
  if (proposals.length === 0) return { messages, attached: false, toolCallId: tool.toolCallId }

  const next = [...messages]
  next[index] =
    proposals.length === 1
      ? {
          ...tool,
          toolContentText: content,
          text: content,
          markProposal: proposals[0],
          markProposalStatus: 'pending',
        }
      : {
          ...tool,
          toolContentText: content,
          text: content,
          markProposals: proposals.map((proposal) => ({
            proposal,
            status: 'pending' as const,
          })),
        }
  return {
    messages: next,
    attached: true,
    toolCallId: tool.toolCallId,
    proposalCount: proposals.length,
  }
}

export function attachPendingMarkProposals(
  messages: AcpChatMessage[],
  contents: string[],
): { messages: AcpChatMessage[]; remaining: string[]; attachedCount: number } {
  let next = messages
  const remaining: string[] = []
  let attachedCount = 0
  for (const content of contents) {
    const attached = attachMarkProposalsToCurrentTurn(next, content)
    if (!attached.attached) {
      remaining.push(content)
      continue
    }
    next = attached.messages
    attachedCount += attached.proposalCount ?? 0
  }
  return { messages: next, remaining, attachedCount }
}

export function applyToolCallUpdate(
  messages: AcpChatMessage[],
  update: Record<string, unknown>,
): AcpChatMessage[] {
  const toolCallId =
    typeof update.toolCallId === 'string'
      ? update.toolCallId
      : typeof update.tool_call_id === 'string'
        ? update.tool_call_id
        : ''
  if (!toolCallId) return messages

  const next = [...messages]
  const idx = next.findIndex((m) => m.role === 'tool' && m.toolCallId === toolCallId)
  const prev = idx >= 0 ? next[idx] : undefined

  const status =
    typeof update.status === 'string'
      ? update.status
      : (prev?.toolStatus ?? 'pending')
  const title =
    typeof update.title === 'string'
      ? update.title
      : (prev?.toolTitle ?? '工具调用')
  const kind =
    typeof update.kind === 'string' ? update.kind : (prev?.toolKind ?? 'other')

  let contentText = prev?.toolContentText ?? prev?.text ?? ''
  let toolDiffs = prev?.toolDiffs
  if ('content' in update) {
    contentText = flattenToolContent(update.content)
    toolDiffs = parseToolDiffs(update.content)
  }

  let locations = prev?.toolLocations
  if ('locations' in update) {
    locations = parseToolLocations(update.locations)
  }

  const active = isToolActiveStatus(status)
  const base: AcpChatMessage = {
    id: prev?.id ?? newId('tool'),
    role: 'tool',
    toolCallId,
    toolKind: kind,
    toolStatus: status,
    toolTitle: title,
    toolContentText: contentText,
    toolDiffs: toolDiffs && toolDiffs.length > 0 ? toolDiffs : undefined,
    toolLocations: locations,
    text: contentText || title,
    createdAt: prev?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    streaming: active,
    markProposal: prev?.markProposal,
    markProposalStatus: prev?.markProposalStatus,
    markProposals: prev?.markProposals,
    chapterMarkPlan: prev?.chapterMarkPlan,
  }
  const message = enrichAcpToolMessage(base)

  if (idx >= 0) next[idx] = message
  else {
    const emptyAgentIdx = next.findIndex(
      (m) => m.role === 'agent' && m.streaming && !m.text.trim(),
    )
    if (emptyAgentIdx >= 0) next.splice(emptyAgentIdx, 0, message)
    else next.push(message)
  }
  return next
}
