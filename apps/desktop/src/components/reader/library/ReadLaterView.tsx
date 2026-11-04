import { Bookmark, Clock, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ReadLaterEntry } from '@/stores/library-store'
import { formatRelativeTime } from './format'

interface ReadLaterViewProps {
  items: ReadLaterEntry[]
  searchQuery: string
  onOpen: (item: ReadLaterEntry) => void
  onMoveToShelf: (item: ReadLaterEntry) => void
  onRemove: (item: ReadLaterEntry) => void
  onBrowse: () => void
}

export function ReadLaterView({
  items,
  searchQuery,
  onOpen,
  onMoveToShelf,
  onRemove,
  onBrowse,
}: ReadLaterViewProps) {
  const query = searchQuery.trim().toLowerCase()
  const filtered = items.filter((item) => {
    if (!query) return true
    return (
      item.title.toLowerCase().includes(query) ||
      item.domain.toLowerCase().includes(query) ||
      item.author.toLowerCase().includes(query)
    )
  })

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border/70 py-14 text-center">
        <Clock className="mb-3 size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">{items.length === 0 ? '稍后阅读是空的' : '没有匹配的条目'}</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          {items.length === 0
            ? '在发现页把想细读的文章加入稍后阅读，它们会出现在这里。'
            : `没有找到包含“${searchQuery}”的条目。`}
        </p>
        {items.length === 0 && (
          <Button variant="outline" size="sm" className="mt-4 h-8 text-xs" onClick={onBrowse}>
            去发现页看看
          </Button>
        )}
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border/40">
      {filtered.map((item) => (
        <li key={item.id} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50">
          <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium">{item.title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span className="truncate">{item.domain}</span>
              <span className="text-border">·</span>
              <span className="tabular-nums">{item.points ?? 0} 分</span>
              <span className="text-border">·</span>
              <span className="truncate">{item.author}</span>
              {item.createdAt ? (
                <>
                  <span className="text-border">·</span>
                  <span>{formatRelativeTime(item.createdAt)}</span>
                </>
              ) : null}
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => onMoveToShelf(item)}
            >
              <Bookmark className="size-3.5" />
              收藏
            </Button>
            <button
              type="button"
              onClick={() => onRemove(item)}
              title="移除"
              aria-label={`从稍后阅读移除：${item.title}`}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
