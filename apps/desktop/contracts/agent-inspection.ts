import type { AppError, Result } from '@yitom/contracts'

export const AGENT_INSPECTION_IPC = {
  inspect: 'agent:inspect-session',
  skill: 'agent:inspect-skill',
  reveal: 'agent:reveal-skill',
} as const

export interface AgentInspectionRequest { sessionId?: string | null; runtimeId?: string; includeSkills?: boolean }
export interface AgentSkillRequest extends AgentInspectionRequest { skillId: string }
export interface InspectedSkill {
  id: string
  name: string
  description: string
  source: string
  path: string
  bytes: number
  modifiedAt: string
}
export interface SkillDetail extends InspectedSkill { content: string }
export interface InspectedMcp {
  id: string
  name: string
  transport: 'stdio'
  endpoint: string
  attached: boolean
  status: 'connected' | 'discovered' | 'waiting' | 'inactive'
  activeClients: number
  discoveries: number
  disconnects: number
  lastDiscoveredAt: string | null
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
}
export interface AgentInspection {
  sessionId: string | null
  runtimeId: string | null
  agentName: string | null
  agentVersion: string | null
  connectionStatus: string
  workspace: string | null
  observedAt: string
  mcps: InspectedMcp[]
  skills: InspectedSkill[]
  warnings: string[]
  mcpCoverage: string
  skillsCoverage: string
}
export interface AgentInspectionAPI {
  inspect: (request: AgentInspectionRequest) => Promise<Result<AgentInspection, AppError>>
  skill: (request: AgentSkillRequest) => Promise<Result<SkillDetail, AppError>>
  reveal: (request: AgentSkillRequest) => Promise<Result<void, AppError>>
}
