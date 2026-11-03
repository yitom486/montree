import { toProposedMark } from '@yitom/annotations'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { useAnnotationAgentStore } from '@/stores/annotation-agent-store'
import type { ChatMarkProposal } from '@yitom/chat-core'

export type { ChatMarkProposal } from '@yitom/chat-core'
export {
  isPendingMarkProposalEntry,
  isProposalPromotedToAgent,
  resolveMarkProposalOnMessages,
  shouldHideProposeToolMessage,
} from '@yitom/chat-core'

import {
  currentTurnStart,
  isProposeMarkToolTitle,
  promoteMarkProposalsToLastAgent as promoteCore,
} from '@yitom/chat-core'

export function collectStoreFallbackProposal(messages: AcpChatMessage[]): ChatMarkProposal | null {
  const store = useAnnotationAgentStore.getState()
  if (store.proposeHost !== 'main-agent' || !store.pendingDraft) return null
  // MCP 工具与快照旁路拥有相同的 toolCallId；编辑器草稿只是兜底，不能再生成 main:* 副本。
  if (messages.slice(currentTurnStart(messages)).some(message =>
    message.role === 'tool' && isProposeMarkToolTitle(message.toolTitle))) return null
  const draft = store.pendingDraft
  return {
    proposal: toProposedMark({
      id: `main:${draft.fileKey}`,
      excerpt: draft.excerpt,
      note: draft.note,
      source: 'agent',
    }),
    status: 'pending',
  }
}

/** 回合结束时：把工具 propose 挂到最近一条 Agent 回复下方（内嵌块数据源）。 */
export function promoteMarkProposalsToLastAgent(
  messages: AcpChatMessage[],
): AcpChatMessage[] {
  return promoteCore(messages, collectStoreFallbackProposal(messages))
}
