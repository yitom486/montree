import { BrainCircuit, Loader2, Sparkles, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type TocWorkStage = 'slices' | 'session' | 'reasoning' | 'assembly' | 'success'

export interface TocAiLiveDashboardProps {
  stage: TocWorkStage
  elapsedSeconds: number
  statusText: string
  currentTool?: string
  toolStatus?: 'in_progress' | 'completed' | 'failed'
  latestThought?: string
  stepCount?: number
  onCancel: () => void
}

const STAGES: Array<{ key: TocWorkStage; label: string; icon: string }> = [
  { key: 'slices', label: '切片', icon: '📄' },
  { key: 'session', label: 'Agent', icon: '🤖' },
  { key: 'reasoning', label: '推理', icon: '🧠' },
  { key: 'assembly', label: '组装', icon: '📐' },
]

function stageIndex(stage: TocWorkStage): number {
  switch (stage) {
    case 'slices':
      return 0
    case 'session':
      return 1
    case 'reasoning':
      return 2
    case 'assembly':
      return 3
    case 'success':
      return 4
    default:
      return 0
  }
}

function computeProgressPercent(
  stage: TocWorkStage,
  hasTool: boolean,
  hasThought: boolean,
): number {
  switch (stage) {
    case 'slices':
      return 20
    case 'session':
      return 42
    case 'reasoning':
      if (hasTool) return 82
      if (hasThought) return 66
      return 52
    case 'assembly':
      return 94
    case 'success':
      return 100
    default:
      return 15
  }
}

function formatElapsedTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * 目录 AI 整理内嵌式实时动态看板（Live TOC Activity Console）。
 * 呈现 4 阶段微进度节点、光泽脉冲进度条、大模型流式思考/工具调用终端卡片与秒级计时器。
 */
export function TocAiLiveDashboard({
  stage,
  elapsedSeconds,
  statusText,
  currentTool,
  toolStatus,
  latestThought,
  stepCount,
  onCancel,
}: TocAiLiveDashboardProps) {
  const currentIdx = stageIndex(stage)
  const percent = computeProgressPercent(stage, Boolean(currentTool), Boolean(latestThought))

  return (
    <div className="space-y-2.5 rounded-lg border border-primary/30 bg-muted/40 p-2.5 shadow-sm backdrop-blur-xs">
      {/* 头部：脉冲指示灯 + 标题 + 耗时与步骤 */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <Loader2 className="size-3 animate-spin text-primary" />
          <span className="font-semibold text-foreground/95">目录流式整理中</span>
        </div>
        <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <span className="rounded border border-border/50 bg-background/60 px-1.5 py-0.2">
            {formatElapsedTime(elapsedSeconds)}
          </span>
          {stepCount ? (
            <span className="rounded bg-secondary px-1.5 py-0.2 font-sans text-[10px] text-secondary-foreground">
              Step {stepCount}
            </span>
          ) : null}
        </div>
      </div>

      {/* 阶段化步进标签 (Stage Pills) */}
      <div className="grid grid-cols-4 gap-1">
        {STAGES.map((s, idx) => {
          const isDone = currentIdx > idx
          const isCurrent = currentIdx === idx
          return (
            <div
              key={s.key}
              className={cn(
                'flex items-center justify-center gap-1 rounded py-0.5 text-[10px] transition-all',
                isCurrent &&
                  'border border-primary/40 bg-primary/10 font-medium text-primary shadow-2xs',
                isDone && 'bg-secondary/60 text-muted-foreground line-through opacity-70',
                !isDone && !isCurrent && 'bg-muted/40 text-muted-foreground/60',
              )}
            >
              <span>{s.icon}</span>
              <span className="truncate">{s.label}</span>
            </div>
          )
        })}
      </div>

      {/* 阶段化光泽渐变进度条 */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/80">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-primary to-emerald-500 shadow-xs transition-all duration-700 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* 实时活动终端卡片 (Live Activity Console) */}
      <div className="space-y-1.5 rounded-md border border-border/60 bg-background/90 p-2 text-[11px]">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          {currentTool ? (
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.2 font-mono text-[10px] text-amber-600 dark:text-amber-400">
              <Wrench className="size-2.5" />
              {currentTool}
              {toolStatus === 'completed' ? ' · 完成' : ''}
            </span>
          ) : latestThought ? (
            <span className="inline-flex items-center gap-1 rounded border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.2 font-mono text-[10px] text-blue-600 dark:text-blue-400">
              <BrainCircuit className="size-2.5" />
              思考中
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.2 font-mono text-[10px] text-primary">
              <Sparkles className="size-2.5" />
              进行中
            </span>
          )}
          <span className="truncate text-foreground/90">{statusText}</span>
        </div>

        {/* 思考过程流式摘录 */}
        {latestThought ? (
          <div className="rounded border border-border/40 bg-muted/30 p-1.5">
            <p className="line-clamp-3 text-[10px] font-sans italic text-muted-foreground break-all">
              “{latestThought}”
            </p>
          </div>
        ) : null}
      </div>

      {/* 底部操作区 */}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[10px] text-muted-foreground/80">点击取消可立即终止后台会话</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onCancel}
        >
          <X className="mr-1 size-3" />
          取消整理
        </Button>
      </div>
    </div>
  )
}
