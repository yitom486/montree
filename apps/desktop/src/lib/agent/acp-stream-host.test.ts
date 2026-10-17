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
import { useAnnotationAgentStore } from '@/stores/annotation-agent-store'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@yitom/contracts'
import { getOwnedChatSessionStore, resetOwnedChatSessionStoreForTests } from './chat-session-owner'
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
  it('切线程后定时器自行冲刷也不会将旧缓冲正文写入新线程', () => {
    vi.useFakeTimers()
    const stop = startAcpStreamHost()
    try {
      const host = useAcpUiStore.getState()
      host.appendUserMessage('旧线程')
      host.setSession('buffer-old')
      host.beginAgentReply()
      for (const listener of listeners.update) listener({ sessionId: 'buffer-old', update: {
        sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '旧缓冲尾巴' }],
      } })
      host.createThread()
      useAcpUiStore.getState().setSession('buffer-new')
      vi.advanceTimersByTime(100)
      expect(activeAgentText()).toBe('')
      const pkg = getOwnedChatSessionStore().getState()
      expect(pkg.threads.find(t => t.id === pkg.activeThreadId)!.feed.messages).toEqual([])
    } finally { stop(); vi.useRealTimers() }
  })

  it('同线程换session后丢弃旧缓冲，保留新session正文', () => {
    const stop = startAcpStreamHost()
    try {
      const host = useAcpUiStore.getState()
      host.createThread()
      host.setSession('session-before')
      for (const listener of listeners.update) listener({ sessionId: 'session-before', update: {
        sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '旧session尾巴' }],
      } })
      host.setSession('session-after')
      for (const listener of listeners.update) listener({ sessionId: 'session-after', update: {
        sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '新session正文' }],
      } })
      flushAcpStreamBuffer()
      expect(activeAgentText()).toBe('新session正文')
    } finally { stop() }
  })

  it.each(['agent_message_chunk', 'agent_thought_chunk'])('包 store 重建后的首个 %s 不重复追加', async (kind) => {
    const host = useAcpUiStore.getState()
    host.createThread()
    host.setSession('sid-main')
    host.appendUserMessage('重启后继续')
    host.beginAgentReply()
    resetOwnedChatSessionStoreForTests()
    const stop = startAcpStreamHost()
    for (const listener of listeners.update) {
      listener({ sessionId: 'sid-main', update: { sessionUpdate: kind, content: [{ type: 'text', text: '首个增量' }] } })
    }
    await settleFlush()
    const state = getOwnedChatSessionStore().getState()
    const messages = state.threads.find(t => t.id === state.activeThreadId)!.feed.messages
    const role = kind === 'agent_thought_chunk' ? 'thought' : 'agent'
    expect(messages.filter(m => m.role === role).map(m => m.text).join('')).toBe('首个增量')
    stop()
  })

  it('恢复定居只冻结一次，不终结包回合，后续合法消息继续流式更新', async () => {
    const host = useAcpUiStore.getState()
    host.createThread()
    host.setSession('sid-main')
    host.appendUserMessage('历史问题')
    host.beginAgentReply()
    const stop = startAcpStreamHost()
    emitTextChunk('历史回复')
    await settleFlush()
    for (const listener of listeners.update) {
      listener({ sessionId: 'sid-main', update: { sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND } })
    }
    const pkg = getOwnedChatSessionStore()
    const activeFeed = () => {
      const state = pkg.getState()
      return state.threads.find(t => t.id === state.activeThreadId)!.feed
    }
    expect(useAcpUiStore.getState().turnSettled).toBe(false)
    expect(activeFeed().turnSettled).toBe(false)
    expect(activeFeed().messages.every(m => !m.streaming)).toBe(true)
    emitTextChunk('继续输出')
    await settleFlush()
    expect(activeFeed().messages.findLast(m => m.role === 'agent')?.streaming).toBe(true)
    expect(activeFeed().messages.findLast(m => m.role === 'agent')?.text).toContain('继续输出')
    stop()
  })

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

  it('切线程后旧会话的迟到事件不进入新线程', async () => {
    const stop = startAcpStreamHost()
    const host = useAcpUiStore.getState()
    host.appendUserMessage('旧线程问题')
    host.setSession('sid-old')
    const oldThreadId = useAcpUiStore.getState().activeThreadId

    host.createThread()
    useAcpUiStore.getState().setSession('sid-new')
    const newThreadId = useAcpUiStore.getState().activeThreadId
    expect(newThreadId).not.toBe(oldThreadId)

    const before = activeAgentText()
    for (const listener of listeners.update) {
      listener({
        sessionId: 'sid-old',
        update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '旧会话迟到' }] },
      })
    }
    await settleFlush()
    expect(activeAgentText()).toBe(before)

    for (const listener of listeners.update) {
      listener({
        sessionId: 'sid-new',
        update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '新会话正文' }] },
      })
    }
    await settleFlush()
    expect(activeAgentText()).toContain('新会话正文')
    stop()
  })

  it('过期会话的迟到工具调用不进入新线程', async () => {
    const stop = startAcpStreamHost()
    const host = useAcpUiStore.getState()
    host.appendUserMessage('旧线程问题')
    host.setSession('sid-old')

    host.createThread()
    useAcpUiStore.getState().setSession('sid-new')
    const newThreadId = useAcpUiStore.getState().activeThreadId

    for (const listener of listeners.update) {
      listener({
        sessionId: 'sid-old',
        update: { sessionUpdate: 'tool_call', toolCallId: 'late-tool', title: '迟到工具', kind: 'read', status: 'completed' },
      })
    }
    await settleFlush()
    const fresh = useAcpUiStore.getState().threads.find((t) => t.id === newThreadId)!
    expect(fresh.messages.some((m) => m.toolCallId === 'late-tool')).toBe(false)
    stop()
  })

  it('过期会话的定居标记不冲刷旧文、不冻结新线程', async () => {
    const stop = startAcpStreamHost()
    const host = useAcpUiStore.getState()
    host.appendUserMessage('旧线程问题')
    host.setSession('sid-old')
    host.beginAgentReply()
    for (const listener of listeners.update) {
      listener({
        sessionId: 'sid-old',
        update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '旧文' }] },
      })
    }
    // 旧文仍在合并器里；切线程 + 新会话
    host.createThread()
    useAcpUiStore.getState().setSession('sid-new')
    const newThreadId = useAcpUiStore.getState().activeThreadId

    for (const listener of listeners.update) {
      listener({ sessionId: 'sid-old', update: { sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND } })
    }
    // 定居标记本身不得冲刷合并器、不得冻结：新线程保持空白。
    const fresh = useAcpUiStore.getState().threads.find((t) => t.id === newThreadId)!
    expect(fresh.messages).toHaveLength(0)
    flushAcpStreamBuffer()
    expect(activeAgentText()).toBe('')
    stop()
  })

  it('工具调用经流式宿主进包时携带宿主采集的提议 fallback', async () => {
    const stop = startAcpStreamHost()
    try {
      const host = useAcpUiStore.getState()
      host.appendUserMessage('带提议的问题')
      host.setSession('sid-main')
      host.beginAgentReply()
      for (const listener of listeners.update) {
        listener({ sessionId: 'sid-main', update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '答' }] } })
      }
      await settleFlush()
      host.finishStreaming()
      useAnnotationAgentStore.setState({
        proposeHost: 'main-agent',
        pendingDraft: { fileKey: 'f1', excerpt: 'e', note: 'n', source: 'ai' },
      })
      for (const listener of listeners.update) {
        listener({ sessionId: 'sid-main', update: { sessionUpdate: 'tool_call', toolCallId: 't-fb', title: '读', kind: 'read', status: 'completed' } })
      }
      const hostThreadId = useAcpUiStore.getState().activeThreadId
      const pkgThread = getOwnedChatSessionStore().getState().threads.find((t) => t.hostThreadId === hostThreadId)!
      expect(
        pkgThread.feed.messages.filter((m) =>
          (m.markProposals ?? []).some((e) => e.proposal.id === 'main:f1'),
        ).length,
      ).toBeGreaterThan(0)
      const hostThread = useAcpUiStore.getState().threads.find((t) => t.id === hostThreadId)!
      expect(
        hostThread.messages.filter((m) =>
          (m.markProposals ?? []).some((e) => e.proposal.id === 'main:f1'),
        ).length,
      ).toBeGreaterThan(0)
    } finally {
      useAnnotationAgentStore.setState({ proposeHost: null, pendingDraft: null })
      stop()
    }
  })
})

