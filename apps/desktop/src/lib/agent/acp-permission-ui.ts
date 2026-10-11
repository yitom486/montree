import type { AcpChatMessage } from '@/stores/acp-chat-types'
import type { AcpPendingPermission } from '@/stores/acp-ui-store'
import type { ChatTimelineItem } from '@/lib/agent/chat-timeline'

/** 工具卡是否应展示内联审批按钮 */
export function toolMessageNeedsApproval(
  message: Pick<AcpChatMessage, 'role' | 'toolCallId'>,
  pending: AcpPendingPermission | null,
): boolean {
  if (!pending?.toolCallId) return false
  if (message.role !== 'tool') return false
  return Boolean(message.toolCallId) && message.toolCallId === pending.toolCallId
}

/**
 * 权限请求尚未对应到时间线工具卡时，在对话流底部单独浮出审批卡。
 */
export function shouldShowOrphanPermissionCard(
  pending: AcpPendingPermission | null,
  messages: Array<Pick<AcpChatMessage, 'role' | 'toolCallId'>>,
): boolean {
  if (!pending) return false
  if (!pending.toolCallId) return true
  return !messages.some(
    (m) => m.role === 'tool' && m.toolCallId === pending.toolCallId,
  )
}

/**
 * 时间线分组中是否有会渲染审批槽的工具条目。
 * 以实际渲染结果为准：被分组跳过（promote 隐藏/去重）的消息即使仍在
 * 数组里也不算，避免“工具存在即隐藏兜底”导致审批彻底消失。
 * 调用方必须传入可见窗口的分组结果（含 pendingToolCallId 提升）。
 */
export function timelineRendersInlineApproval(
  items: ChatTimelineItem[],
  toolCallId: string | null | undefined,
): boolean {
  if (!toolCallId) return false
  return items.some((item) =>
    item.kind === 'work-log'
      ? item.messages.some((m) => m.role === 'tool' && m.toolCallId === toolCallId)
      : item.message.role === 'tool' && item.message.toolCallId === toolCallId,
  )
}
