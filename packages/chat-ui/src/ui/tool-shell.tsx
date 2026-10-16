// 宿主 `apps/desktop/src/components/ai-elements/tool.tsx`（社区 AI Elements Tool 折叠组合与状态徽标）
// 逐字复刻（私有，不进 barrel；供包内工具卡与工作记录共用）。唯一改动：`cn` 改引包内 `./cn`。
// 上游来源与差异说明见宿主原文件头注释（Vercel AI Elements Apache-2.0，Montree 扩展 awaiting-approval/cancelled/unknown 三态）。
import * as React from 'react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import {
  Ban,
  Check,
  ChevronRight,
  CircleHelp,
  Clock,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { cn } from './cn'

export type AiToolState =
  | 'awaiting-approval'
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'unknown'

const STATE_META: Record<AiToolState, { label: string; className: string }> = {
  'awaiting-approval': {
    label: '等待批准',
    className:
      'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  pending: {
    label: '等待执行',
    className: 'border-border/60 bg-muted/60 text-muted-foreground',
  },
  running: {
    label: '执行中',
    className: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  },
  completed: {
    label: '已完成',
    className:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  error: {
    label: '失败',
    className: 'border-destructive/40 bg-destructive/10 text-destructive',
  },
  cancelled: {
    label: '已取消',
    className: 'border-border/60 bg-muted/60 text-muted-foreground',
  },
  unknown: {
    label: '状态未知',
    className: 'border-border/60 bg-muted/60 text-muted-foreground',
  },
}

export function ToolStateIcon({ state }: { state: AiToolState }) {
  const className = 'size-3.5 shrink-0'
  switch (state) {
    case 'awaiting-approval':
      return <ShieldAlert className={cn(className, 'text-amber-600 dark:text-amber-400')} />
    case 'pending':
      return <Clock className={cn(className, 'text-muted-foreground')} />
    case 'running':
      return <Loader2 className={cn(className, 'animate-spin motion-reduce:animate-none text-sky-600 dark:text-sky-400')} />
    case 'completed':
      return <Check className={cn(className, 'text-emerald-600 dark:text-emerald-400')} />
    case 'error':
      return <XCircle className={cn(className, 'text-destructive')} />
    case 'cancelled':
      return <Ban className={cn(className, 'text-muted-foreground')} />
    case 'unknown':
      return <CircleHelp className={cn(className, 'text-muted-foreground')} />
  }
}

export function getToolStateBadge(state: AiToolState) {
  const meta = STATE_META[state]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium',
        meta.className,
      )}
    >
      <ToolStateIcon state={state} />
      {meta.label}
    </span>
  )
}

export interface ToolProps extends React.ComponentProps<typeof CollapsiblePrimitive.Root> {
  children: React.ReactNode
}

/** 折叠根（对应上游 `Tool`）。受控 / 非受控展开由调用方显式传入。 */
export function Tool({ className, children, ...props }: ToolProps) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="ai-tool"
      className={cn('group min-w-0', className)}
      {...props}
    >
      {children}
    </CollapsiblePrimitive.Root>
  )
}

export interface ToolHeaderProps
  extends React.ComponentProps<typeof CollapsiblePrimitive.Trigger> {
  title: string
  /** 目标摘要（如文件名），仅有可靠元数据时传入 */
  target?: string | null
  state: AiToolState
  /** 失败摘要：折叠时仍可见 */
  summary?: string | null
  /** 工具种类图标（读取/写入/搜索等），渲染在状态图标之后 */
  kindIcon?: React.ReactNode
}

/** 标题行（对应上游 `ToolHeader`）。Radix Trigger 原生按钮，支持键盘与 aria-expanded。 */
export function ToolHeader({ title, target, state, summary, kindIcon, className, ...props }: ToolHeaderProps) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="ai-tool-header"
      className={cn(
        'flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left outline-none',
        'focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {kindIcon}
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
        {title}
        {target ? (
          <span className="ml-1.5 font-normal text-muted-foreground">{target}</span>
        ) : null}
        {summary ? (
          <span className="ml-1.5 font-normal text-destructive/90">· {summary}</span>
        ) : null}
      </span>
      {getToolStateBadge(state)}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
    </CollapsiblePrimitive.Trigger>
  )
}

export function ToolContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="ai-tool-content"
      className={cn('min-w-0 max-w-full overflow-x-hidden', className)}
      {...props}
    >
      <div className="min-w-0 max-w-full space-y-1.5 overflow-x-hidden border-t border-border/40 px-2.5 py-2">
        {children}
      </div>
    </CollapsiblePrimitive.Content>
  )
}

export function ToolInput({
  input,
  className,
  ...props
}: { input: unknown } & React.ComponentProps<'div'>) {
  if (input == null) return null
  const text = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  if (!text.trim()) return null
  return (
    <div className={cn('min-w-0', className)} {...props}>
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">输入参数</p>
      <pre className="max-h-40 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {text}
      </pre>
    </div>
  )
}

export function ToolOutput({
  output,
  errorText,
  className,
  ...props
}: {
  output?: React.ReactNode
  errorText?: string | null
} & React.ComponentProps<'div'>) {
  if (errorText) {
    return (
      <div className={cn('min-w-0', className)} {...props}>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{errorText}</p>
      </div>
    )
  }
  if (output == null) return null
  return (
    <div className={cn('min-w-0', className)} {...props}>
      {output}
    </div>
  )
}
