import { describe, expect, it } from 'vitest'
import { useWorkspaceStore } from './workspace-store'

describe('workspace-store（工作区身份与代际守卫）', () => {
  it('初始身份回落 local/disconnected/0', () => {
    useWorkspaceStore.getState().resetWorkspace()
    const state = useWorkspaceStore.getState()
    expect(state.descriptor).toBeNull()
    expect(state.status).toBeNull()
  })

  it('setConnected 同步描述符与状态', () => {
    useWorkspaceStore.getState().resetWorkspace()
    useWorkspaceStore.getState().setConnected({
      descriptor: {
        id: 'local',
        kind: 'local',
        target: '',
        rootLabel: 'C:\\a',
        displayName: 'a',
      },
      generation: 3,
      status: {
        workspaceId: 'local',
        kind: 'local',
        state: 'connected',
        generation: 3,
        rootLabel: 'C:\\a',
      },
    })
    expect(useWorkspaceStore.getState().descriptor?.rootLabel).toBe('C:\\a')
    expect(useWorkspaceStore.getState().status?.generation).toBe(3)
  })

  it('旧代际推送不覆盖新状态（T6）', () => {
    useWorkspaceStore.getState().resetWorkspace()
    const base = {
      workspaceId: 'local',
      kind: 'local' as const,
      state: 'connected' as const,
      generation: 5,
      rootLabel: 'C:\\a',
    }
    useWorkspaceStore.getState().applyStatus(base)
    useWorkspaceStore.getState().applyStatus({ ...base, generation: 4, state: 'reconnecting' })
    expect(useWorkspaceStore.getState().status?.generation).toBe(5)
    expect(useWorkspaceStore.getState().status?.state).toBe('connected')
    useWorkspaceStore.getState().applyStatus({ ...base, generation: 6, state: 'reconnecting' })
    expect(useWorkspaceStore.getState().status?.state).toBe('reconnecting')
  })
})
