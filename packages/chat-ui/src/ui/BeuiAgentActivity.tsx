// BeUI Agent Activity adapter; MIT © 2026 Saurabh Chauhan, see ../LICENSE.beui.
import { useId, type ReactNode } from 'react'
import { Ban, Check, ChevronDown, CircleHelp, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { cn } from './cn'

export type BeuiActivityStatus = 'working' | 'complete' | 'failed' | 'cancelled' | 'unknown' | 'approval'

function ActivityIcon({ status }: { status: BeuiActivityStatus }) {
  const className = 'size-3.5 shrink-0'
  if (status === 'working') return <Loader2 aria-hidden className={cn(className, 'animate-spin text-primary motion-reduce:animate-none')} />
  if (status === 'failed') return <XCircle aria-hidden className={cn(className, 'text-destructive')} />
  if (status === 'approval') return <ShieldAlert aria-hidden className={cn(className, 'text-amber-500')} />
  if (status === 'cancelled') return <Ban aria-hidden className={cn(className, 'text-muted-foreground')} />
  if (status === 'unknown') return <CircleHelp aria-hidden className={cn(className, 'text-muted-foreground')} />
  return <Check aria-hidden className={cn(className, 'text-emerald-600 dark:text-emerald-400')} />
}

/** 宿主负责聚合与展开状态；只提供过程表面，失败/取消/未知不映射为完成。 */
export function BeuiAgentActivity({ status, heading, description, open, onToggle, children }: {
  status: BeuiActivityStatus
  heading: string
  description?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const contentId = useId()
  return (
    <div data-slot="agent-activity" data-state={status} className="bui-anim min-w-0">
      <button type="button" aria-expanded={open} aria-controls={contentId} onClick={onToggle} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-1 focus-visible:ring-ring">
        <ActivityIcon status={status} />
        <span className="min-w-0 flex-1 text-xs leading-relaxed">
          <span title={heading} className="block truncate font-medium text-foreground/85">{heading}</span>
          {description ? <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">{description}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', !open && '-rotate-90')} />
      </button>
      {open ? <div id={contentId} className="min-w-0">{children}</div> : null}
    </div>
  )
}

export function BeuiActivityRow({ label, target, stateLabel, icon, meta, open, onToggle, failure, children }: {
  label: string
  target?: string | null
  stateLabel: string
  icon: ReactNode
  meta?: string
  open: boolean
  onToggle: () => void
  failure?: string | null
  children: ReactNode
}) {
  const contentId = useId()
  return (
    <div data-slot="agent-activity-row" className="relative ml-2 min-w-0 border-l border-border/60 pl-3">
      <button type="button" aria-expanded={open} aria-controls={contentId} onClick={onToggle} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-foreground/90">{label}</span>
          <span title={target ?? undefined} className="mt-0.5 block min-h-3.5 truncate font-mono text-[10px] text-muted-foreground">{target || '\u00a0'}</span>
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{stateLabel}{meta ? ` · ${meta}` : ''}</span>
        <ChevronDown aria-hidden className={cn('size-3 shrink-0 transition-transform motion-reduce:transition-none', !open && '-rotate-90')} />
      </button>
      {!open && failure ? <p className="px-1.5 pb-1 text-[11px] text-destructive">{failure}</p> : null}
      {open ? <div id={contentId} className="min-w-0 pb-1">{children}</div> : null}
    </div>
  )
}
