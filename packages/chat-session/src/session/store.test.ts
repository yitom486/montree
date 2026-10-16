import { describe, expect, it, vi } from 'vitest'
import { createChatSessionStore } from './store'
import type { ChatStoragePort, ChatTransportPort } from './types'

function harness() {
  let n = 0
  let t = 1000
  return {
    createId: (role: string) => `${role}-${n++}`,
    now: () => t++,
  }
}

function mockStorage(): ChatStoragePort & { saved: unknown[] } {
  let data: Parameters<ChatStoragePort['save']>[0] | null = null
  const saved: unknown[] = []
  return {
    saved,
    load: () => data,
    save: (snapshot) => {
      data = snapshot
      saved.push(snapshot)
    },
  }
}

function mockTransport(): ChatTransportPort & {
  sendText: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  respondPermission: ReturnType<typeof vi.fn>
} {
  return {
    sendText: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    respondPermission: vi.fn(async () => {}),
  }
}

describe('chat-session 宿主线程接入', () => {
  it('大量后台补建仍保持线程上限，并保留当前可见线程和运行时', () => {
    const store = createChatSessionStore(harness())
    const visible = store.ensureHostThread('visible', 'opencode', true)
    for (let i = 0; i < 45; i++) store.ensureHostThread(`late-${i}`, 'codex-acp')
    expect(store.getState().threads).toHaveLength(40)
    expect(store.getState().activeThreadId).toBe(visible)
    expect(store.getState().threads.some((thread) => thread.id === visible)).toBe(true)
    expect(store.getState().modelConfig.runtimeId).toBe('opencode')
    const late = store.getState().threads.find((thread) => thread.hostThreadId === 'late-44')!
    expect(late.runtimeId).toBe('codex-acp')
  })
})

describe('chat-session store 回合流', () => {
  it('append→chunks→tool→finish→冻结断言', () => {
    const store = createChatSessionStore(harness())
    store.appendUser('hello world')
    store.beginReply()
    store.ingestTextChunk('Hel')
    store.ingestTextChunk('lo')
    store.ingestThoughtChunk('想一下')
    store.ingestToolCall({ toolCallId: 't1', title: '读文件', kind: 'read', status: 'in_progress' })
    store.ingestToolChunk('t1', '内容')

    const before = store.getState()
    const thread = before.threads.find((t) => t.id === before.activeThreadId)!
    expect(thread.title).toBe('hello world')
    expect(thread.feed.messages.map((m) => m.role)).toEqual(['user', 'agent', 'thought', 'tool'])
    expect(thread.feed.messages[1]!.text).toBe('Hello')
    expect(thread.feed.messages[1]!.streaming).toBe(true)

    store.finishTurn()
    const after = store.getState()
    const feed = after.threads.find((t) => t.id === after.activeThreadId)!.feed
    expect(feed.turnSettled).toBe(true)
    expect(feed.messages.every((m) => !m.streaming)).toBe(true)

    // 冻结后迟到 chunk：正文合入但不再点亮 streaming（对齐 core turnSettled 语义）
    store.ingestTextChunk('迟到')
    const late = store.getState().threads.find((t) => t.id === store.getState().activeThreadId)!.feed
    expect(late.messages[late.messages.length - 1]!.text).toBe('迟到')
    expect(late.messages[late.messages.length - 1]!.streaming).toBe(false)
  })

  it('cancelTools 把进行中工具标 cancelled；freezeLight 只收 streaming', () => {
    const store = createChatSessionStore(harness())
    store.beginReply()
    store.ingestToolCall({ toolCallId: 't1', status: 'in_progress' })
    store.cancelTools()
    const tool = store
      .getState()
      .threads[0]!.feed.messages.find((m) => m.toolCallId === 't1')!
    expect(tool.toolStatus).toBe('cancelled')

    store.beginReply()
    store.ingestTextChunk('流')
    store.freezeLight()
    const feed = store.getState().threads[0]!.feed
    expect(feed.messages.every((m) => !m.streaming)).toBe(true)
    expect(feed.turnSettled).toBe(false)
  })
})

describe('线程隔离', () => {
  it('threadId 路由写非 active 线程；switchThread 冻结旧线程', () => {
    const store = createChatSessionStore(harness())
    const first = store.getState().activeThreadId!
    store.appendUser('first')
    const second = store.newThread()
    expect(store.getState().activeThreadId).toBe(second)

    store.ingestTextChunk('给旧线程', first)
    const s = store.getState()
    expect(s.threads.find((t) => t.id === first)!.feed.messages.at(-1)!.text).toBe('给旧线程')
    expect(s.threads.find((t) => t.id === second)!.feed.messages).toHaveLength(0)

    // 切走时旧 active 被轻冻
    store.beginReply()
    store.ingestTextChunk('新区')
    store.switchThread(first)
    const back = store.getState()
    expect(back.activeThreadId).toBe(first)
    expect(back.threads.find((t) => t.id === second)!.feed.messages.every((m) => !m.streaming)).toBe(true)

    // 未知 threadId no-op；切未知线程 no-op
    store.ingestTextChunk('丢弃', 'missing')
    store.switchThread('missing')
    expect(store.getState().activeThreadId).toBe(first)
  })
})

