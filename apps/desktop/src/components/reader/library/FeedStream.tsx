import { useMemo } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  Rss,
  SearchX,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { FeedItem } from '../../../../contracts/feed'
import { FEED_SOURCES, findFeedSource } from '../../../../contracts/feed'
import { useFeed } from '@/hooks/reader/useFeed'
import { useLibraryStore, useLibraryUi, feedItemKey } from '@/stores/library-store'
import { FeedRow } from './FeedRow'
import { formatClock } from './format'

interface FeedStreamProps {
  searchQuery: string
  activeSessionSummary: { label: string; badge: string } | null
  onResumeActiveSession: () => void
  onOpenStory: (item: FeedItem) => void
  onOpenDiscussion: (item: FeedItem) => void
  onOpenExternal: (url: string) => void
}

export function FeedStream({
  searchQuery,
  activeSessionSummary,
  onResumeActiveSession,
  onOpenStory,
  onOpenDiscussion,
  onOpenExternal,
}: FeedStreamProps) {
  const { feedSource, feedChannel, readItemKeys, readLaterItems, shelfItems, unreadOnly, returnContext } =
    useLibraryUi((s) => ({
      feedSource: s.feedSource,
      feedChannel: s.feedChannel,
      readItemKeys: s.readItemKeys,
      readLaterItems: s.readLaterItems,
      shelfItems: s.shelfItems,
      unreadOnly: s.unreadOnly,
      returnContext: s.returnContext,
    }))
  const setFeedSource = useLibraryStore((s) => s.setFeedSource)
  const setFeedChannel = useLibraryStore((s) => s.setFeedChannel)
  const setUnreadOnly = useLibraryStore((s) => s.setUnreadOnly)
  const toggleItemRead = useLibraryStore((s) => s.toggleItemRead)
  const markItemRead = useLibraryStore((s) => s.markItemRead)
  const toggleReadLater = useLibraryStore((s) => s.toggleReadLater)
  const toggleShelfItem = useLibraryStore((s) => s.toggleShelfItem)

  const source = findFeedSource(feedSource)
  const { data, isPending, isFetching, isError, error, refetch, refresh } = useFeed(
    feedSource,
    feedChannel,
  )

  const items = useMemo(() => {
    const sourceItems = data?.items ?? []
    const query = searchQuery.trim().toLowerCase()
    return sourceItems.filter((item) => {
      const key = feedItemKey(item.source, item.id)
      if (unreadOnly && readItemKeys.includes(key)) return false
      if (!query) return true
      return (
        item.title.toLowerCase().includes(query) ||
        (item.domain ?? '').toLowerCase().includes(query) ||
        item.author.toLowerCase().includes(query)
      )
    })
  }, [data, searchQuery, unreadOnly, readItemKeys])

  const handleRefresh = async () => {
    const failure = await refresh()
    if (failure) toast.error('刷新失败', { description: failure.message })
  }

  const handleToggleLater = (item: FeedItem) => {
    const key = feedItemKey(item.source, item.id)
    const added = toggleReadLater({
      id: key,
      sourceId: item.source,
      hnId: item.source === 'hacker-news' ? Number(item.id) : undefined,
      title: item.title,
      url: item.url ?? item.discussionUrl,
      commentUrl: item.comments > 0 ? item.discussionUrl : undefined,
      domain: item.domain ?? source.label,
      author: item.author,
      points: item.points,
      commentsCount: item.comments,
      createdAt: item.createdAt,
    })
    toast.success(added ? '已加入稍后阅读' : '已从稍后阅读移除')
  }

  const handleToggleShelf = (item: FeedItem) => {
    const key = feedItemKey(item.source, item.id)
    const added = toggleShelfItem({
      id: key,
      kind: 'article',
      sourceId: item.source,
      hnId: item.source === 'hacker-news' ? Number(item.id) : undefined,
      title: item.title,
      authorOrSource: item.domain ?? source.label,
      domain: item.domain ?? source.label,
      format: source.label,
      versionOrYear: item.points > 0 ? `${item.points} 分` : undefined,
      target: item.url ?? item.discussionUrl,
      commentUrl: item.comments > 0 ? item.discussionUrl : undefined,
      points: item.points,
      commentsCount: item.comments,
      createdAt: item.createdAt,
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs"
              title="切换资讯来源"
            >
              <Rss className="size-3.5 text-muted-foreground" />
              {source.label}
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">
              资讯来源
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {FEED_SOURCES.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onClick={() => setFeedSource(entry.id)}
                className="flex cursor-pointer flex-col items-start gap-0.5"
              >
                <span className="flex w-full items-center justify-between text-xs font-medium">
                  {entry.label}
                  {entry.id === feedSource && <Check className="size-3.5 text-primary" />}
                </span>
                <span className="text-[11px] text-muted-foreground">{entry.description}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tabs value={feedChannel} onValueChange={setFeedChannel}>
          <TabsList className="h-8 bg-muted/70 p-0.5">
            {source.channels.map((channel) => (
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
          {data ? `${items.length} 条 · 更新于 ${formatClock(data.fetchedAt)}` : '正在加载'}
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
        <ul className="space-y-1" aria-label={`正在加载 ${source.label}`}>
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
          <p className="text-sm font-medium">无法连接 {source.label}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {error?.message ?? '请检查网络或代理设置后重试。'}
          </p>
          <Button size="sm" className="mt-4 h-8 gap-1.5 text-xs" onClick={() => void refetch()}>
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="mx-auto my-12 flex max-w-sm flex-col items-center text-center">
          <SearchX className="mb-3 size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">没有符合条件的条目</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {searchQuery ? `当前频道没有包含“${searchQuery}”的内容` : '当前筛选下暂无可显示的条目'}
          </p>
        </div>
      ) : (
        <ul className="-mx-1 divide-y divide-border/40">
          {items.map((item, index) => {
            const key = feedItemKey(item.source, item.id)
            return (
              <FeedRow
                key={key}
                item={item}
                rank={index + 1}
                isRead={readItemKeys.includes(key)}
                isSaved={shelfItems.some((entry) => entry.id === key)}
                isLater={readLaterItems.some((entry) => entry.id === key)}
                isReturnTarget={returnContext?.itemKey === key}
                onOpen={() => {
                  markItemRead(key)
                  onOpenStory(item)
                }}
                onOpenDiscussion={() => {
                  markItemRead(key)
                  onOpenDiscussion(item)
                }}
                onToggleRead={() => toggleItemRead(key)}
                onToggleLater={() => handleToggleLater(item)}
                onToggleShelf={() => handleToggleShelf(item)}
                onOpenExternal={() => {
                  if (item.url) onOpenExternal(item.url)
                }}
              />
            )
          })}
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
