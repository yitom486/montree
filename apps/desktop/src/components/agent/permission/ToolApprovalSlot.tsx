import { toolMessageNeedsApproval } from '@/lib/agent/acp-permission-ui'
import { AgentPermissionCard } from '@/components/agent/permission/AgentPermissionCard'
import { useAcpPendingPermission } from '@/stores/acp-ui-store'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

/**
 * 工具审批槽（R2 收尾 P1）：命中当前 pending 的工具消息才渲染审批卡。
 * 所有工具渲染路径（通用工具卡、批注提议分支）统一经此挂载，且调用方
 * 必须把它放在折叠容器外；时间线兜底只在该槽无处渲染时才浮出。
 */
export function ToolApprovalSlot({
  message,
}: {
  message: Pick<AcpChatMessage, 'role' | 'toolCallId'>
}) {
  const pendingPermission = useAcpPendingPermission()
  if (!pendingPermission) return null
  if (!toolMessageNeedsApproval(message, pendingPermission)) return null
  return <AgentPermissionCard pending={pendingPermission} compact />
}
