import { useCallback, useEffect, useMemo } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { isOk } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import { feedApi } from '@/api/feed-api'
import { queryKeys } from '@/api/query-keys'
import type { FeedFetchPayload, FeedResult, FeedSourceId } from '../../../contracts/feed'

export const FEED_PAGE_SIZE = 30
export const FEED_AUTO_REFRESH_MS = 2 * 60 * 60_000
const FEED_CACHE_GC_MS = 24 * 60 * 60_000
const RSS_STALE_MS = 30 * 60_000
const AGGREGATOR_STALE_MS = 60 * 60_000
const FEED_STORAGE_PREFIX = 'montree:feed:'

type FeedPages = InfiniteData<FeedResult, number>

interface StoredFeed {
  savedAt: number
  /** 只存第一页，重启后先展示快照，加载更多时再取后续页 */
  page: FeedResult
}

function staleMsFor(source: FeedSourceId): number {
  if (source === 'rss') return RSS_STALE_MS
  if (source === 'arxiv') return 6 * 60 * 60_000
  return AGGREGATOR_STALE_MS
}

function storageKey(source: FeedSourceId, channel: string): string {
  return `${FEED_STORAGE_PREFIX}${source}:${channel}`
}

function readStoredFeed(source: FeedSourceId, channel: string): StoredFeed | null {
  try {
    const raw = window.localStorage.getItem(storageKey(source, channel))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredFeed>
    if (!parsed?.page?.items || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt >= staleMsFor(source)) return null
    return parsed as StoredFeed
  } catch {
    return null
  }
}

function writeStoredFeed(source: FeedSourceId, channel: string, page: FeedResult): void {
  try {
    window.localStorage.setItem(
      storageKey(source, channel),
      JSON.stringify({ savedAt: Date.now(), page } satisfies StoredFeed),
    )
  } catch {
    // localStorage 满/禁用时退回纯内存缓存
  }
}

async function requestFeed(payload: FeedFetchPayload, force: boolean): Promise<FeedResult> {
  const result = await feedApi.fetch({
    ...payload,
    force,
    limit: payload.limit ?? FEED_PAGE_SIZE,
  })
  if (!isOk(result)) throw result.error satisfies AppError
  return result.value
}

/**
 * 通用资讯流：source + channel 维度的无限分页。
 * - HN / Lobsters 60 分钟，RSS 30 分钟，arXiv 6 小时；
 * - 最近第一页写 localStorage，重启后可直接展示；
 * - 手动刷新强制回源并重置到第一页。
 */
export function useFeed(source: FeedSourceId, channel: string) {
  const queryClient = useQueryClient()
  const staleMs = staleMsFor(source)
  const stored = useMemo(() => readStoredFeed(source, channel), [channel, source])

  const query = useInfiniteQuery<FeedResult, AppError, FeedPages, readonly unknown[], number>({
    queryKey: queryKeys.feed(source, channel),
    queryFn: ({ pageParam }) => requestFeed({ source, channel, page: pageParam }, false),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    staleTime: staleMs,
    gcTime: FEED_CACHE_GC_MS,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: FEED_AUTO_REFRESH_MS,
    refetchIntervalInBackground: false,
    initialData: stored ? { pages: [stored.page], pageParams: [0] } : undefined,
    initialDataUpdatedAt: stored?.savedAt,
  })

  useEffect(() => {
    const firstPage = query.data?.pages[0]
    if (firstPage) writeStoredFeed(source, channel, firstPage)
  }, [channel, source, query.data])

  const refresh = useCallback(async (): Promise<AppError | null> => {
    const result = await feedApi.fetch({
      source,
      channel,
      page: 0,
      limit: FEED_PAGE_SIZE,
      force: true,
    })
    if (!isOk(result)) return result.error
    queryClient.setQueryData<FeedPages>(queryKeys.feed(source, channel), {
      pages: [result.value],
      pageParams: [0],
    })
    return null
  }, [channel, queryClient, source])

  return { ...query, refresh }
}
