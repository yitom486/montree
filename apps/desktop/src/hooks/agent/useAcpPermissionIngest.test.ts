import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listeners = vi.hoisted(() => ({
  permission: new Set<(event: Record<string, unknown>) => void>(),
  status: new Set<(event: Record<string, unknown>) => void>(),
}))

vi.mock('@/api/acp-api', () => ({
  acpApi: {
    onPermissionRequest: (callback: (event: Record<string, unknown>) => void) => {
      listeners.permission.add(callback)
      return () => listeners.permission.delete(callback)
    },
    onStatusChanged: (callback: (event: Record<string, unknown>) => void) => {
      listeners.status.add(callback)
      return () => listeners.status.delete(callback)
    },
  },
}))

import { useAcpUiStore } from '@/stores/acp-ui-store'
import { getOwnedChatSessionStore } from '@/lib/agent/chat-session-owner'
import { startAcpPermissionIngest } from './useAcpPermissionIngest'

beforeEach(() => {
  listeners.permission.clear()
  listeners.status.clear()
  useAcpUiStore.getState().createThread()
  useAcpUiStore.getState().clearPendingPermission()
})

afterEach(() => vi.restoreAllMocks())

describe('permission ingest with a single feed owner', () => {
  it('writes the permission tool once and leaves the approval slot with the host', () => {
    const stop = startAcpPermissionIngest()
    const pkg = getOwnedChatSessionStore()
    const dispatch = vi.spyOn(pkg, 'dispatchFeedEvent')
    const event = {
      requestId: 101,
      summary: '读取文件',
      toolCall: { toolCallId: 'permission-tool', title: '读取文件', kind: 'read' },
      options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }],
    }
    try {
      for (const listener of listeners.permission) listener(event)
      expect(dispatch).toHaveBeenCalledTimes(1)
      const host = useAcpUiStore.getState()
      expect(host.pendingPermission?.requestId).toBe(101)
      const messages = host.threads.find(t => t.id === host.activeThreadId)!.messages
      expect(messages.filter(m => m.toolCallId === 'permission-tool')).toHaveLength(1)
      const owner = pkg.getState().threads.find(t => t.id === host.activeThreadId || t.hostThreadId === host.activeThreadId)!
      expect(messages).toBe(owner.feed.messages)
      for (const listener of listeners.status) listener({ status: 'error' })
      expect(useAcpUiStore.getState().pendingPermission).toBeNull()
    } finally {
      stop()
    }
  })

  it('unsubscribes both event streams on teardown', () => {
    const stop = startAcpPermissionIngest()
    expect(listeners.permission.size).toBe(1)
    expect(listeners.status.size).toBe(1)
    stop()
    expect(listeners.permission.size).toBe(0)
    expect(listeners.status.size).toBe(0)
  })
})
