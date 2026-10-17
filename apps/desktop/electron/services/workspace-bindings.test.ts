import { describe, expect, it, vi } from 'vitest'
import {
  bindWindowWorkspace,
  ensureWindowWorkspace,
  getWindowWorkspaceDescriptor,
  getWindowWorkspaceStatus,
  isStaleWorkspaceEvent,
  resetWorkspaceBindingsForTest,
  setWindowWorkspaceState,
  unbindWindowWorkspace,
  type BindableSender,
} from './workspace-bindings'
import { makeLocalWorkspaceDescriptor } from '@yitom/contracts'

function fakeSender(id: number): BindableSender {
  return { id, once: vi.fn() }
}

describe('workspace-bindings（可信窗口绑定与代际）', () => {
  it('未绑定时返回 disconnected 默认状态', () => {
    resetWorkspaceBindingsForTest()
    expect(getWindowWorkspaceStatus(999)).toMatchObject({
      workspaceId: 'local',
      state: 'disconnected',
      generation: 0,
    })
    expect(getWindowWorkspaceDescriptor(999)).toBeNull()
  })

  it('绑定分配自增 generation；重绑旧代际过期', () => {
    resetWorkspaceBindingsForTest()
    const first = bindWindowWorkspace(fakeSender(1), makeLocalWorkspaceDescriptor('C:\\a'))
    const second = bindWindowWorkspace(fakeSender(1), makeLocalWorkspaceDescriptor('C:\\b'))
    expect(second.generation).toBe(first.generation + 1)
    expect(
      isStaleWorkspaceEvent(
        { workspaceId: second.workspaceId, generation: second.generation },
        { workspaceId: first.workspaceId, generation: first.generation },
      ),
    ).toBe(true)
  })

  it('同 root 复用绑定（generation 不抖）；换 root 才自增', () => {
    resetWorkspaceBindingsForTest()
    const sender = fakeSender(2)
    const descriptor = makeLocalWorkspaceDescriptor('C:\\a')
    const first = ensureWindowWorkspace(sender, descriptor)
    const same = ensureWindowWorkspace(sender, makeLocalWorkspaceDescriptor('C:\\a'))
    expect(same.generation).toBe(first.generation)
    const moved = ensureWindowWorkspace(sender, makeLocalWorkspaceDescriptor('C:\\b'))
    expect(moved.generation).toBe(first.generation + 1)
  })

  it('状态机流转 connecting → connected → reconnecting → error → disconnected', () => {
    resetWorkspaceBindingsForTest()
    bindWindowWorkspace(fakeSender(3), makeLocalWorkspaceDescriptor('C:\\a'), 'connecting')
    expect(getWindowWorkspaceStatus(3).state).toBe('connecting')
    setWindowWorkspaceState(3, 'connected')
    setWindowWorkspaceState(3, 'reconnecting')
    expect(getWindowWorkspaceStatus(3).state).toBe('reconnecting')
    setWindowWorkspaceState(3, 'error', { code: 'CONNECTION_ERROR', message: '断线' })
    expect(getWindowWorkspaceStatus(3).error?.code).toBe('CONNECTION_ERROR')
    const left = unbindWindowWorkspace(3)
    expect(left.state).toBe('disconnected')
    expect(getWindowWorkspaceStatus(3).state).toBe('disconnected')
  })

  it('窗口销毁自清理当前代际绑定（关 A 不影响 B）', () => {
    resetWorkspaceBindingsForTest()
    const holder: { fn: (() => void) | null } = { fn: null }
    const senderA: BindableSender = { id: 11, once: (_e, listener) => { holder.fn = listener } }
    bindWindowWorkspace(senderA, makeLocalWorkspaceDescriptor('C:\\a'))
    bindWindowWorkspace(fakeSender(12), makeLocalWorkspaceDescriptor('C:\\b'))
    holder.fn?.()
    expect(getWindowWorkspaceStatus(11).state).toBe('disconnected')
    expect(getWindowWorkspaceStatus(12).state).toBe('connected')
  })

  it('缺字段的旧事件不过滤（兼容旧载荷）', () => {
    expect(isStaleWorkspaceEvent({ workspaceId: 'local', generation: 2 }, {})).toBe(false)
    expect(
      isStaleWorkspaceEvent(
        { workspaceId: 'local', generation: 2 },
        { workspaceId: 'local', generation: 2 },
      ),
    ).toBe(false)
  })
})
