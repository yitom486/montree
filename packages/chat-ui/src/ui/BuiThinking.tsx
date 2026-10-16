// 展示语法参考 slev12397/beautiful-ui ThinkingState（MIT © 2026 Shane Levine）：
// 完整许可见 ../LICENSE.beautiful-ui。
// 只取 header（sparkle+标题+chevron）、grid-rows 展开、时间线 rail、行图标与
// fade-up stagger 写法；无 useSequence 定时推进、无演示数据，动效改走本地 bui-*。
import { Check, ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { cn } from './cn'
import { BeuiThinkingShimmer } from './BeuiAgentProgress'

export interface BuiThinkingRow {
  primary: string
  secondary?: string
  mono?: boolean
}

export interface BuiThinkingProps {
  state: 'running' | 'done'
  titleActive: string
  titleDone: string
  elapsedSeconds?: number | null
  rows: BuiThinkingRow[]
  expanded: boolean
  onToggle: () => void
  /** 调用方维护的稳定标识（作 key 用），组件内仅透传为 data 属性 */
  partKey: string
  /**
   * 富正文槽：提供时在时间线容器内渲染该节点而非纯文本行
   *（如思考 markdown，调用方保留自有渲染管线与安全语义）。
   */
  body?: ReactNode
  className?: string
}

/** 纯展示 Thinking 头 + 时间线：状态与展开均由调用方受控，内部无定时、无数据。 */
export function BuiThinking({
  state,
  titleActive,
  titleDone,
  elapsedSeconds,
  rows,
  expanded,
  onToggle,
  partKey,
  body,
  className,
}: BuiThinkingProps) {
  const running = state === 'running'
  const contentId = useId()
  return (
    <div
      data-part-key={partKey}
      className={cn('bui-anim flex w-full min-w-0 flex-col', className)}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex min-h-[44px] w-fit max-w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Sparkles
          className={cn(
            'size-4 shrink-0',
            running ? 'text-muted-foreground' : 'text-muted-foreground/70',
          )}
        />
        <span role="status" className="contents">
          {running ? (
            <span className="text-[13px] font-medium whitespace-nowrap"><BeuiThinkingShimmer>{titleActive}</BeuiThinkingShimmer></span>
          ) : (
            <span
              className="min-w-0 break-words text-[13px] font-medium text-muted-foreground [overflow-wrap:anywhere]"
              style={{ animation: 'bui-fade-up 350ms ease-out both' }}
            >
              {titleDone}
            </span>
          )}
        </span>
        {elapsedSeconds != null ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">{elapsedSeconds}s</span> : null}
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-300"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      <div
        id={contentId}
        aria-hidden={!expanded}
        inert={!expanded}
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute top-1 bottom-1 left-[3px] w-px bg-border"
            />
            <div className="flex flex-col gap-1 py-1">
              {body ?? rows.map((row, i) => {
                const isLast = i === rows.length - 1
                const showSpinner = running && isLast
                return (
                  <div
                    key={`${partKey}-row-${i}`}
                    className="flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left"
                    style={{
                      animation: `bui-fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both`,
                    }}
                  >
                    {showSpinner ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
                    ) : (
                      <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
                      {row.primary}
                    </span>
                    {row.secondary ? (
                      <span
                        className={cn(
                          'shrink-0 truncate text-[11px] text-muted-foreground',
                          row.mono && 'font-mono',
                        )}
                      >
                        {row.secondary}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
