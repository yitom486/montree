import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/query-keys'
import { defaultQuizRepository } from '@/lib/quiz/quiz-storage-jsonl'
import type { QuizSessionRecord } from '@montree/contracts'

/**
 * 按书籍路径读取测验历史（JSONL 仓储）。
 * 读经 TanStack Query 缓存；写入侧（appendSession）后调用方须 invalidate。
 */
export function useQuizSessions(filePath: string, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.quizSessions(filePath),
    queryFn: async (): Promise<QuizSessionRecord[]> => {
      return await defaultQuizRepository.getSessionsByFile(filePath)
    },
    enabled: enabled && Boolean(filePath),
  })

  return {
    sessions: query.data ?? [],
    isLoading: query.isPending,
    error: query.error,
  }
}

/** 测验记录落库后刷新历史缓存 */
export function invalidateQuizSessions(queryClient: ReturnType<typeof useQueryClient>, filePath: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.quizSessions(filePath) })
}
