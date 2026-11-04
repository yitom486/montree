import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isOk } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import { hnApi } from '@/api/hn-api'
import { queryKeys } from '@/api/query-keys'
import type { HnFeedChannel, HnFeedResult } from '../../../contracts/hn'

export const HN_PAGE_SIZE = 30
/** 列表在渲染端视为新鲜的时间：期间切走再回来不重新请求 */
export const HN_STALE_MS = 60 * 60_000
/** 页面挂着时的后台自动刷新间隔；窗口不在前台时 TanStack 会暂停 */
export const HN_AUTO_REFRESH_MS = 2 * 60 * 60_000
/** 离开阅读馆后仍保留列表，返回时直接复用而不是闪骨架 */
const HN_CACHE_GC_MS = 24 * 60 * 60_000
const HN_STORAGE_PREFIX = 'montree:hn-feed:'

interface StoredFeed {
  savedAt: number
  data: HnFeedResult
}

function readStoredFeed(channel: HnFeedChannel): StoredFeed | null {
  try {
    const raw = window.localStorage.getItem(`${HN_STORAGE_PREFIX}${channel}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredFeed>
    if (!parsed?.data?.stories || typeof parsed.savedAt !== 'number') return null
    return parsed as StoredFeed
  } catch {
    return null
  }
}

function writeStoredFeed(channel: HnFeedChannel, data: HnFeedResult): void {
  try {
    window.localStorage.setItem(
      `${HN_STORAGE_PREFIX}${channel}`,
      JSON.stringify({ savedAt: Date.now(), data } satisfies StoredFeed),
    )
  } catch {
    // localStorage 满/禁用时退回纯内存缓存，不影响阅读
  }
}

async function requestFeed(channel: HnFeedChannel, force: boolean): Promise<HnFeedResult> {
  const result = await hnApi.fetchFeed({ channel, limit: HN_PAGE_SIZE, force })
  if (!isOk(result)) throw result.error satisfies AppError
  return result.value
}

/**
 * 真实 Hacker News 频道数据。
 *
 * - 60 分钟内复用缓存，窗口重新聚焦也不会重复请求；
 * - 最近一次频道快照写入 localStorage，应用重启后 60 分钟内仍可直接展示；
 * - 阅读馆持续打开时每 2 小时自动刷新一次（仅在应用运行时）；
 * - 手动「刷新」走 force，跳过主进程缓存并重新计时。
 */
export function useHnFeed(channel: HnFeedChannel) {
  const queryClient = useQueryClient()
  // 只把 60 分钟内的快照当初始数据；更旧的交给正常回源
  const stored = useMemo(() => {
    const snapshot = readStoredFeed(channel)
    if (!snapshot || Date.now() - snapshot.savedAt >= HN_STALE_MS) return null
    return snapshot
  }, [channel])

  const query = useQuery<HnFeedResult, AppError>({
    queryKey: queryKeys.hnFeed(channel),
    queryFn: () => requestFeed(channel, false),
    staleTime: HN_STALE_MS,
    gcTime: HN_CACHE_GC_MS,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: HN_AUTO_REFRESH_MS,
    refetchIntervalInBackground: false,
    initialData: stored?.data,
    initialDataUpdatedAt: stored?.savedAt,
  })

  useEffect(() => {
    if (query.data) writeStoredFeed(channel, query.data)
  }, [channel, query.data, query.dataUpdatedAt])

  /** 手动刷新：跳过主进程缓存，直接把新结果写回当前频道并重置 60 分钟窗口 */
  const refresh = useCallback(async (): Promise<AppError | null> => {
    const result = await hnApi.fetchFeed({ channel, limit: HN_PAGE_SIZE, force: true })
    if (!isOk(result)) return result.error
    queryClient.setQueryData(queryKeys.hnFeed(channel), result.value)
    return null
  }, [channel, queryClient])

  return { ...query, refresh }
}
