import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { err, ok, type AppError, type Result } from '@yitom/contracts'
import { AGENT_INSPECTION_IPC, type AgentInspectionRequest, type AgentSkillRequest } from '../../contracts/agent-inspection'
import { withAcpWindow } from './acp-window-handlers'
import { acpState, ownsAcpSession } from '../services/acp/acp-state'
import { inspectAgentSession, readSkillDetail, skillRoots } from '../services/acp/agent-inspection'
import { getWindowWorkspaceDescriptor } from '../services/workspace-bindings'
import { currentAcpContext } from '../services/acp/acp-context'

class SessionChangedError extends Error {}

async function scoped<T>(event: IpcMainInvokeEvent, request: AgentInspectionRequest, action: (runtime: string | null, cwd: string | null, validate: () => void) => Promise<T>): Promise<Result<T, AppError>> {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return err({ code: 'FORBIDDEN', message: '仅允许应用主窗口查看 Agent 资源' })
  return withAcpWindow(event.sender, async () => {
    if (request?.sessionId !== undefined && (acpState.sessionId !== request.sessionId || (request.sessionId && !ownsAcpSession(request.sessionId)))) return err({ code: 'ACP_PROTOCOL_ERROR', message: '会话已切换，请刷新后查看当前会话' })
    const workspace = getWindowWorkspaceDescriptor(event.sender.id)
    const cwd = acpState.workspaceRoot ?? (workspace?.kind === 'local' ? workspace.rootLabel : null)
    const runtime = acpState.status === 'connected' ? acpState.runtimeId : (typeof request?.runtimeId === 'string' ? request.runtimeId : acpState.runtimeId)
    const generation = acpState.connectGeneration
    const session = acpState.sessionId
    const owner = currentAcpContext()
    const validate = () => {
      if (owner.closed || generation !== acpState.connectGeneration || session !== acpState.sessionId) throw new SessionChangedError('会话已切换，请刷新后重试')
    }
    try {
      const result = await action(runtime, cwd, validate)
      validate()
      return ok(result)
    }
    catch (error) { return err({ code: error instanceof SessionChangedError ? 'ACP_PROTOCOL_ERROR' : 'UNKNOWN', message: error instanceof Error ? error.message : '读取 Agent 资源失败' }) }
  })
}

export function registerAgentInspectionHandlers(): void {
  ipcMain.handle(AGENT_INSPECTION_IPC.inspect, (event, request: AgentInspectionRequest) => scoped(event, request, (runtime, cwd) => inspectAgentSession(acpState.sessionId, runtime, cwd, request?.includeSkills === true)))
  ipcMain.handle(AGENT_INSPECTION_IPC.skill, (event, request: AgentSkillRequest) => scoped(event, request, (runtime, cwd) => readSkillDetail(skillRoots(runtime, cwd), request?.skillId)))
  ipcMain.handle(AGENT_INSPECTION_IPC.reveal, (event, request: AgentSkillRequest) => scoped(event, request, async (runtime, cwd, validate) => {
    const skill = await readSkillDetail(skillRoots(runtime, cwd), request?.skillId)
    validate()
    shell.showItemInFolder(skill.path)
  }))
}
