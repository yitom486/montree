import { useEffect, useMemo, useRef } from 'react'
import { PanelRightClose } from 'lucide-react'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface DocumentOutlineProps {
  headings: MarkdownHeading[]
  activeHeadingId?: string
  onSelectHeading: (heading: MarkdownHeading) => void
  /** 折叠页内目录面板（仅隐藏面板，重新打开由文档区内的目录按钮负责） */
  onHide?: () => void
}

const INDENT_STEP = 12
const MAX_INDENT_LEVELS = 4

/**
 * 文档正文右侧的页内目录：
 * - 仅在存在标题的 Markdown / 在线文档出现；
 * - 正文与目录双向联动，当前标题加粗并自动滚入可视区；
 * - 长目录独立纵向滚动，不影响正文阅读位置。
 */
export function DocumentOutline({
  headings,
  activeHeadingId,
  onSelectHeading,
  onHide,
}: DocumentOutlineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  const minLevel = useMemo(
    () => headings.reduce((min, heading) => Math.min(min, heading.level), 6),
    [headings],
  )

  useEffect(() => {
    const container = scrollRef.current
    const activeItem = activeHeadingId ? itemRefs.current.get(activeHeadingId) : undefined
    if (!container || !activeItem) return
    const containerRect = container.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    const margin = 8
    if (itemRect.top < containerRect.top + margin) {
      container.scrollTop += itemRect.top - containerRect.top - margin
    } else if (itemRect.bottom > containerRect.bottom - margin) {
      container.scrollTop += itemRect.bottom - containerRect.bottom + margin
    }
  }, [activeHeadingId])

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="文档目录">
      <header className="flex h-7 shrink-0 items-center justify-between gap-2 px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          目录
        </span>
        {onHide ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            onClick={onHide}
            title="收起文档大纲"
            aria-label="收起文档大纲"
          >
            <PanelRightClose className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </header>

      <div ref={scrollRef} className="outline-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
        {headings.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">当前文档暂无标题</p>
        ) : (
          <nav className="border-l border-border/60" aria-label="文档标题导航">
            <ul className="space-y-0.5">
              {headings.map((heading) => {
                const active = heading.id === activeHeadingId
                const depth = Math.min(
                  MAX_INDENT_LEVELS,
                  Math.max(0, heading.level - minLevel),
                )
                return (
                  <li key={`${heading.id}-${heading.line}`}>
                    <button
                      ref={(element) => {
                        if (element) itemRefs.current.set(heading.id, element)
                        else itemRefs.current.delete(heading.id)
                      }}
                      type="button"
                      aria-current={active ? 'location' : undefined}
                      className={cn(
                        'group relative flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs leading-relaxed transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? 'font-semibold text-primary'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                      style={{ paddingLeft: `${depth * INDENT_STEP + 10}px` }}
                      title={heading.text}
                      onClick={() => onSelectHeading(heading)}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                          active ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="min-w-0 truncate">{heading.text}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}
      </div>
    </section>
  )
}
