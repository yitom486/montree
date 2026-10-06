import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelOcrComponentDownload,
  ensureOcrComponent,
  getOcrComponentStatus,
  onOcrComponentStatus,
} from '@/api/ocr-api'
import { queryKeys } from '@/api/query-keys'
import type { OcrComponentStatus } from '@montree/contracts'

const DEFAULT_STATUS: OcrComponentStatus = {
  phase: 'not-ready',
  progress: 0,
  runtimeReady: false,
  languages: [],
  missingLanguages: ['chi_sim', 'eng'],
}

export function useOcrComponent(enabled = true) {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)

  // 组件状态：初始 invoke + 推送 setQueryData 写回（推送是真值来源）
  const query = useQuery({
    queryKey: queryKeys.ocrComponent,
    queryFn: async (): Promise<OcrComponentStatus> => {
      const result = await getOcrComponentStatus()
      return result.ok ? result.value : DEFAULT_STATUS
    },
    enabled,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!enabled) return
    return onOcrComponentStatus((next) => {
      queryClient.setQueryData(queryKeys.ocrComponent, next)
    })
  }, [enabled, queryClient])

  const status = query.data ?? DEFAULT_STATUS

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.ocrComponent })
  }, [queryClient])

  const download = useCallback(async () => {
    setLoading(true)
    try {
      const result = await ensureOcrComponent()
      if (!result.ok && result.error.code !== 'CANCELLED') {
        return result
      }
      return result
    } finally {
      setLoading(false)
    }
  }, [])

  const cancel = useCallback(async () => {
    const result = await cancelOcrComponentDownload()
    if (result.ok) {
      queryClient.setQueryData(queryKeys.ocrComponent, result.value)
    }
    return result
  }, [queryClient])

  return {
    status,
    loading,
    refresh,
    download,
    cancel,
  }
}
