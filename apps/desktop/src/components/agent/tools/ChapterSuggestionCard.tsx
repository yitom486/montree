import { useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { openChapterForMarkRecovery } from '@/lib/agent/mark-proposal-failure'

export interface ChapterSuggestionItem {
  flatIndex?: number
  chapterId?: string
  title: string
  reason?: string
  relevanceScore?: number
}

export interface SuggestChaptersPayload {
  chapters: ChapterSuggestionItem[]
  message?: string
}

interface ChapterSuggestionCardProps {
  payload: SuggestChaptersPayload
  onSelectChapter?: (item: ChapterSuggestionItem) => void
  className?: string
}

export function ChapterSuggestionCard({
  payload,
  onSelectChapter,
  className,
}: ChapterSuggestionCardProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const chapters = payload.chapters || []

  const handleSelect = (item: ChapterSuggestionItem, index: number) => {
    setSelectedIdx(index)
    if (onSelectChapter) {
      onSelectChapter(item)
    } else if (item.flatIndex != null) {
      void openChapterForMarkRecovery(item.flatIndex)
    }
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-teal-500/30 bg-teal-50/30 dark:bg-teal-950/20 shadow-sm backdrop-blur-sm transition-all',
        className,
      )}
      data-testid="chapter-suggestion-card"
    >
      {/* 头部摘要 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-500/20 bg-teal-500/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-teal-500/20 text-teal-700 dark:text-teal-300">
            <Compass className="size-3.5" />
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-xs font-semibold text-teal-800 dark:text-teal-200">
              智能导读与续读推荐
            </h4>
            <p className="truncate text-[10px] text-teal-700/80 dark:text-teal-300/80">
              共推荐 <span className="font-semibold">{chapters.length}</span> 处研读章节
            </p>
          </div>
        </div>

        <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[9.5px] font-mono font-medium text-teal-700 dark:text-teal-300">
          montree_suggest_chapters
        </span>
      </div>

      {/* 推荐章节清单 */}
      <div className="p-2.5 space-y-2 text-xs">
        {chapters.map((item, idx) => {
          const isSelected = selectedIdx === idx
          return (
            <div
              key={idx}
              className={cn(
                'rounded-xl border p-2.5 transition-all space-y-1.5',
                isSelected
                  ? 'border-teal-500/60 bg-teal-50/80 dark:bg-teal-900/40 shadow-xs'
                  : 'border-border/50 bg-card hover:border-teal-500/40 hover:bg-muted/20',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-serif font-semibold text-xs text-foreground truncate">
                      {item.title}
                    </span>
                    {item.relevanceScore != null ? (
                      <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono bg-teal-500/15 text-teal-700 dark:text-teal-300">
                        {item.relevanceScore}% 契合
                      </span>
                    ) : null}
                  </div>
                  {item.reason ? (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {item.reason}
                    </p>
                  ) : null}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-6 gap-1 px-2 text-[10.5px] shrink-0 border-teal-500/30 cursor-pointer',
                    isSelected
                      ? 'bg-teal-600 text-white hover:bg-teal-700 border-transparent'
                      : 'text-teal-700 dark:text-teal-300 hover:bg-teal-500/10',
                  )}
                  onClick={() => handleSelect(item, idx)}
                >
                  {isSelected ? (
                    <>
                      <Check className="size-3" />
                      <span>已前往</span>
                    </>
                  ) : (
                    <>
                      <span>研读该章</span>
                      <ArrowRight className="size-3" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
