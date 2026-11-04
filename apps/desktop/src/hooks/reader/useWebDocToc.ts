import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { webDocApi } from '@/api/web-doc-api'
import { queryKeys } from '@/api/query-keys'
import { isOk } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import type { WebDocDiscoverTocResult } from '@yitom/contracts'

async function fetchWebDocToc(discoveryUrl: string): Promise<WebDocDiscoverTocResult> {
  const result = await webDocApi.discoverToc({ url: discoveryUrl })
  if (!isOk(result)) {
    throw result.error satisfies AppError
  }
  return result.value
}

export function useWebDocToc(discoveryUrl: string | null | undefined) {
  const safeUrl = discoveryUrl?.trim() || null

  return useQuery<WebDocDiscoverTocResult, AppError>({
    queryKey: queryKeys.webDocToc(safeUrl ?? ''),
    enabled: Boolean(safeUrl),
    queryFn: () => fetchWebDocToc(safeUrl!),
    placeholderData: keepPreviousData,
    // 目录变化远慢于正文；60 分钟内不重复发现
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
  })
}
