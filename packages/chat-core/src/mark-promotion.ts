import type { MarkProposalStatus, ProposedMark } from '@montree/annotations'
import type { ChatMessage } from './chat-message'
import { isProposeMarkToolTitle, parseMarkProposalsFromTool } from './parse-mark-proposal'

export interface ChatMarkProposal {
  proposal: ProposedMark
  status: MarkProposalStatus
  toolCallId?: string
}

export function isPendingMarkProposalEntry(entry: ChatMarkProposal): boolean {
  return entry.status === 'pending'
}

export function isProposalPromotedToAgent(
  messages: ChatMessage[],
  proposalId: string,
): boolean {
  return messages.some(
    (message) =>
      message.role === 'agent' &&
      message.markProposals?.some((row) => row.proposal.id === proposalId),
  )
}

export function shouldHideProposeToolMessage(message: ChatMessage): boolean {
  return message.role === 'tool' && Boolean(message.markProposal)
}

export function mergeProposals(
  existing: ChatMarkProposal[] | undefined,
  incoming: ChatMarkProposal[],
): ChatMarkProposal[] {
  const merged = [...(existing ?? [])]
  for (const item of incoming) {
    if (merged.some((row) => row.proposal.id === item.proposal.id)) continue
    merged.push(item)
  }
  return merged
}

/**
 * 提议决议（宿主 `promote-mark-proposals.ts` 整搬，纯 map 无 store/API 依赖）：
 * agent 内嵌块 + tool 单/多提议三处同刷 status。
 */
export function resolveMarkProposalOnMessages(
  messages: ChatMessage[],
  proposalId: string,
  status: Exclude<MarkProposalStatus, 'pending'>,
): ChatMessage[] {
  return messages.map((message) => {
    let next = message
    if (message.markProposals?.some((row) => row.proposal.id === proposalId)) {
      next = {
        ...next,
        markProposals: message.markProposals.map((row) =>
          row.proposal.id === proposalId ? { ...row, status } : row,
        ),
      }
    }
    if (
      message.role === 'tool' &&
      message.markProposal?.id === proposalId
    ) {
      next = { ...next, markProposalStatus: status }
    }
    if (
      message.role === 'tool' &&
      message.markProposals?.some((row) => row.proposal.id === proposalId)
    ) {
      next = {
        ...next,
        markProposals: message.markProposals.map((row) =>
          row.proposal.id === proposalId ? { ...row, status } : row,
        ),
      }
    }
    return next
  })
}

export function currentTurnStart(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index + 1
  }
  return 0
}

export function collectToolProposals(
  messages: ChatMessage[],
  startIndex = 0,
): ChatMarkProposal[] {
  const rows: ChatMarkProposal[] = []
  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role !== 'tool') continue
    if (message.markProposals?.length) {
      for (const row of message.markProposals) {
        if (row.status === 'dismissed') continue
        rows.push({
          proposal: row.proposal,
          status: row.status ?? 'pending',
          toolCallId: message.toolCallId,
        })
      }
      continue
    }
    if (!message.markProposal) continue
    if (message.markProposalStatus === 'dismissed') continue
    rows.push({
      proposal: message.markProposal,
      status: message.markProposalStatus ?? 'pending',
      toolCallId: message.toolCallId,
    })
  }
  return rows
}

/**
 * 回合结束时：把工具 propose 挂到最近一条 Agent 回复下方（内嵌块数据源）。
 * 纯函数版：store 快照旁路提议由调用方经 `fallback` 传入（宿主 `collectStoreFallbackProposal`）。
 */
export function promoteMarkProposalsToLastAgent(
  messages: ChatMessage[],
  fallback: ChatMarkProposal | null = null,
): ChatMessage[] {
  // 旧回合的工具提议已固定在其原 Agent 回复上；不可在下一轮结束时再搬运一次，
  // 否则会在新卡片里同时出现「待确认」和上一轮的「已保存」状态。
  const fromTools = collectToolProposals(messages, currentTurnStart(messages))
  const incoming = fallback
    ? mergeProposals([], [...fromTools, fallback])
    : fromTools
  if (incoming.length === 0) return messages

  let lastAgentIdx = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!
    if (message.role === 'agent' && !message.streaming && message.text.trim()) {
      lastAgentIdx = i
      break
    }
  }
  if (lastAgentIdx < 0) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'agent' && !messages[i]?.streaming) {
        lastAgentIdx = i
        break
      }
    }
  }
  if (lastAgentIdx < 0) return messages

  return messages.map((message, idx) =>
    idx === lastAgentIdx
      ? { ...message, markProposals: mergeProposals(message.markProposals, incoming) }
      : message,
  )
}

export interface MarkProposalAttachResult {
  messages: ChatMessage[]
  attached: boolean
  toolCallId?: string
  proposalCount?: number
}

/**
 * 快照旁路挂载（E1b 自宿主 `chat-helpers.ts:163-219` 整搬，纯函数无 store 依赖）：
 * 本 user 回合内倒序第一个无提议的 propose-title tool 消费快照内容。
 */
export function attachMarkProposalsToCurrentTurn(
  messages: ChatMessage[],
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
  messages: ChatMessage[],
  contents: string[],
): { messages: ChatMessage[]; remaining: string[]; attachedCount: number } {
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
