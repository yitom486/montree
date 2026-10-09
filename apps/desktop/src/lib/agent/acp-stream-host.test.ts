import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners = {
  status: new Set<(event: Record<string, unknown>) => void>(),
  update: new Set<(event: Record<string, unknown>) => void>(),
}

vi.mock('@/api/acp-api', () => ({
  acpApi: {
    onStatusChanged: vi.fn((callback: (event: Record<string, unknown>) => void) => {
      listeners.status.add(callback)
      return () => {
        listeners.status.delete(callback)
      }
    }),
    onSessionUpdate: vi.fn((callback: (event: Record<string, unknown>) => void) => {
      listeners.update.add(callback)
      return () => {
        listeners.update.delete(callback)
      }
    }),
  },
}))

import { acpApi } from '@/api/acp-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import {
  flushAcpStreamBuffer,
  registerStreamAuthReset,
  resetAcpStreamHostForTests,
  startAcpStreamHost,
} from './acp-stream-host'

const mockedOnUpdate = vi.mocked(acpApi.onSessionUpdate)

function activeAgentText(): string {
  const s = useAcpUiStore.getState()
  const thread = s.threads.find((t) => t.id === s.activeThreadId)
  return (thread?.messages ?? [])
    .filter((m) => m.role === 'agent')
    .map((m) => m.text)
    .join('\n')
}

function emitTextChunk(text: string): void {
  for (const listener of listeners.update) {
    listener({
      sessionId: 'sid-main',
      update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text }] },
    })
  }
}

async function settleFlush(): Promise<void> {
  flushAcpStreamBuffer()
  await new Promise((r) => setTimeout(r, 10))
}

beforeEach(() => {
  resetAcpStreamHostForTests()
  listeners.status.clear()
  listeners.update.clear()
  vi.clearAllMocks()
})

describe('acp-stream-host（应用级单例订阅）', () => {
  it('重复 start 只订一份：同一 chunk 只进一次时间线', async () => {
    const stopA = startAcpStreamHost()
    const stopB = startAcpStreamHost()
    // 同一 stop 句柄：App 只持一份，不玩引用计数
    expect(stopA).toBe(stopB)
    expect(listeners.update.size).toBe(1)

    const before = activeAgentText()
    emitTextChunk('复读测试')
    await settleFlush()
    const after = activeAgentText()
    const added = after.slice(before.length)
    // 恰好一份：出现一次，且不是双份拼接
    expect(added).toContain('复读测试')
    expect(added).not.toContain('复读测试复读测试')

    stopA()
    stopB()
  })

  it('全部 stop 后推送静默（显式停止才退订）', async () => {
    const stop = startAcpStreamHost()
    stop()
    expect(listeners.update.size).toBe(0)

    const before = activeAgentText()
    emitTextChunk('无人应答')
    await settleFlush()
    expect(activeAgentText()).toBe(before)
  })

  it('断开时清认证回调注册表：已卸载实例收不到清理', async () => {
    const resetA = vi.fn()
    const resetB = vi.fn()
    const stop = startAcpStreamHost()
    const unregisterA = registerStreamAuthReset({ resetAuthUi: resetA })
    registerStreamAuthReset({ resetAuthUi: resetB })
    unregisterA()

    for (const listener of listeners.status) {
      listener({ status: 'disconnected' })
    }
    expect(resetA).not.toHaveBeenCalled()
    expect(resetB).toHaveBeenCalledTimes(1)
    stop()
  })

  it('非当前主会话的 sessionId 更新坚决丢弃，绝不污染主会话时间线', async () => {
    const stop = startAcpStreamHost()
    useAcpUiStore.getState().setSession('sid-main', [])

    const before = activeAgentText()
    for (const listener of listeners.update) {
      listener({
        sessionId: 'sid-orphan-subsession',
        update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '污染文本' }] },
      })
    }
    await settleFlush()
    expect(activeAgentText()).toBe(before)
    stop()
  })
})

