import type { ChatMessage } from './chat-message'
import { isToolActiveStatus } from './chat-message'
import { enrichToolMessageWithChapterPlan } from './parse-chapter-mark-plan'
import { enrichToolMessageWithMarkProposal } from './parse-mark-proposal'
import { enrichToolMessageWithPresentResult } from './parse-present-result'

/** tool 消息 enrich：批注提议 + 章级建议 + 呈现结果。 */
export function enrichAcpToolMessage(message: ChatMessage): ChatMessage {
  return enrichToolMessageWithPresentResult(
    enrichToolMessageWithChapterPlan(
      enrichToolMessageWithMarkProposal(message, isToolActiveStatus),
      isToolActiveStatus,
    ),
    isToolActiveStatus,
  )
}
