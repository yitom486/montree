import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@yitom/chat-core'
import {
  createChatSessionStore,
  type ChatSessionStore,
} from '@yitom/chat-session'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import {
  mirrorSessionUpdateToPackageStore,
  mirrorThreadActionToPackageStore,
  resetThreadMirrorForTests,
} from './chat-store-mirror'

/**
 * P4b 线程生命周期双跑一致：同一线程动作序列分别走宿主 store 方法与
 * `mirrorThreadActionToPackageStore`，归一化比对 active 线程消息形状。
 *
 * 归一化（id/时间戳/线程 id 一律忽略，只比用户可见内容）：
 * - role/text/streaming/toolCallId/toolStatus/planEntries/turnEnded；
 * - turnSettled（宿主根态 vs 包 active feed）；
 * - 线程计数（全程避开空白草稿修剪分叉：每次新建前先落字）。
 *
 * 已知不对齐（归一化时排除，P4c/后续对齐点）：
 * - `switch` 后 turnSettled：宿主根态清零，包侧各 feed 保留各自收尾态。
 */

interface MessageShape {
  role: ChatMessage['role']
  text: string
  streaming: boolean
  toolCallId: string | null
  toolStatus: string | null
  planEntries: ChatMessage['planEntries'] | null
  turnEnded: boolean
}

function shapeOf(message: ChatMessage): MessageShape {
  return {
    role: message.role,
    text: message.text,
    streaming: message.streaming ?? false,
    toolCallId: message.toolCallId ?? null,
    toolStatus: message.toolStatus != null ? String(message.toolStatus) : null,
    planEntries: message.planEntries ?? null,
    turnEnded: message.turnEnded ?? false,
  }
}

function hostActiveShapes(): MessageShape[] {
  const s = useAcpUiStore.getState()
  const thread = s.threads.find((t) => t.id === s.activeThreadId)
  return (thread?.messages ?? []).map(shapeOf)
}

function packageActiveShapes(pkg: ChatSessionStore): MessageShape[] {
  const s = pkg.getState()
  const thread = s.threads.find((t) => t.id === s.activeThreadId)
  return (thread?.feed.messages ?? []).map(shapeOf)
}

function packageActiveTurnSettled(pkg: ChatSessionStore): boolean {
  const s = pkg.getState()
  return s.threads.find((t) => t.id === s.activeThreadId)?.feed.turnSettled ?? false
}

function hostActiveTitle(): string | null {
  const s = useAcpUiStore.getState()
  return s.threads.find((t) => t.id === s.activeThreadId)?.title ?? null
}

function packageActiveTitle(pkg: ChatSessionStore): string | null {
  const s = pkg.getState()
  return s.threads.find((t) => t.id === s.activeThreadId)?.title ?? null
}

let pkg: ChatSessionStore

beforeEach(() => {
  resetThreadMirrorForTests()
  const fresh = useAcpUiStore.getState().createThread()
  useAcpUiStore.setState({
    prompting: false,
    sessionId: null,
    status: 'disconnected',
    pendingPermission: null,
    pendingMarkProposalSnapshotContents: [],
    pendingReplayUserText: null,
    turnSettled: false,
  })
  const thread = useAcpUiStore.getState().threads.find((t) => t.id === fresh)
  useAcpUiStore.setState({
    threads: thread ? [thread] : useAcpUiStore.getState().threads.slice(0, 1),
    activeThreadId: fresh,
  })
  pkg = createChatSessionStore()
})

