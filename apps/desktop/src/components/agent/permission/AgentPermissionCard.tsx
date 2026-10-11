import { ShieldAlert } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { acpApi } from '@/api/acp-api'
import {
  isAllowPermissionKind,
  isRejectPermissionKind,
  type AcpPermissionOptionView,
} from '@/lib/agent/acp-permission'
import { cn } from '@/lib/utils'
import type { AcpPendingPermission } from '@/stores/acp-ui-store'
import { useAcpUiStore } from '@/stores/acp-ui-store'

interface AgentPermissionCardProps {
  pending: AcpPendingPermission
  /** 嵌在工具卡内时更紧凑 */
  compact?: boolean
  className?: string
}

function optionVariant(kind: string): 'default' | 'outline' | 'destructive' {
  if (isAllowPermissionKind(kind)) return 'default'
  if (isRejectPermissionKind(kind)) return 'outline'
  return 'outline'
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
      className={cn(
        'rounded-xl border border-amber-500/35 bg-amber-500/10',
        compact ? 'mt-2 px-2 py-2' : 'px-3 py-2.5',
        className,
      )}
      data-testid="agent-permission-card"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-[11px] font-medium text-foreground/90">需要批准</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
              {pending.summary}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => (
              <Button
                key={option.optionId}
                type="button"
                size="sm"
                variant={optionVariant(option.kind)}
                className="h-7 px-2.5 text-[11px]"
                onClick={() => respond(option)}
              >
                {option.name}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
