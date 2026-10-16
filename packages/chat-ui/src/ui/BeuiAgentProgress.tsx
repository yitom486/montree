// BeUI AgentProgress/ThinkingShimmer adapter; MIT © 2026 Saurabh Chauhan, see ../LICENSE.beui.
import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'

export function BeuiThinkingShimmer({ children }: { children: ReactNode }) {
  return <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(110deg,var(--muted-foreground) 30%,var(--foreground) 50%,var(--muted-foreground) 70%)', backgroundSize: '200% 100%', animation: 'bui-shimmer-text 1.8s linear infinite' }}>{children}</span>
}

/** 使用宿主真实计时，不启动上游独立计时器或轮播虚构活动。 */
export function BeuiAgentProgress({ label, elapsedSeconds, running = true, usageText }: {
  label: string
  elapsedSeconds: number | null
  running?: boolean
  /** 线程用量后缀（如“已用 8.3k tokens”），缺省不渲染 */
  usageText?: string
}) {
  const seconds = elapsedSeconds != null && Number.isFinite(elapsedSeconds) ? Math.max(0, Math.floor(elapsedSeconds)) : null
  const elapsed = seconds == null ? null : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return (
    <div data-slot="agent-progress" data-testid="agent-loading-state" className="bui-anim flex min-h-9 items-center gap-2.5 px-1 py-1 text-xs text-muted-foreground">
      {running ? (
        <span aria-hidden className="agent-pixel-loader grid size-4 shrink-0 grid-cols-3 gap-0.5">
          {Array.from({ length: 9 }, (_, index) => <span key={index} className="rounded-[1px] bg-current" style={{ animationDelay: `${index * 140}ms` }} />)}
        </span>
      ) : <ShieldAlert aria-hidden className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />}
      <span role="status" className="min-w-0 break-words">{running ? <BeuiThinkingShimmer>{label}</BeuiThinkingShimmer> : label}</span>
      {usageText ? <span className="shrink-0 text-[11px] opacity-60">{usageText}</span> : null}
      {elapsed != null ? <span aria-label={`已等待 ${seconds} 秒`} className="shrink-0 font-mono text-[11px] tabular-nums opacity-70">{elapsed}</span> : null}
    </div>
  )
}