describe('chat-store-mirror 线程生命周期双跑', () => {
  it('建/问/答/流/收尾/再建/切/清后归一化一致', () => {
    // 0. 种子问：让初始线程非空，避开宿主修剪空白草稿与包侧计数分叉
    useAcpUiStore.getState().appendUserMessage('种子问')
    mirrorThreadActionToPackageStore(pkg, { kind: 'appendUser', text: '种子问' })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())

    // 1. 建：两侧各 +1 线程且 active 皆空
    const h1 = useAcpUiStore.getState().createThread()
    mirrorThreadActionToPackageStore(pkg, {
      kind: 'create',
      threadId: h1,
      runtimeId: useAcpUiStore.getState().selectedRuntimeId,
    })
    expect(useAcpUiStore.getState().threads.length).toBe(pkg.getState().threads.length)
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(packageActiveShapes(pkg)).toEqual([])

    // 2. 问 + 开场：user 气泡 + 空 agent 占位（streaming）
    useAcpUiStore.getState().appendUserMessage('第一问')
    mirrorThreadActionToPackageStore(pkg, { kind: 'appendUser', text: '第一问' })
    useAcpUiStore.getState().beginAgentReply()
    mirrorThreadActionToPackageStore(pkg, { kind: 'beginReply' })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().map((m) => m.role)).toEqual(['user', 'agent'])
    expect(useAcpUiStore.getState().turnSettled).toBe(false)
    expect(packageActiveTurnSettled(pkg)).toBe(false)
    expect(packageActiveTitle(pkg)).toBe(hostActiveTitle())

    // 3. 流：同一增量双写（复用 P4a 路径）
    for (const update of [
      { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '答' }] },
      { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '案一' }] },
      { sessionUpdate: 'agent_thought_chunk', content: [{ type: 'text', text: '想一下' }] },
    ]) {
      useAcpUiStore.getState().applySessionUpdate(update)
      mirrorSessionUpdateToPackageStore(pkg, update)
    }
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())

    // 4. 收尾：prompt 成功语义即 finishTurn 无 fallback
    useAcpUiStore.getState().finishStreaming()
    mirrorThreadActionToPackageStore(pkg, { kind: 'finish' })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().some((m) => m.streaming)).toBe(false)
    expect(useAcpUiStore.getState().turnSettled).toBe(true)
    expect(packageActiveTurnSettled(pkg)).toBe(true)
    const settledShapes = packageActiveShapes(pkg)

    // 5. 再建 + 切回：宿主 id 经映射翻译到包侧线程
    const h2 = useAcpUiStore.getState().createThread()
    mirrorThreadActionToPackageStore(pkg, {
      kind: 'create',
      threadId: h2,
      runtimeId: useAcpUiStore.getState().selectedRuntimeId,
    })
    expect(useAcpUiStore.getState().threads.length).toBe(pkg.getState().threads.length)
    useAcpUiStore.getState().appendUserMessage('第二问')
    mirrorThreadActionToPackageStore(pkg, { kind: 'appendUser', text: '第二问' })
    useAcpUiStore.getState().switchThread(h1)
    mirrorThreadActionToPackageStore(pkg, { kind: 'switch', threadId: h1 })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(packageActiveShapes(pkg)).toEqual(settledShapes)
    expect(packageActiveTitle(pkg)).toBe(hostActiveTitle())

    useAcpUiStore.getState().switchThread(h2)
    mirrorThreadActionToPackageStore(pkg, { kind: 'switch', threadId: h2 })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(hostActiveShapes().map((m) => m.text)).toEqual(['第二问'])

    // 6. 清：两侧 active 置空收尾，标题同样重置
    useAcpUiStore.getState().clearMessages()
    mirrorThreadActionToPackageStore(pkg, { kind: 'clear' })
    expect(packageActiveShapes(pkg)).toEqual(hostActiveShapes())
    expect(packageActiveShapes(pkg)).toEqual([])
    expect(useAcpUiStore.getState().turnSettled).toBe(false)
    expect(packageActiveTurnSettled(pkg)).toBe(false)
    expect(hostActiveTitle()).toBe('新对话')
    expect(packageActiveTitle(pkg)).toBe('新对话')
  })

  it('未知线程切换 no-op：不写不抛', () => {
    useAcpUiStore.getState().appendUserMessage('留守问')
    mirrorThreadActionToPackageStore(pkg, { kind: 'appendUser', text: '留守问' })
    const before = packageActiveShapes(pkg)
    const beforeActive = pkg.getState().activeThreadId
    mirrorThreadActionToPackageStore(pkg, { kind: 'switch', threadId: 'no-such-thread' })
    expect(packageActiveShapes(pkg)).toEqual(before)
    expect(pkg.getState().activeThreadId).toBe(beforeActive)
  })

  it('线程动作抛错永不阻断主链路', () => {
    const bomb = new Proxy({}, { get(): never { throw new Error('boom') } })
    expect(() =>
      mirrorThreadActionToPackageStore(pkg, { kind: 'appendUser', text: bomb as unknown as string }),
    ).not.toThrow()
    expect(() =>
      mirrorThreadActionToPackageStore(pkg, bomb as unknown as { kind: 'finish' }),
    ).not.toThrow()
    expect(packageActiveShapes(pkg)).toEqual([])
  })
})
