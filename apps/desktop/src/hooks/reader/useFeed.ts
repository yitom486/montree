import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

interface StoredFeed {
  savedAt: number
  data: FeedResult
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
    if (!parsed?.data?.items || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt >= staleMsFor(source)) return null
    return parsed as StoredFeed
  } catch {
    return null
  }
}

function writeStoredFeed(source: FeedSourceId, channel: string, data: FeedResult): void {
  try {
    window.localStorage.setItem(
      storageKey(source, channel),
      JSON.stringify({ savedAt: Date.now(), data } satisfies StoredFeed),
    )
  } catch {
    // localStorage 满/禁用时退回纯内存缓存
  }
}

async function requestFeed(payload: FeedFetchPayload, force: boolean): Promise<FeedResult> {
  const result = await feedApi.fetch({ ...payload, force, limit: payload.limit ?? FEED_PAGE_SIZE })
  if (!isOk(result)) throw result.error satisfies AppError
  return result.value
}

/**
 * 通用资讯流：source + channel 维度缓存。
 * - HN / Lobsters 60 分钟，RSS 30 分钟；
 * - 最近快照写 localStorage，重启后同一窗口内可直接展示；
 * - 手动刷新强制回源并重新计时。
 */
export function useFeed(source: FeedSourceId, channel: string) {
  const queryClient = useQueryClient()
  const staleMs = staleMsFor(source)
  const stored = useMemo(() => readStoredFeed(source, channel), [channel, source])

  const query = useQuery<FeedResult, AppError>({
    queryKey: queryKeys.feed(source, channel),
    queryFn: () => requestFeed({ source, channel }, false),
    staleTime: staleMs,
    gcTime: FEED_CACHE_GC_MS,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: FEED_AUTO_REFRESH_MS,
    refetchIntervalInBackground: false,
    initialData: stored?.data,
    initialDataUpdatedAt: stored?.savedAt,
  })

  useEffect(() => {
    if (query.data) writeStoredFeed(source, channel, query.data)
  }, [channel, query.data, query.dataUpdatedAt, source])

  const refresh = useCallback(async (): Promise<AppError | null> => {
    const result = await feedApi.fetch({ source, channel, limit: FEED_PAGE_SIZE, force: true })
    if (!isOk(result)) return result.error
    queryClient.setQueryData(queryKeys.feed(source, channel), result.value)
    return null
  }, [channel, queryClient, source])

  return { ...query, refresh }
}
