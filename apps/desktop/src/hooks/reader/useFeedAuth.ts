import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isOk } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import { feedAuthApi } from '@/api/feed-auth-api'
import { queryKeys } from '@/api/query-keys'
import type { FeedAuthStatus, FeedSourceId } from '../../../contracts/feed'

/** 登录状态查询 + 打开登录窗口/退出登录 */
export function useFeedAuth(source: FeedSourceId, enabled: boolean) {
  const queryClient = useQueryClient()

  const query = useQuery<FeedAuthStatus, AppError>({
    queryKey: queryKeys.feedAuth(source),
    enabled,
    queryFn: async () => {
      const result = await feedAuthApi.status(source)
      if (!isOk(result)) throw result.error
      return result.value
    },
    staleTime: 30_000,
    retry: 0,
  })

  const login = useCallback(async (): Promise<
    { status: FeedAuthStatus } | { error: AppError }
  > => {
    const result = await feedAuthApi.login(source)
    if (!isOk(result)) return { error: result.error }
    queryClient.setQueryData(queryKeys.feedAuth(source), result.value)
    return { status: result.value }
  }, [queryClient, source])

  const logout = useCallback(async (): Promise<void> => {
    const result = await feedAuthApi.logout(source)
    if (isOk(result)) {
      queryClient.setQueryData<FeedAuthStatus>(queryKeys.feedAuth(source), {
        authenticated: false,
      })
    }
  }, [queryClient, source])

  return { ...query, login, logout }
}
