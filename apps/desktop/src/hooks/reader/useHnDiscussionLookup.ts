import { useQuery } from '@tanstack/react-query'
import { isOk } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import { hnApi } from '@/api/hn-api'
import { queryKeys } from '@/api/query-keys'
import type { HnDiscussionRef } from '../../../contracts/hn'

const DISCUSSION_LOOKUP_STALE_MS = 24 * 60 * 60_000

/**
 * 手动打开任意文章时，按 URL 反查 HN 讨论。
 * 只在没有显式讨论链接时启用；查不到是正常结果，不弹错误。
 */
export function useHnDiscussionLookup(pageUrl: string | null | undefined, enabled: boolean) {
  const safeUrl = pageUrl?.trim() || null

  return useQuery<HnDiscussionRef | null, AppError>({
    queryKey: queryKeys.hnDiscussion(safeUrl ?? ''),
    enabled: Boolean(enabled && safeUrl),
    queryFn: async () => {
      const result = await hnApi.findDiscussion({ url: safeUrl! })
      if (!isOk(result)) throw result.error satisfies AppError
      return result.value
    },
    staleTime: DISCUSSION_LOOKUP_STALE_MS,
    gcTime: DISCUSSION_LOOKUP_STALE_MS,
    retry: 0,
    refetchOnWindowFocus: false,
  })
}
