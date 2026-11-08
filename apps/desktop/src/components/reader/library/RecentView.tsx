import { Bookmark, FileText, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ShelfEntry } from '@/stores/library-store'
import { extractDomain, getFileExt, getFileName } from './format'

interface RecentViewProps {
  recentFiles: string[]
  recentWebUrls: string[]
  activeFilePath?: string
  webPageUrl?: string | null
  searchQuery: string
  shelfItems: ShelfEntry[]
  onSelectFile: (path: string) => void
  onOpenWebDoc: (url: string) => void
  onResumeActiveSession: () => void
  onToggleShelf: (entry: Omit<ShelfEntry, 'addedAt'>) => void
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-border/40 rounded-lg border border-border/60">{children}</div>
    </section>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{text}</p>
}

export function RecentView({
  recentFiles,
  recentWebUrls,
  activeFilePath,
  webPageUrl,
  searchQuery,
  shelfItems,
  onSelectFile,
  onOpenWebDoc,
  onResumeActiveSession,
  onToggleShelf,
}: RecentViewProps) {
  const query = searchQuery.trim().toLowerCase()
  const files = recentFiles.filter((path) => !query || path.toLowerCase().includes(query))
  const urls = recentWebUrls.filter((url) => !query || url.toLowerCase().includes(query))

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="本地文件" icon={<FileText className="size-4" />}>
        {files.length === 0 ? (
          <EmptyRow text="暂无最近打开的本地文件" />
        ) : (
          files.map((filePath) => {
            const name = getFileName(filePath)
            const inShelf = shelfItems.some((item) => item.target === filePath)
            return (
              <div
                key={filePath}
                className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
              >
                <span className="w-9 shrink-0 rounded bg-muted px-1 py-0.5 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                  {getFileExt(name)}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    onSelectFile(filePath)
                    onResumeActiveSession()
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{name}</span>
                    {activeFilePath === filePath && (
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        当前
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{filePath}</span>
                </button>
                <button
                  type="button"
                  title={inShelf ? '从书架移除' : '收入书架'}
                  aria-label={`${inShelf ? '从书架移除' : '收入书架'}：${name}`}
                  onClick={() =>
                    onToggleShelf({
                      id: `local-${filePath}`,
                      kind: 'book',
                      title: name.replace(/\.[^.]+$/, ''),
                      authorOrSource: '本地文件',
                      format: getFileExt(name),
                      target: filePath,
                    })
                  }
                  className={cn(
                    'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                    inShelf && 'text-primary',
                  )}
                >
                  <Bookmark className={cn('size-3.5', inShelf && 'fill-current')} />
                </button>
              </div>
            )
          })
        )}
      </Section>

      <Section title="在线网址" icon={<Globe className="size-4" />}>
        {urls.length === 0 ? (
          <EmptyRow text="暂无最近访问的在线网址" />
        ) : (
          urls.map((url) => {
            const domain = extractDomain(url)
            const inShelf = shelfItems.some((item) => item.target === url)
            return (
              <div
                key={url}
                className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    onOpenWebDoc(url)
                    onResumeActiveSession()
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{domain}</span>
                    {webPageUrl === url && (
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        当前
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{url}</span>
                </button>
                <button
                  type="button"
                  title={inShelf ? '从书架移除' : '收入书架'}
                  aria-label={`${inShelf ? '从书架移除' : '收入书架'}：${domain}`}
                  onClick={() =>
                    onToggleShelf({
                      id: `web-${url}`,
                      kind: 'doc',
                      title: url,
                      authorOrSource: domain,
                      domain,
                      format: 'Web',
                      target: url,
                    })
                  }
                  className={cn(
                    'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                    inShelf && 'text-primary',
                  )}
                >
                  <Bookmark className={cn('size-3.5', inShelf && 'fill-current')} />
                </button>
              </div>
            )
          })
        )}
      </Section>
    </div>
  )
}
