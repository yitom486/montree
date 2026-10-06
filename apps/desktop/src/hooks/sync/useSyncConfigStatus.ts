import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/query-keys'
import { syncApi } from '@/api/sync-api'
import { isOk } from '@montree/contracts'
import type { SyncConfig, SyncStatus } from '@montree/contracts'

/**
 * 同步配置（表单种子）。仅初始读取；编辑态由组件本地管理，
 * 保存成功后调用方 invalidate 本 key 以同步其他消费方。
 */
export function useSyncConfig() {
  return useQuery({
    queryKey: queryKeys.syncConfig,
    queryFn: async (): Promise<SyncConfig | null> => {
      const result = await syncApi.getConfig()
      return isOk(result) ? result.value : null
    },
    staleTime: Infinity,
  })
}

/**
 * 同步状态快照。初始值走 invoke，此后主进程推送经 setQueryData 写回缓存，
 * 推送才是真值来源（Query 只负责首次拉取与多消费方共享）。
 */
export function useSyncStatus() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.syncStatus,
    queryFn: async (): Promise<SyncStatus> => {
      const result = await syncApi.getStatus()
      return isOk(result) ? result.value : { phase: 'idle' }
    },
    staleTime: Infinity,
  })

  useEffect(() => {
    return syncApi.onStatusChanged((status) => {
      queryClient.setQueryData(queryKeys.syncStatus, status)
    })
  }, [queryClient])

  return {
    status: query.data ?? { phase: 'idle' as const },
    isReady: query.data !== undefined,
  }
}
