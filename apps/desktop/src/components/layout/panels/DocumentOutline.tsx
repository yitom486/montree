import { ChevronDown, ChevronRight, ListTree } from 'lucide-react'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'
import { cn } from '@/lib/utils'

interface DocumentOutlineProps {
  headings: MarkdownHeading[]
  /** 侧栏折叠模式：仅显示标题栏 */
  collapsed?: boolean
  activeHeadingId?: string
  onToggle: () => void
  onSelectHeading: (heading: MarkdownHeading) => void
}

export function DocumentOutline({
  headings,
  collapsed = false,
  activeHeadingId,
  onToggle,
  onSelectHeading,
}: DocumentOutlineProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col bg-sidebar',
        collapsed ? 'shrink-0 border-t border-border/60' : 'h-full overflow-hidden',
      )}
    >
      <button
        type="button"
        className="flex w-full shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 hover:text-foreground transition-colors"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? '展开目录大纲' : '折叠目录大纲'}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
        <ListTree className="size-3.5 shrink-0" />
        <span>目录</span>
        {headings.length > 0 && (
          <span className="ml-auto rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-normal normal-case text-muted-foreground/80">
            {headings.length}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          {headings.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">当前文档暂无标题</p>
          ) : (
            <ul className="space-y-0.5 p-2">
              {headings.map((heading) => (
                <li key={`${heading.id}-${heading.line}`}>
                  <button
                    type="button"
                    className={cn(
                      'w-full truncate rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-accent/50 hover:text-foreground',
                      activeHeadingId === heading.id
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground',
                    )}
                    style={{ paddingLeft: `${(heading.level - 1) * 10 + 8}px` }}
                    title={heading.text}
                    onClick={() => onSelectHeading(heading)}
                  >
                    {heading.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
