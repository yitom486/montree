import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gitApi } from '@/api/git-api'
import { queryKeys } from '@/api/query-keys'
import type { GitCommitOptions, GitPushOptions } from '@montree/contracts'
import { toast } from 'sonner'

export function useGitStatus(workspaceRoot?: string) {
  const queryClient = useQueryClient()
  const enabled = Boolean(workspaceRoot && workspaceRoot.trim())

  const query = useQuery({
    queryKey: queryKeys.gitStatus(workspaceRoot ?? ''),
    queryFn: async () => {
      if (!workspaceRoot) return null
      const res = await gitApi.getStatus(workspaceRoot)
      if (res.ok) return res.value
      return null
    },
    enabled,
    staleTime: 5000,
    refetchOnWindowFocus: true,
  })

  const pushMutation = useMutation({
    mutationFn: async (options?: GitPushOptions) => {
      if (!workspaceRoot) throw new Error('未打开工作区')
      const res = await gitApi.push(workspaceRoot, options)
      if (!res.ok) {
        throw new Error(res.error.message || 'Git 推送失败')
      }
      return res.value
    },
    onSuccess: () => {
      toast.success('已成功推送至远程仓库')
      queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus(workspaceRoot ?? '') })
    },
    onError: (error) => {
      toast.error(`推送失败: ${error instanceof Error ? error.message : String(error)}`)
    },
  })

  const commitMutation = useMutation({
    mutationFn: async (options: GitCommitOptions) => {
      if (!workspaceRoot) throw new Error('未打开工作区')
      const res = await gitApi.commit(workspaceRoot, options)
      if (!res.ok) {
        throw new Error(res.error.message || 'Git 提交失败')
      }
      return res.value
    },
    onSuccess: (data) => {
      toast.success(`提交成功 (${data.commitHash ?? 'HEAD'})`)
      queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus(workspaceRoot ?? '') })
    },
    onError: (error) => {
      toast.error(`提交失败: ${error instanceof Error ? error.message : String(error)}`)
    },
  })

  return {
    status: query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
    push: pushMutation.mutateAsync,
    isPushing: pushMutation.isPending,
    commit: commitMutation.mutateAsync,
    isCommitting: commitMutation.isPending,
  }
}
