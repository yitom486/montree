import { useQuery } from '@tanstack/react-query'
import { agentInspectionApi } from '@/api/agent-inspection-api'
import { queryKeys } from '@/api/query-keys'

export interface AgentInspectionContext { threadId: string; sessionId: string | null; runtimeId: string }
export function useAgentInspection(context: AgentInspectionContext, kind: 'mcp' | 'skills' | null) {
  return useQuery({
    queryKey: queryKeys.agentInspection(context.threadId, context.sessionId, context.runtimeId, kind),
    queryFn: () => agentInspectionApi.inspect({ sessionId: context.sessionId, runtimeId: context.runtimeId, includeSkills: kind === 'skills' }),
    enabled: kind !== null,
    refetchInterval: kind === 'mcp' ? 3000 : false,
    staleTime: 0,
    // 会话切换/首次扫描存在瞬时空窗；让查询自行恢复一次，不把面板永久钉在错误态。
    retry: 1,
    retryDelay: 400,
  })
}
export function useAgentSkill(context: AgentInspectionContext, skillId: string | null) {
  return useQuery({
    queryKey: queryKeys.agentSkill(context.threadId, context.sessionId, context.runtimeId, skillId),
    queryFn: () => agentInspectionApi.skill({ sessionId: context.sessionId, runtimeId: context.runtimeId, skillId: skillId! }),
    enabled: skillId !== null,
    staleTime: 0,
    retry: 1,
    retryDelay: 400,
  })
}
