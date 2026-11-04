import { useMemo } from 'react'
import { AlertTriangle, BookOpen, Loader2, RefreshCw, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { HnStory } from '../../../../contracts/hn'
import { useHnFeed } from '@/hooks/reader/useHnFeed'
import { useLibraryStore, useLibraryUi, type HnChannel } from '@/stores/library-store'
import { HnStoryRow } from './HnStoryRow'
import { formatClock } from './format'

const CHANNELS: Array<{ id: HnChannel; label: string }> = [
  { id: 'top', label: '热门' },
  { id: 'new', label: '最新' },
  { id: 'ask', label: 'Ask HN' },
  { id: 'show', label: 'Show HN' },
]

interface HnFeedProps {
  searchQuery: string
  activeSessionSummary: { label: string; badge: string } | null
  onResumeActiveSession: () => void
  onOpenStory: (story: HnStory) => void
  onOpenDiscussion: (story: HnStory) => void
  onOpenExternal: (url: string) => void
}

export function HnFeed({
  searchQuery,
  activeSessionSummary,
  onResumeActiveSession,
  onOpenStory,
  onOpenDiscussion,
  onOpenExternal,
}: HnFeedProps) {
  const { hnChannel, readHnIds, readLaterItems, shelfItems, unreadOnly, returnContext } = useLibraryUi(
    (s) => ({
      hnChannel: s.hnChannel,
      readHnIds: s.readHnIds,
      readLaterItems: s.readLaterItems,
      shelfItems: s.shelfItems,
      unreadOnly: s.unreadOnly,
      returnContext: s.returnContext,
    }),
  )
  const setHnChannel = useLibraryStore((s) => s.setHnChannel)
  const setUnreadOnly = useLibraryStore((s) => s.setUnreadOnly)
  const toggleHnRead = useLibraryStore((s) => s.toggleHnRead)
  const markHnRead = useLibraryStore((s) => s.markHnRead)
  const toggleReadLater = useLibraryStore((s) => s.toggleReadLater)
  const toggleShelfItem = useLibraryStore((s) => s.toggleShelfItem)

  const { data, isPending, isFetching, isError, error, refetch, refresh } = useHnFeed(hnChannel)

  const stories = useMemo(() => {
    const source = data?.stories ?? []
    const query = searchQuery.trim().toLowerCase()
    return source.filter((story) => {
      if (unreadOnly && readHnIds.includes(story.id)) return false
      if (!query) return true
      return (
        story.title.toLowerCase().includes(query) ||
        (story.domain ?? '').toLowerCase().includes(query) ||
        story.author.toLowerCase().includes(query)
      )
    })
  }, [data, searchQuery, unreadOnly, readHnIds])

  const handleRefresh = async () => {
    const failure = await refresh()
    if (failure) toast.error('刷新失败', { description: failure.message })
  }

  const handleToggleLater = (story: HnStory) => {
    const added = toggleReadLater({
      id: `hn-${story.id}`,
      hnId: story.id,
      title: story.title,
      url: story.url ?? story.commentUrl,
      commentUrl: story.commentUrl,
      domain: story.domain ?? 'news.ycombinator.com',
      author: story.author,
      points: story.points,
      commentsCount: story.comments,
      createdAt: story.createdAt,
    })
    toast.success(added ? '已加入稍后阅读' : '已从稍后阅读移除')
  }

  const handleToggleShelf = (story: HnStory) => {
    const added = toggleShelfItem({
      id: `hn-${story.id}`,
      kind: 'article',
      title: story.title,
      authorOrSource: story.domain ?? 'Hacker News',
      domain: story.domain ?? 'news.ycombinator.com',
      format: 'Hacker News',
      versionOrYear: `${story.points} 分`,
      target: story.url ?? story.commentUrl,
      commentUrl: story.commentUrl,
      hnId: story.id,
      points: story.points,
      commentsCount: story.comments,
      createdAt: story.createdAt,
    })
    toast.success(added ? '已收藏到书架' : '已从书架移除')
  }

  return (
    <div className="space-y-3">
      {activeSessionSummary && (
        <button
          type="button"
          onClick={onResumeActiveSession}
          className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <BookOpen className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{activeSessionSummary.label}</span>
            <span className="block text-xs text-muted-foreground">{activeSessionSummary.badge}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">继续阅读</span>
        </button>
      )}

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
        <Tabs value={hnChannel} onValueChange={(value) => setHnChannel(value as HnChannel)}>
          <TabsList className="h-8 bg-muted/70 p-0.5">
            {CHANNELS.map((channel) => (
              <TabsTrigger key={channel.id} value={channel.id} className="h-7 px-3 text-xs">
                {channel.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <button
          type="button"
          onClick={() => setUnreadOnly(!unreadOnly)}
          aria-pressed={unreadOnly}
          className={cn(
            'h-7 rounded-md px-2 text-xs transition-colors',
            unreadOnly
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          只看未读
        </button>

        <span className="hidden text-xs text-muted-foreground sm:inline">
          {data ? `${stories.length} 条 · 更新于 ${formatClock(data.fetchedAt)}` : '正在加载'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={handleRefresh}
            disabled={isFetching}
            title="跳过缓存，重新拉取当前频道"
          >
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
            刷新
          </Button>
        </div>
      </div>

      {isPending ? (
        <ul className="space-y-1" aria-label="正在加载 Hacker News">
          {Array.from({ length: 8 }).map((_, index) => (
            <li key={index} className="flex animate-pulse gap-3 px-3 py-3">
              <div className="mt-1 h-3 w-4 rounded bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-3/4 rounded bg-muted" />
                <div className="h-3 w-40 rounded bg-muted/70" />
              </div>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div
          role="alert"
          className="mx-auto my-12 flex max-w-sm flex-col items-center rounded-xl border border-border/70 bg-card px-6 py-8 text-center"
        >
          <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <p className="text-sm font-medium">无法连接 Hacker News</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {error?.message ?? '请检查网络或代理设置后重试。'}
          </p>
          <Button size="sm" className="mt-4 h-8 gap-1.5 text-xs" onClick={() => void refetch()}>
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        </div>
      ) : stories.length === 0 ? (
        <div className="mx-auto my-12 flex max-w-sm flex-col items-center text-center">
          <SearchX className="mb-3 size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">没有符合条件的条目</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {searchQuery ? `当前频道没有包含“${searchQuery}”的内容` : '当前筛选下暂无可显示的条目'}
          </p>
        </div>
      ) : (
        <ul className="-mx-1 divide-y divide-border/40">
          {stories.map((story, index) => (
            <HnStoryRow
              key={story.id}
              story={story}
              rank={index + 1}
              isRead={readHnIds.includes(story.id)}
              isSaved={shelfItems.some((item) => item.hnId === story.id)}
              isLater={readLaterItems.some((item) => item.hnId === story.id)}
              isReturnTarget={returnContext?.hnId === story.id}
              onOpen={() => {
                markHnRead(story.id)
                onOpenStory(story)
              }}
              onOpenDiscussion={() => {
                markHnRead(story.id)
                onOpenDiscussion(story)
              }}
              onToggleRead={() => toggleHnRead(story.id)}
              onToggleLater={() => handleToggleLater(story)}
              onToggleShelf={() => handleToggleShelf(story)}
              onOpenExternal={() => {
                if (story.url) onOpenExternal(story.url)
              }}
            />
          ))}
        </ul>
      )}

      {isFetching && !isPending && (
        <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          正在同步最新条目
        </div>
      )}
    </div>
  )
}
