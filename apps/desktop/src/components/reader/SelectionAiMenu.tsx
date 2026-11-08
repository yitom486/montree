import { useState } from 'react'
import { BotMessageSquare, Check, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CARD_STUDIO_PRESETS,
  type CardStudioPresetId,
} from '@/lib/agent/card-studio-presets'
import {
  DEEP_ANSWER_DIRECTIONS,
  type DeepAnswerDirectionId,
} from '@/lib/agent/deep-answer'

/**
 * 划选工具条的单一 AI 入口：制卡、快速问答与去 Agent 面板。
 * 三组动作共用一书一会话；菜单内分组，避免顶层再堆三个按钮。
 */
export function SelectionAiMenu({
  onPickCard,
  onPickDirection,
  onOpenComposer,
  cardPending = false,
  answerPending = false,
  className,
}: {
  onPickCard?: (presetId: CardStudioPresetId, customText?: string) => void
  onPickDirection?: (directionId: DeepAnswerDirectionId) => void
  onOpenComposer?: () => void
  cardPending?: boolean
  answerPending?: boolean
  className?: string
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const pending = cardPending || answerPending
  const itemClass =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50 cursor-pointer'
  const sectionClass =
    'px-2.5 pb-1 pt-1.5 text-[10px] font-medium tracking-wide text-muted-foreground'

  return (
    <div
      role="menu"
      aria-label="AI 选区操作"
      data-selection-toolbar-menu
      className={cn(
        'max-h-[min(70vh,420px)] w-[224px] overflow-y-auto rounded-xl border border-border/80 bg-card/95 p-1 text-card-foreground shadow-2xl backdrop-blur-xl',
        className,
      )}
    >
      {onPickCard ? (
        <>
          <p className={sectionClass}>生成卡片</p>
          {CARD_STUDIO_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => onPickCard(preset.id)}
              className={itemClass}
            >
              {pending ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <Sparkles className="size-3.5 shrink-0 text-primary" />
              )}
              <span className="font-medium">{preset.label}</span>
            </button>
          ))}
          <div className="mx-1 my-1 h-px bg-border/60" />
          {!customOpen ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setCustomOpen(true)}
              className={cn(itemClass, 'text-muted-foreground')}
            >
              <span className="flex size-3.5 items-center justify-center font-bold">…</span>
              <span>更多要求</span>
            </button>
          ) : (
            <div
              className="space-y-1.5 p-1"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <input
                type="text"
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !pending) onPickCard('distill', customText)
                }}
                placeholder="补充一句要求（冲突以它为准）"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => onPickCard('distill', customText)}
                className="flex w-full items-center justify-center gap-1 rounded-md bg-primary/10 px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50 cursor-pointer"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                <span>{pending ? '生成中…' : '通用提炼并生成'}</span>
              </button>
            </div>
          )}
        </>
      ) : null}

      {onPickDirection ? (
        <>
          <div className="mx-1 my-1 h-px bg-border/60" />
          <p className={sectionClass}>快速问答</p>
          {DEEP_ANSWER_DIRECTIONS.map((direction) => (
            <button
              key={direction.id}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => onPickDirection(direction.id)}
              className={itemClass}
            >
              {pending ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <Sparkles className="size-3.5 shrink-0 text-primary" />
              )}
              <span className="font-medium">{direction.label}</span>
            </button>
          ))}
        </>
      ) : null}

      {onOpenComposer ? (
        <>
          <div className="mx-1 my-1 h-px bg-border/60" />
          <button
            type="button"
            role="menuitem"
            onClick={onOpenComposer}
            className={cn(itemClass, 'text-muted-foreground')}
          >
            <BotMessageSquare className="size-3.5 shrink-0" />
            <span>去 Agent 面板细问</span>
          </button>
        </>
      ) : null}
    </div>
  )
}
