import { BookOpen, FileText, Globe, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ShelfEntry, ShelfFilter } from '@/stores/library-store'

const FILTERS: Array<{ id: ShelfFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'book', label: '书籍' },
  { id: 'doc', label: '文档' },
  { id: 'article', label: '文章' },
]

function ShelfRow({
  item,
  onOpen,
  onRemove,
}: {
  item: ShelfEntry
  onOpen: () => void
  onRemove: () => void
}) {
  const Icon = item.kind === 'article' ? Globe : FileText
  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {[item.domain ?? item.authorOrSource, item.versionOrYear, item.format]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        title="移出书架"
        aria-label={`移出书架：${item.title}`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  )
}

function BookCard({
  item,
  onOpen,
  onRemove,
}: {
  item: ShelfEntry
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <div className="group relative flex gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-border hover:bg-muted/40">
      <button
        type="button"
        onClick={onOpen}
        className="flex size-14 shrink-0 flex-col items-center justify-center gap-1 rounded-md bg-muted text-muted-foreground"
        aria-label={`继续阅读 ${item.title}`}
      >
        <BookOpen className="size-5" />
        <span className="text-[10px] font-medium uppercase tracking-wide">{item.format ?? 'BOOK'}</span>
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{item.authorOrSource}</span>
        {typeof item.progress === 'number' && (
          <span className="mt-2 flex items-center gap-2">
            <Progress value={item.progress} className="h-1 flex-1" />
            <span className="text-[11px] tabular-nums text-muted-foreground">{item.progress}%</span>
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        title="移出书架"
        aria-label={`移出书架：${item.title}`}
        className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-md bg-card/80 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 pb-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-muted-foreground">{count}</span>
    </div>
  )
}

interface ShelfViewProps {
  items: ShelfEntry[]
  filter: ShelfFilter
  searchQuery: string
  onFilterChange: (filter: ShelfFilter) => void
  onOpen: (item: ShelfEntry) => void
  onRemove: (item: ShelfEntry) => void
  onImport?: () => void
}

export function ShelfView({
  items,
  filter,
  searchQuery,
  onFilterChange,
  onOpen,
  onRemove,
  onImport,
}: ShelfViewProps) {
  const query = searchQuery.trim().toLowerCase()
  const searched = items.filter((item) => {
    if (!query) return true
    return (
      item.title.toLowerCase().includes(query) ||
      item.authorOrSource.toLowerCase().includes(query) ||
      (item.domain ?? '').toLowerCase().includes(query)
    )
  })
  const filtered = searched.filter((item) => filter === 'all' || item.kind === filter)
  const books = filtered.filter((item) => item.kind === 'book')
  const docs = filtered.filter((item) => item.kind === 'doc')
  const articles = filtered.filter((item) => item.kind === 'article')

  const counts: Record<ShelfFilter, number> = {
    all: searched.length,
    book: searched.filter((item) => item.kind === 'book').length,
    doc: searched.filter((item) => item.kind === 'doc').length,
    article: searched.filter((item) => item.kind === 'article').length,
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(value) => onFilterChange(value as ShelfFilter)}>
          <TabsList className="h-8 bg-muted/70 p-0.5">
            {FILTERS.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id} className="h-7 gap-1.5 px-3 text-xs">
                {entry.label}
                <span className="tabular-nums text-muted-foreground">{counts[entry.id]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {onImport && (
          <Button variant="outline" size="sm" className="ml-auto h-8 gap-1.5 text-xs" onClick={onImport}>
            <Plus className="size-3.5" />
            导入书籍
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border/70 py-14 text-center">
          <BookOpen className="mb-3 size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">{query ? '没有匹配的书架条目' : '书架还是空的'}</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            {query
              ? `没有找到包含“${searchQuery}”的书、文档或文章`
              : '在发现页收藏文章，或从最近阅读把常看的文件收入书架。'}
          </p>
        </div>
      ) : (
        <>
          {books.length > 0 && (
            <section className="space-y-2">
              <SectionTitle title="书籍" count={books.length} />
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {books.map((item) => (
                  <BookCard
                    key={item.id}
                    item={item}
                    onOpen={() => onOpen(item)}
                    onRemove={() => onRemove(item)}
                  />
                ))}
              </div>
            </section>
          )}

          {docs.length > 0 && (
            <section className="space-y-2">
              <SectionTitle title="文档" count={docs.length} />
              <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
                {docs.map((item) => (
                  <ShelfRow
                    key={item.id}
                    item={item}
                    onOpen={() => onOpen(item)}
                    onRemove={() => onRemove(item)}
                  />
                ))}
              </ul>
            </section>
          )}

          {articles.length > 0 && (
            <section className="space-y-2">
              <SectionTitle title="文章" count={articles.length} />
              <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
                {articles.map((item) => (
                  <ShelfRow
                    key={item.id}
                    item={item}
                    onOpen={() => onOpen(item)}
                    onRemove={() => onRemove(item)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
