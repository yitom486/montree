import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gitApi } from '@/api/git-api'
import { queryKeys } from '@/api/query-keys'
import { useWorkspaceIdentity } from '@/stores/workspace-store'
import type { GitCommitOptions, GitPushOptions } from '@montree/contracts'
import { toast } from 'sonner'

export function useGitStatus(workspaceRoot?: string) {
  const queryClient = useQueryClient()
  // 工作区身份进入 key：同 cwd 在不同工作区是不同仓库状态（T7 防串）。
  const { workspaceId } = useWorkspaceIdentity()
  const enabled = Boolean(workspaceRoot && workspaceRoot.trim())

  const query = useQuery({
    queryKey: queryKeys.gitStatus(workspaceRoot ?? '', workspaceId),
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

  /** B3：分支列表查询（远端经 Ubuntu 执行）。 */
  const branchesQuery = useQuery({
    queryKey: queryKeys.gitBranches(workspaceRoot ?? '', workspaceId),
    queryFn: async () => {
      if (!workspaceRoot) return null
      const res = await gitApi.listBranches(workspaceRoot)
      if (res.ok) return res.value
      return null
    },
    enabled,
    staleTime: 10000,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus(workspaceRoot ?? '', workspaceId) })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus(workspaceRoot ?? '', workspaceId) })
    },
    onError: (error) => {
      toast.error(`提交失败: ${error instanceof Error ? error.message : String(error)}`)
    },
  })

  return {
    status: query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
    branches: branchesQuery.data,
    isBranchesLoading: branchesQuery.isLoading,
    refetchBranches: branchesQuery.refetch,
    push: pushMutation.mutateAsync,
    isPushing: pushMutation.isPending,
    commit: commitMutation.mutateAsync,
    isCommitting: commitMutation.isPending,
  }
}

/** B3：单文件/整树 diff 独立查询（与 status 解耦，远端经 Ubuntu 执行）。 */
export function useGitDiff(workspaceRoot?: string, file?: string, staged = false) {
  const { workspaceId } = useWorkspaceIdentity()
  const enabled = Boolean(workspaceRoot && workspaceRoot.trim())
  const query = useQuery({
    queryKey: queryKeys.gitDiff(workspaceRoot ?? '', file, staged, workspaceId),
    queryFn: async () => {
      if (!workspaceRoot) return null
      const res = await gitApi.getDiff(workspaceRoot, file, staged)
      if (res.ok) return res.value
      return null
    },
    enabled,
    staleTime: 10000,
  })
  return { diff: query.data, isLoading: query.isLoading, refetch: query.refetch }
}

/** B3：分支列表独立查询（供分支切换 UI；远端经 Ubuntu 执行）。 */
export function useGitBranches(workspaceRoot?: string) {
  const { workspaceId } = useWorkspaceIdentity()
  const enabled = Boolean(workspaceRoot && workspaceRoot.trim())
  const query = useQuery({
    queryKey: queryKeys.gitBranches(workspaceRoot ?? '', workspaceId),
    queryFn: async () => {
      if (!workspaceRoot) return null
      const res = await gitApi.listBranches(workspaceRoot)
      if (res.ok) return res.value
      return null
    },
    enabled,
    staleTime: 10000,
  })
  return { branches: query.data, isLoading: query.isLoading, refetch: query.refetch }
}
