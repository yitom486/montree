import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { isToolActiveStatus } from '@/stores/acp-chat-types'
import { enrichToolMessageWithChapterPlan } from '@/lib/agent/parse-chapter-mark-plan'
import { enrichToolMessageWithMarkProposal } from '@/lib/agent/parse-mark-proposal'
import { enrichToolMessageWithPresentResult } from '@/lib/agent/parse-present-result'

/** tool 消息 enrich：批注提议 + 章级建议 + 呈现结果。 */
export function enrichAcpToolMessage(message: AcpChatMessage): AcpChatMessage {
  return enrichToolMessageWithPresentResult(
    enrichToolMessageWithChapterPlan(
      enrichToolMessageWithMarkProposal(message, isToolActiveStatus),
      isToolActiveStatus,
    ),
    isToolActiveStatus,
  )
}
