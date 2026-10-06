import { ProposeMarkChatBlock } from '@/components/agent/propose/ProposeMarkChatBlock'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { dismissProposedMark } from '@/lib/agent/context/propose-mark'

export type ResolveMarkProposal = (
  proposalId: string,
  status: Exclude<import('@montree/annotations').MarkProposalStatus, 'pending'>,
) => void

export interface AgentBlockRendererProps {
  message: AcpChatMessage
  resolveMarkProposal?: ResolveMarkProposal
}

/** @deprecated 请直接用 ProposeMarkChatBlock；保留 tool 消息兼容入口 */
export function AgentBlockRenderer({
  message,
  resolveMarkProposal,
}: AgentBlockRendererProps) {
  const resolveFromStore = useAcpUiStore((s) => s.resolveMarkProposal)
  const resolve = resolveMarkProposal ?? resolveFromStore

  if (!message.markProposal || message.markProposalStatus === 'dismissed') {
    return null
  }

  return (
    <ProposeMarkChatBlock
      proposal={message.markProposal}
      status={message.markProposalStatus ?? 'pending'}
      onResolved={(status) => {
        resolve(message.markProposal!.id, status)
        if (status === 'adopted' || status === 'dismissed') dismissProposedMark()
      }}
    />
  )
}
