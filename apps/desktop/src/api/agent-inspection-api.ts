import type { AgentInspectionAPI, AgentInspectionRequest, AgentSkillRequest } from '../../contracts/agent-inspection'

function bridge(): AgentInspectionAPI {
  if (!window.montreeAgentInspection) throw new Error('资源详情接口未就绪，请完全重启应用后重试')
  return window.montreeAgentInspection
}
export const agentInspectionApi = {
  async inspect(request: AgentInspectionRequest) {
    const result = await bridge().inspect(request)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  },
  async skill(request: AgentSkillRequest) {
    const result = await bridge().skill(request)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  },
  async reveal(request: AgentSkillRequest) {
    const result = await bridge().reveal(request)
    if (!result.ok) throw new Error(result.error.message)
  },
}