describe('审批单例 + requestId 守卫', () => {
  it('单槽覆盖；requestId 不一致不清空', () => {
    const store = createChatSessionStore(harness())
    store.requestPermission({
      requestId: 1,
      summary: '删文件？',
      options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }],
      toolCallId: 't9',
      toolCall: { title: 'rm', kind: 'delete', status: 'pending' },
    })
    expect(store.getState().pendingPermission?.requestId).toBe(1)
    // toolCall 落时间线（对齐宿主 ingestPermissionRequest 写 tool_call）
    expect(
      store.getState().threads[0]!.feed.messages.some((m) => m.toolCallId === 't9'),
    ).toBe(true)

    store.requestPermission({
      requestId: 2,
      summary: '第二单',
      options: [],
    })
    expect(store.getState().pendingPermission?.requestId).toBe(2)

    store.clearPermission(1)
    expect(store.getState().pendingPermission?.requestId).toBe(2)
    store.clearPermission(2)
    expect(store.getState().pendingPermission).toBeNull()
  })

  it('disconnected/error 清 pending，其余状态不动', () => {
    const store = createChatSessionStore(harness())
    store.requestPermission({ requestId: 7, summary: 'x', options: [] })
    store.setConnectionStatus('connected')
    expect(store.getState().pendingPermission?.requestId).toBe(7)
    store.setConnectionStatus('error')
    expect(store.getState().pendingPermission).toBeNull()

    store.requestPermission({ requestId: 8, summary: 'y', options: [] })
    store.setConnectionStatus('disconnected')
    expect(store.getState().pendingPermission).toBeNull()
  })
})

describe('selectModel/setThinking', () => {
  it('只记 modelConfig，不碰线程', () => {
    const store = createChatSessionStore(harness())
    store.selectModel('grok-4.7')
    store.setThinking('high')
    expect(store.getState().modelConfig).toEqual({
      runtimeId: 'codex-acp',
      modelId: 'grok-4.7',
      thinkingLevel: 'high',
    })
    expect(store.getState().threads).toHaveLength(1)
  })
})

describe('storage round-trip', () => {
  it('落盘后新 store 恢复线程/active/modelConfig，pending 不恢复', () => {
    const storage = mockStorage()
    const a = createChatSessionStore({ ...harness(), storage })
    a.appendUser('记住我')
    a.selectModel('m1')
    a.requestPermission({ requestId: 3, summary: 'z', options: [] })
    expect(storage.saved.length).toBeGreaterThan(0)

    const b = createChatSessionStore({ ...harness(), storage })
    const sb = b.getState()
    expect(sb.threads.find((t) => t.id === sb.activeThreadId)!.feed.messages[0]!.text).toBe('记住我')
    expect(sb.modelConfig.modelId).toBe('m1')
    expect(sb.pendingPermission).toBeNull()
  })
})

describe('transport 占位', () => {
  it('S1 只透出注入的 transport，不调用发送', async () => {
    const transport = mockTransport()
    const store = createChatSessionStore({ ...harness(), transport })
    expect(store.getTransport()).toBe(transport)
    store.appendUser('hi')
    store.finishTurn()
    expect(transport.sendText).not.toHaveBeenCalled()
    expect(transport.cancel).not.toHaveBeenCalled()
    expect(transport.respondPermission).not.toHaveBeenCalled()
    // mock 自身可用（宿主接线时调用）
    await transport.respondPermission(1, 'allow')
    expect(transport.respondPermission).toHaveBeenCalledWith(1, 'allow')
  })
})

describe('subscribe', () => {
  it('变更通知 + 退订', () => {
    const store = createChatSessionStore(harness())
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.appendUser('hi')
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    store.appendUser('again')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('clearActiveThread (P3 追加)', () => {
  it('清空 active 线程 messages，线程本身保留并 emit', () => {
    const store = createChatSessionStore(harness())
    const active = store.getState().activeThreadId!
    store.appendUser('要清空的消息')
    store.beginReply()
    store.ingestTextChunk('草稿')
    expect(
      store.getState().threads.find((t) => t.id === active)!.feed.messages.length,
    ).toBeGreaterThan(0)

    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.clearActiveThread()
    off()

    const s = store.getState()
    expect(s.activeThreadId).toBe(active)
    expect(s.threads.some((t) => t.id === active)).toBe(true)
    expect(s.threads.find((t) => t.id === active)!.feed.messages).toEqual([])
    expect(s.threads.find((t) => t.id === active)!.feed.turnSettled).toBe(false)
    expect(s.threads.find((t) => t.id === active)!.title).toBe('新对话')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('只清 active 线程，其他线程不受影响', () => {
    const store = createChatSessionStore(harness())
    const first = store.getState().activeThreadId!
    store.appendUser('first 线程消息')
    const second = store.newThread()
    store.appendUser('second 线程消息', { threadId: second })
    expect(store.getState().activeThreadId).toBe(second)

    store.clearActiveThread()

    const s = store.getState()
    expect(s.threads.find((t) => t.id === second)!.feed.messages).toEqual([])
    expect(
      s.threads.find((t) => t.id === first)!.feed.messages.map((m) => m.text),
    ).toContain('first 线程消息')
  })
})
