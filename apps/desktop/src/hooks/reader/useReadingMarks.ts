import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { readingMarksApi } from '@/api/reading-marks-api'
import { queryKeys } from '@/api/query-keys'
import { isOk } from '@montree/contracts'
import type { CreateReadingMarkPayload, UpdateReadingMarkPayload } from '@montree/contracts'
import { reportAppError } from '@/lib/workspace/report-error'

export function useReadingMarks(filePath: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.readingMarks(filePath),
    queryFn: async () => {
      const result = await readingMarksApi.list(filePath)
      if (!isOk(result)) {
        throw result.error
      }
      return result.value
    },
    enabled: Boolean(filePath),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.readingMarks(filePath) })
    // 札记箱 FTS 搜索缓存同失效（按文件前缀匹配该书全部搜索词）
    void queryClient.invalidateQueries({ queryKey: queryKeys.marksSearchPrefix(filePath) })
  }

  const createMutation = useMutation({
    mutationFn: (payload: CreateReadingMarkPayload) => readingMarksApi.create(payload),
    onSuccess: (result) => {
      if (!isOk(result)) {
        reportAppError(result.error)
        return
      }
      invalidate()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateReadingMarkPayload) => readingMarksApi.update(payload),
    onSuccess: (result) => {
      if (!isOk(result)) {
        reportAppError(result.error)
        return
      }
      invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => readingMarksApi.remove(id),
    onSuccess: (result) => {
      if (!isOk(result)) {
        reportAppError(result.error)
        return
      }
      invalidate()
    },
  })

  return {
    marks: query.data ?? [],
    isLoading: query.isLoading,
    createMark: createMutation.mutateAsync,
    updateMark: updateMutation.mutateAsync,
    deleteMark: deleteMutation.mutateAsync,
  }
}
