import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_INSPECTION_IPC } from '../../contracts/agent-inspection'
import { registerAgentInspectionHandlers } from './agent-inspection-handlers'
import { acpState, claimAcpSession } from '../services/acp/acp-state'
import { getAcpContext, runInAcpContext } from '../services/acp/acp-context'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), inspect: vi.fn(), skill: vi.fn(), reveal: vi.fn(), trusted: true }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => mocks.trusted ? {} : null }, ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn) }, shell: { showItemInFolder: mocks.reveal } }))
vi.mock('./acp-window-handlers', async () => {
  const { runInAcpContext, getAcpContext } = await import('../services/acp/acp-context')
  return { withAcpWindow: (sender: { id: number }, action: () => any) => runInAcpContext(getAcpContext(`inspect-window-${sender.id}`), action) }
})
vi.mock('../services/workspace-bindings', () => ({ getWindowWorkspaceDescriptor: () => ({ kind: 'local', rootLabel: 'trusted-workspace' }) }))
vi.mock('../services/acp/agent-inspection', () => ({ inspectAgentSession: mocks.inspect, readSkillDetail: mocks.skill, skillRoots: (runtime: string, cwd: string) => [{ directory: cwd, source: runtime }] }))

const owner = getAcpContext('inspect-window-1')
const inWindow = <T>(action: () => T) => runInAcpContext(owner, action)
const mainFrame = {}
const event = { sender: { id: 1, mainFrame }, senderFrame: mainFrame }
const invoke = (channel: string, request: any, source = event) => mocks.handlers.get(channel)!(source, request)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.trusted = true
  registerAgentInspectionHandlers()
  inWindow(() => { acpState.sessionId = 'owned'; claimAcpSession('owned'); acpState.runtimeId = 'codex-acp'; acpState.status = 'connected'; acpState.workspaceRoot = null; acpState.connectGeneration = 0 })
  mocks.inspect.mockResolvedValue({ mcps: [] })
  mocks.skill.mockResolvedValue({ path: 'known/SKILL.md' })
})

describe('Agent inspection IPC ownership', () => {
  it('rejects subframes, unknown windows and foreign or stale sessions before reading', async () => {
    expect((await invoke(AGENT_INSPECTION_IPC.inspect, {}, { ...event, senderFrame: {} })).error.code).toBe('FORBIDDEN')
    mocks.trusted = false
    expect((await invoke(AGENT_INSPECTION_IPC.inspect, {})).error.code).toBe('FORBIDDEN')
    mocks.trusted = true
    for (const sessionId of ['foreign', null]) expect((await invoke(AGENT_INSPECTION_IPC.inspect, { sessionId })).error.code).toBe('ACP_PROTOCOL_ERROR')
    expect(mocks.inspect).not.toHaveBeenCalled()
  })

  it('derives runtime and workspace from the sender and drops results after a session switch', async () => {
    expect((await invoke(AGENT_INSPECTION_IPC.inspect, { sessionId: 'owned', runtimeId: 'claude', includeSkills: true })).ok).toBe(true)
    expect(mocks.inspect).toHaveBeenCalledWith('owned', 'codex-acp', 'trusted-workspace', true)
    mocks.inspect.mockImplementation(async () => { acpState.connectGeneration++; return { mcps: [] } })
    expect((await invoke(AGENT_INSPECTION_IPC.inspect, { sessionId: 'owned' })).error.code).toBe('ACP_PROTOCOL_ERROR')
  })

  it('reveals only a rediscovered skill ID; lookup failures never reach the OS', async () => {
    mocks.skill.mockRejectedValueOnce(new Error('not found'))
    expect((await invoke(AGENT_INSPECTION_IPC.reveal, { sessionId: 'owned', skillId: '../../auth.json' })).ok).toBe(false)
    expect(mocks.reveal).not.toHaveBeenCalled()
    expect((await invoke(AGENT_INSPECTION_IPC.reveal, { sessionId: 'owned', skillId: 'known-id' })).ok).toBe(true)
    expect(mocks.reveal).toHaveBeenCalledWith('known/SKILL.md')
  })

  it('does not open an old skill location if the session changes during file lookup', async () => {
    mocks.skill.mockImplementationOnce(async () => { acpState.sessionId = 'new-session'; return { path: 'old/SKILL.md' } })
    expect((await invoke(AGENT_INSPECTION_IPC.reveal, { sessionId: 'owned', skillId: 'known-id' })).error.code).toBe('ACP_PROTOCOL_ERROR')
    expect(mocks.reveal).not.toHaveBeenCalled()
  })
})
