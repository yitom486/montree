import { useRef, useState } from 'react'
import { acpApi } from '@/api/acp-api'
import {
  type AcpPermissionOptionView,
} from '@/lib/agent/acp-permission'
import { BuiApprovalCard } from '@/components/agent/permission/BuiApprovalCard'
import { cn } from '@/lib/utils'
import type { AcpPendingPermission } from '@/stores/acp-ui-store'
import { useAcpUiStore } from '@/stores/acp-ui-store'

interface AgentPermissionCardProps {
  pending: AcpPendingPermission
  /** 嵌在工具卡内时更紧凑 */
  compact?: boolean
  className?: string
}

function optionById(options: AcpPermissionOptionView[], optionId: string): AcpPermissionOptionView | null {
  return options.find((o) => o.optionId === optionId) ?? null
}

/** Cursor 风格：审批操作嵌在对话流/工具卡内，而不是单独靠全局 Dialog */
export function AgentPermissionCard({
  pending,
  compact = false,
  className,
}: AgentPermissionCardProps) {
  const clearPendingPermission = useAcpUiStore((s) => s.clearPendingPermission)
  // 同卡防重：同一次挂载只允许抢占一次（React 状态异步到达前连点也只认第一次）
  const claimedRef = useRef(false)
  // 本卡视觉态：选中与发送中（跨卡幂等仍由 store 领取保证，此处只挡重复点击）
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const respond = (option: AcpPermissionOptionView | null) => {
    if (claimedRef.current) return
    claimedRef.current = true
    // 跨卡共享幂等：以 store 当前请求为准领取；已被处理、被替换或归属不一致直接拒绝。
    // 双面板镜像同一 store，先抢到者发送，后到者（旧 props/重复点击）不再发送。
    const current = useAcpUiStore.getState().pendingPermission
    if (!current || current.requestId !== pending.requestId) return
    if (
      current.sessionId != null &&
      pending.sessionId != null &&
      current.sessionId !== pending.sessionId
    ) {
      return
    }
    if (option) {
      setSelectedId(option.optionId)
      setBusyId(option.optionId)
    }
    clearPendingPermission(pending.requestId)
    acpApi.respondPermission({
      requestId: pending.requestId,
      outcome: option
        ? { outcome: 'selected', optionId: option.optionId }
        : { outcome: 'cancelled' },
    })
  }

  const options =
    pending.options.length > 0
      ? pending.options
      : ([
          { optionId: 'allow-once', name: '允许', kind: 'allow_once' },
          { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
        ] satisfies AcpPermissionOptionView[])

  return (
    <div
      data-testid="agent-permission-card"
      className={cn(compact && 'max-w-72', className)}
    >
      <BuiApprovalCard
        title={pending.summary || '需要批准'}
        options={options.map((o) => ({ id: o.optionId, label: o.name, kind: o.kind }))}
        selectedId={selectedId}
        busyId={busyId}
        busy={busyId != null}
        requestKey={String(pending.requestId)}
        onSelect={(id) => respond(optionById(options, id))}
        onCancel={() => respond(null)}
      />
    </div>
  )
}
