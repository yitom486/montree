// Beautiful UI ApprovalCard 视觉参考，本地适配；MIT © 2026 Shane Levine，见 ../LICENSE.beautiful-ui。
import { Check, Loader2, ShieldAlert } from 'lucide-react'
// 自 `apps/desktop/src/components/agent/permission/BuiApprovalCard.tsx` 整搬（M3b 纯展示批）：
// `Button` 改引包内 `./button`（宿主 `components/ui/button` 逐字复刻）；`cn` 改 `./cn`。
import { Button } from './button'
import { cn } from './cn'

export interface BuiApprovalOption {
  id: string
  label: string
  kind?: string
}

interface BuiApprovalCardProps {
  title: string
  options: Array<BuiApprovalOption>
  selectedId?: string | null
  busyId?: string | null
  busy?: boolean
  requestKey: string
  onSelect: (id: string) => void
  onCancel: () => void
}

function isAllowKind(kind?: string): boolean {
  return (kind ?? '').toLowerCase().includes('allow')
}

export function BuiApprovalCard({
  title,
  options,
  selectedId,
  busyId,
  busy = false,
  requestKey,
  onSelect,
  onCancel,
}: BuiApprovalCardProps) {
  // 跨渲染幂等由调用方既有领取逻辑保证；此处仅用禁用态挡住处理中的重复点击。
  const locked = busy || busyId != null
  return (
    <div
      role="group"
      aria-label={title}
      aria-busy={locked}
      data-testid="bui-approval-card"
      data-request-key={requestKey}
      className="bui-anim w-full rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5"
      style={{ animation: 'bui-pop-in 260ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] font-medium text-foreground [overflow-wrap:anywhere]">{title}</p>
            {/* 上游多步滚动计数器在此简化为静态：单 pending 请求无翻页语义 */}
            <span aria-label="单个审批请求" className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              1/1
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {options.map((option) => {
              const selected = selectedId === option.id
              const running = busyId === option.id
              return (
                <Button
                  key={option.id}
                  type="button"
                  size="sm"
                  variant={isAllowKind(option.kind) ? 'default' : 'outline'}
                  aria-pressed={selected}
                  aria-label={option.label}
                  disabled={locked}
                  onClick={() => onSelect(option.id)}
                  className={cn('h-auto min-h-9 w-full justify-start gap-2 whitespace-normal px-2.5 py-2 text-[13px]', selected && 'font-semibold')}
                >
                  {running ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : selected ? (
                    <Check className="size-3.5 shrink-0" aria-hidden />
                  ) : null}
                  <span className="min-w-0 flex-1 break-words text-left [overflow-wrap:anywhere]">{option.label}</span>
                </Button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-end">
            <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={onCancel}>
              取消
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
