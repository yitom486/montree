import { useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  Flame,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RESULT_CARD_HEADER, RESULT_CARD_ICON, RESULT_CARD_SUMMARY, resultCardClassName } from '@yitom/chat-ui'
import { cn } from '@/lib/utils'

export interface CrossReferenceChapter {
  chapter: string
  flatIndex?: number
  occurrences: number
  excerpt: string
  excerpts?: string[]
}

export interface CrossReferencePayload {
  entity: string
  totalOccurrences: number
  chapterDistribution: CrossReferenceChapter[]
}

interface CrossReferenceCardProps {
  payload: CrossReferencePayload
  onNavigateChapter?: (flatIndex?: number, excerpt?: string) => void
  className?: string
}

export function CrossReferenceCard({
  payload,
  onNavigateChapter,
  className,
}: CrossReferenceCardProps) {
  const [expandedIndices, setExpandedIndices] = useState<number[]>([0]) // 默认展开第一项
  const total = payload.totalOccurrences || 1

  const toggleExpand = (index: number) => {
    setExpandedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    )
  }

  return (
    <div
      className={resultCardClassName(className)}
      data-testid="cross-reference-card"
    >
      {/* 头部摘要 */}
      <div className={cn('flex flex-wrap items-center justify-between gap-2', RESULT_CARD_HEADER)}>
        <div className="flex min-w-0 items-center gap-2">
          <div className={RESULT_CARD_ICON}>
            <Compass className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-xs font-semibold text-foreground">
                全书脉络考证
              </h4>
              <span className="ink-seal-text shrink-0 rounded border border-red-700/30 bg-red-500/10 px-1.5 py-0.2 text-[10px] font-medium text-red-700 dark:text-red-400">
                "{payload.entity}"
              </span>
            </div>
            <p className={RESULT_CARD_SUMMARY}>
              共考得 <span className="font-semibold text-foreground">{payload.totalOccurrences}</span> 处引证 · 见于 <span className="font-semibold text-foreground">{payload.chapterDistribution.length}</span> 章节
            </p>
          </div>
        </div>
      </div>

      {/* 章节出现频次水墨热力比例条（墨分五色 + 朱砂印） */}
      <div className="border-b border-border/40 bg-background/60 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>章节浸润权重</span>
          <span>朱砂首现 ➔ 焦浓淡清</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/50 p-0.5 border border-border/50">
          {payload.chapterDistribution.map((item, idx) => {
            const percentage = Math.max(8, Math.round((item.occurrences / total) * 100))
            // 首位重点为朱砂印红，后续为水墨灰阶
            const inkColors = [
              'bg-red-700 dark:bg-red-600', // 朱砂重点
              'bg-foreground/80',          // 焦墨
              'bg-foreground/60',          // 浓墨
              'bg-foreground/45',          // 重墨
              'bg-foreground/30',          // 淡墨
              'bg-foreground/20',          // 清墨
            ]
            const color = inkColors[Math.min(idx, inkColors.length - 1)]
            return (
              <div
                key={idx}
                className={cn('h-full transition-all rounded-xs', color)}
                style={{ width: `${percentage}%` }}
                title={`${item.chapter}: ${item.occurrences} 次 (${percentage}%)`}
              />
            )
          })}
        </div>
      </div>

      {/* 章节证据折叠列表 */}
      <div className="divide-y divide-border/50 p-1">
        {payload.chapterDistribution.map((item, idx) => {
          const isExpanded = expandedIndices.includes(idx)
          const excerpts = item.excerpts?.length ? item.excerpts : item.excerpt ? [item.excerpt] : []

          return (
            <div key={idx} className="rounded-lg transition-colors hover:bg-muted/30">
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left"
                onClick={() => toggleExpand(idx)}
              >
                {isExpanded ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                  {item.chapter}
                </span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.2 font-mono text-[9px] text-muted-foreground">
                  {item.occurrences} 次
                </span>
              </button>

              {isExpanded ? (
                <div className="space-y-1.5 px-3 pb-2 pt-0.5">
                  {excerpts.map((snippet, sIdx) => (
                    <div
                      key={sIdx}
                      className="group flex items-start justify-between gap-2 rounded-md border border-border/60 bg-muted/20 p-1.5 text-[10px]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-3 leading-relaxed text-foreground/85 italic">
                          "...{snippet}..."
                        </p>
                      </div>
                      {onNavigateChapter ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 shrink-0 gap-1 px-1.5 text-[9px] text-muted-foreground group-hover:text-primary"
                          onClick={() => onNavigateChapter(item.flatIndex, snippet)}
                          title="跳转至该章节"
                        >
                          <span>跳转</span>
                          <ArrowRight className="size-2.5" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* 底部提示 */}
      <div className="flex items-center justify-between border-t border-border/70 bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Search className="size-3 text-muted-foreground" />
          <span>点击章节可展开对应上下文证据引文</span>
        </span>
      </div>
    </div>
  )
}
