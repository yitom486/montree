import { toolMessageNeedsApproval } from '@montree/chat-core'
import type { ChatMessage } from '@montree/chat-core'
import { AgentPermissionCard, type AgentApprovalPending } from './agent-permission-card'

export interface ToolApprovalSlotProps {
  message: Pick<ChatMessage, 'role' | 'toolCallId'>
  /** 当前待审批（宿主 store 值直传；`null` 即无待审批，不渲染） */
  pending: AgentApprovalPending | null
  /** 透传给内层审批卡（宿主实现发送，见 `AgentPermissionCardProps.onRespond`） */
  onRespond: (optionId: string | null) => void
}

/**
 * 工具审批槽：命中当前 pending 的工具消息才渲染审批卡。
 * 所有工具渲染路径（通用工具卡、批注提议分支）统一经此挂载，且调用方
 * 必须把它放在折叠容器外；时间线兜底只在该槽无处渲染时才浮出。
 */
export function ToolApprovalSlot({
  message,
  pending,
  onRespond,
}: ToolApprovalSlotProps) {
  if (!pending) return null
  if (!toolMessageNeedsApproval(message, pending)) return null
  return <AgentPermissionCard pending={pending} compact onRespond={onRespond} />
}
