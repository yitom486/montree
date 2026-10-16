import { acpApi } from '@/api/acp-api'
import { useAcpUiStore, type AcpPendingPermission } from '@/stores/acp-ui-store'

/**
 * 审批响应宿主实现（原 `AgentPermissionCard.respond` 内联逻辑）：
 * 跨卡幂等领取（以 store 当前请求为准；已被处理、被替换或归属不一致直接拒绝）
 * + `clearPendingPermission` + `acpApi.respondPermission` 发送。
 * 包内 `AgentPermissionCard/ToolApprovalSlot` 经 `onRespond(optionId)` 回调到此处。
 */
export function respondPermissionRequest(
  pending: AcpPendingPermission,
  optionId: string | null,
): void {
  const current = useAcpUiStore.getState().pendingPermission
  if (!current || current.requestId !== pending.requestId) return
  if (
    current.sessionId != null &&
    pending.sessionId != null &&
    current.sessionId !== pending.sessionId
  ) {
    return
  }
  useAcpUiStore.getState().clearPendingPermission(pending.requestId)
  const option =
    optionId != null
      ? (pending.options.find((o) => o.optionId === optionId) ?? null)
      : null
  acpApi.respondPermission({
    requestId: pending.requestId,
    outcome: option
      ? { outcome: 'selected', optionId: option.optionId }
      : { outcome: 'cancelled' },
  })
}
