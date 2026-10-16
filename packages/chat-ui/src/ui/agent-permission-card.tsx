import { useRef, useState } from 'react'
import { BuiApprovalCard } from './BuiApprovalCard'
import { cn } from './cn'

/**
 * 审批选项视图（与宿主 `AcpPermissionOptionView` 同形，包内重声明以断 `@/` 依赖）。
 */
export interface AgentApprovalOption {
  optionId: string
  name: string
  kind: string
}

/**
 * 待审批请求的最小渲染结构（宿主 `AcpPendingPermission` 天然可赋值，反向解耦）。
 */
export interface AgentApprovalPending {
  requestId: number
  sessionId?: string
  toolCallId?: string
  summary: string
  options: AgentApprovalOption[]
}

export interface AgentPermissionCardProps {
  pending: AgentApprovalPending
  /**
   * 审批响应回调（必填）：宿主实现跨卡幂等领取 + `clearPendingPermission` + `acpApi.respondPermission`。
   * `string` 为选中的 `optionId`，`null` 为取消。
   */
  onRespond: (optionId: string | null) => void
  /** 嵌在工具卡内时更紧凑 */
  compact?: boolean
  className?: string
}

function optionById(options: AgentApprovalOption[], optionId: string): AgentApprovalOption | null {
  return options.find((o) => o.optionId === optionId) ?? null
}

/** Cursor 风格：审批操作嵌在对话流/工具卡内，而不是单独靠全局 Dialog */
export function AgentPermissionCard({
  pending,
  onRespond,
  compact = false,
  className,
}: AgentPermissionCardProps) {
  // 同卡防重：同一次挂载只允许触发一次（React 状态异步到达前连点也只认第一次）。
  // 跨卡幂等（双面板镜像/旧请求）由宿主 onRespond 实现保证，此处只挡重复点击。
  const claimedRef = useRef(false)
  // 本卡视觉态：选中与发送中
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const respond = (option: AgentApprovalOption | null) => {
    if (claimedRef.current) return
    claimedRef.current = true
    if (option) {
      setSelectedId(option.optionId)
      setBusyId(option.optionId)
    }
    onRespond(option ? option.optionId : null)
  }

  const options =
    pending.options.length > 0
      ? pending.options
      : ([
          { optionId: 'allow-once', name: '允许', kind: 'allow_once' },
          { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
        ] satisfies AgentApprovalOption[])

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
