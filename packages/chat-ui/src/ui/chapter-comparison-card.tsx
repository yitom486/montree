// 自 `apps/desktop/src/components/agent/tools/ChapterComparisonCard.tsx` 整搬（M3d present 批，pure）：
// `Button` 改包内 `./button`，`result-card` 改 `./result-card`，`cn` 改 `./cn`，
// `BeuiCitations` 改同包相对 `./BeuiCitations`；余逐字。
import { useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Columns2, FileText } from 'lucide-react'
import { Button } from './button'
import { RESULT_CARD_HEADER, RESULT_CARD_ICON, RESULT_CARD_SUMMARY, resultCardClassName } from './result-card'
import { cn } from './cn'
import type { PresentChapterComparison } from '@montree/contracts'
import { BeuiCitations } from './BeuiCitations'

interface ChapterComparisonCardProps {
  result: PresentChapterComparison
  onLocateChapter?: (flatIndex: number, excerpt?: string) => void
  className?: string
}

/**
 * 章节比较卡（S2）：章节筛选、证据展开/收起、原文定位。
 * 局部筛选/展开态为组件本地 state；父级必须按 `result.id` 给 key，
 * 同结果的新 chunk 只更新 props 不重置操作，新结果换 id 重建。
 * 纵向为主布局（320px 可读），480px 以上允许双列。
 */
export function ChapterComparisonCard({ result, onLocateChapter, className }: ChapterComparisonCardProps) {
  const [selected, setSelected] = useState<string[]>(() => result.chapters.map((c) => c.key))
  const [expanded, setExpanded] = useState<string[]>([])

  const toggleChapter = (key: string) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }
  const toggleEvidence = (id: string) => {
    setExpanded((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  const visibleItems = result.items.filter((item) => selected.includes(item.chapterKey))
  const chapterLabel = (key: string) => result.chapters.find((c) => c.key === key)?.label ?? key

  return (
    <div
      className={cn(
        '@container',
        resultCardClassName(className),
      )}
      data-testid="chapter-comparison-card"
      data-present-id={result.id}
    >
      <div className={RESULT_CARD_HEADER}>
        <div className="flex min-w-0 items-center gap-2">
          <div className={RESULT_CARD_ICON}>
            <Columns2 className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-xs font-semibold tracking-tight text-foreground">
              {result.title}
            </h4>
            <p className={RESULT_CARD_SUMMARY}>
              {result.chapters.length} 章 · {result.items.length} 条
              {result.summary ? ` · ${result.summary}` : ''}
            </p>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="章节筛选">
          {result.chapters.map((chapter) => {
            const active = selected.includes(chapter.key)
            return (
              <button
                key={chapter.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleChapter(chapter.key)}
                title={chapter.label}
                className={cn(
                  'max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
                  active
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {chapter.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5 p-2 @min-[480px]:columns-2 @min-[480px]:gap-2 @min-[480px]:space-y-0 @min-[480px]:[&>*]:mb-2 @min-[480px]:[&>*]:break-inside-avoid" data-testid="comparison-items">
        {visibleItems.length === 0 ? (
          <p className="rounded-md bg-muted/30 px-2 py-3 text-center text-[11px] text-muted-foreground">
            {result.items.length === 0 ? '暂无比较条目' : '未选中任何章节，请点选上方章节'}
          </p>
        ) : null}
        {visibleItems.map((item) => {
          const open = expanded.includes(item.id)
          const locatable = item.verified && typeof item.flatIndex === 'number'
          return (
            <div
              key={item.id}
              className="rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5"
              data-testid="comparison-item"
              data-item-id={item.id}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <FileText className="size-3 shrink-0 text-muted-foreground" />
                <span
                  className="max-w-[12rem] shrink-0 truncate rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary"
                  title={item.dimension}
                >
                  {item.dimension}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {chapterLabel(item.chapterKey)}
                </span>
                {!locatable ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70" title="摘录未在原文验证通过，不提供定位">
                    无定位
                  </span>
                ) : null}
              </div>
              {item.note ? (
                <p className="mt-1 break-words text-[11px] leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
                  {item.note}
                </p>
              ) : null}
              {item.excerpt ? (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleEvidence(item.id)}
                  className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
                >
                  {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  {open ? '收起证据' : '查看证据'}
                </button>
              ) : null}
              {open && item.excerpt ? (
                <p className="mt-1 rounded-md bg-background/70 p-1.5 text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {item.excerpt}
                </p>
              ) : null}
              {locatable ? (
                <div className="mt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[10px] text-primary"
                    onClick={() => onLocateChapter?.(item.flatIndex!, item.excerpt)}
                  >
                    定位原文
                    <ArrowRight className="size-2.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <BeuiCitations citations={visibleItems.filter(item => item.verified && item.excerpt?.trim()).map(item => ({
        id: `${result.id}:${item.id}`, title: chapterLabel(item.chapterKey), detail: result.documentLabel,
        excerpt: item.excerpt,
        onSelect: item.flatIndex != null && onLocateChapter ? () => onLocateChapter(item.flatIndex!, item.excerpt) : undefined,
      }))} />
    </div>
  )
}
