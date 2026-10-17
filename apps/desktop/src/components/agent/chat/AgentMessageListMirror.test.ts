// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentMessageList } from './AgentMessageList'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import {
  getOwnedChatSessionStore,
  resetOwnedChatSessionStoreForTests,
} from '@/lib/agent/chat-session-owner'
import {
  flushAcpStreamBuffer,
  resetAcpStreamHostForTests,
  startAcpStreamHost,
} from '@/lib/agent/acp-stream-host'

const stream = vi.hoisted(() => ({
  onUpdate: null as ((event: { sessionId: string; update: Record<string, unknown> }) => void) | null,
}))

// 只替换 IPC 传输边界；生产订阅、合并器、映射、双 store 与消息渲染均保持真实。
vi.mock('@/api/acp-api', () => ({ acpApi: {
  onSessionUpdate: (callback: typeof stream.onUpdate) => {
    stream.onUpdate = callback
    return () => { stream.onUpdate = null }
  },
  onStatusChanged: () => () => {},
} }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 包事件更新驱动全部面板，宿主不再选择独立消息数组。
describe('AgentMessageList 包权威读源', () => {
  let container: HTMLDivElement
  let root: Root

  function seedHostOnlyThread() {
    useAcpUiStore.setState({
      threads: [
        {
          id: 'host-only',
          title: '宿主线程',
          createdAt: 1,
          updatedAt: 1,
          messages: [
            { id: 'h1', role: 'user', text: '宿主独有问题', createdAt: 1000 },
          ] as AcpChatMessage[],
        },
      ],
      activeThreadId: 'host-only',
    } as never)
  }

  function seedPackageMirror() {
    const pkg = getOwnedChatSessionStore()
    const thread = pkg.getState().threads.find(t => t.hostThreadId === 'host-only')!
    pkg.switchThread(thread.id)
    pkg.clearActiveThread()
    pkg.appendUser('包权威问题')
    pkg.beginReply()
    pkg.ingestTextChunk('包权威回答')
  }

  beforeEach(() => {
    resetAcpStreamHostForTests()
    resetOwnedChatSessionStoreForTests()
    localStorage.clear()
    useAcpUiStore.setState({ prompting: false, pendingPermission: null, turnSettled: false, sessionId: null, selectedRuntimeId: 'codex-acp', chatScrollByThread: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    seedHostOnlyThread()
    seedPackageMirror()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    resetAcpStreamHostForTests()
    getOwnedChatSessionStore().clearActiveThread()
    useAcpUiStore.setState({
      threads: [],
      activeThreadId: '',
      chatScrollByThread: {},
    } as never)
  })

  async function renderList() {
    const hostRef = createRef<HTMLDivElement>()
    await act(async () => {
      root.render(
        createElement(
          'div',
          { ref: hostRef },
          createElement(AgentMessageList, {
            messagesRef: hostRef,
            bottomRef: createRef<HTMLDivElement>(),
            authHint: null,
          }),
        ),
      )
    })
  }

  it('包镜像消息正常渲染，宿主消息不渲染', async () => {
    await renderList()
    const text = container.textContent ?? ''
    expect(text).toContain('包权威问题')
    expect(text).toContain('包权威回答')
    expect(text).not.toContain('宿主独有问题')
  })

  it('生产流式订阅将首次发送、附件和 mock 模型 chunk 同步至侧栏，每条消息只出现一次', async () => {
    // 清单例模拟首次打开：owner 先用宿主快照恢复，再由本次动作追加。
    resetOwnedChatSessionStoreForTests()
    const hostThreadId = useAcpUiStore.getState().createThread()
    useAcpUiStore.getState().setSession('session-main')
    startAcpStreamHost()
    await renderList()
    await act(async () => {
      useAcpUiStore.getState().appendUserMessage('请看附件', [
        { id: 'file-1', kind: 'file', name: 'chapter.pdf', mimeType: 'application/pdf', absolutePath: 'D:/books/chapter.pdf' },
        { id: 'image-1', kind: 'image', name: 'diagram.png', mimeType: 'image/png', previewUrl: 'data:image/png;base64,dGVzdA==' },
      ])
      useAcpUiStore.getState().beginAgentReply()
    })
    expect(container.textContent).toContain('chapter.pdf')
    expect(container.textContent).toContain('diagram.png')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,dGVzdA==')

    await act(async () => {
      stream.onUpdate!({ sessionId: 'session-main', update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '已阅读' }] } })
      stream.onUpdate!({ sessionId: 'session-main', update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '附件内容' }] } })
      flushAcpStreamBuffer()
    })
    // Streamdown 的流式排字异步提交；观察最终 DOM，避免把同步 store 更新当成已绘制。
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toContain('已阅读附件内容')
    })
    await act(async () => { useAcpUiStore.getState().finishStreaming() })

    const pkg = getOwnedChatSessionStore()
    const thread = pkg.getState().threads.find((t) => t.hostThreadId === hostThreadId)!
    expect(thread.feed.messages.map((message) => message.text)).toEqual(['请看附件', '已阅读附件内容'])
    expect(thread.feed.messages[0]!.attachments?.map((attachment) => attachment.name)).toEqual(['chapter.pdf', 'diagram.png'])
    expect(thread.feed.messages.every((message) => !message.streaming)).toBe(true)
    expect(container.querySelectorAll('[data-acp-probe="user"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-acp-probe="agent"]')).toHaveLength(1)
  })

  it('重建持久化包 store 后历史切换展示正确线程，过期 session 的模型消息不串入续聊', async () => {
    resetOwnedChatSessionStoreForTests()
    const a = useAcpUiStore.getState().createThread()
    useAcpUiStore.getState().appendUserMessage('A 历史问题', [{ id: 'a-file', kind: 'file', name: 'A.pdf', mimeType: 'application/pdf' }])
    const b = useAcpUiStore.getState().createThread()
    useAcpUiStore.getState().appendUserMessage('B 历史问题')
    const storedCount = getOwnedChatSessionStore().getState().threads.length
    resetOwnedChatSessionStoreForTests()
    await renderList()
    expect(container.textContent).toContain('B 历史问题')

    await act(async () => {
      useAcpUiStore.getState().switchThread(a)
      useAcpUiStore.getState().setSession('session-a')
    })
    expect(container.textContent).toContain('A 历史问题')
    expect(container.textContent).toContain('A.pdf')
    expect(container.textContent).not.toContain('B 历史问题')
    startAcpStreamHost()
    await act(async () => {
      useAcpUiStore.getState().appendUserMessage('A 继续提问')
      useAcpUiStore.getState().beginAgentReply()
      stream.onUpdate!({ sessionId: 'session-retired-b', update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '错误线程尾包' }] } })
      stream.onUpdate!({ sessionId: 'session-a', update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: 'A 续聊回答' }] } })
      flushAcpStreamBuffer()
      useAcpUiStore.getState().finishStreaming()
    })
    expect(container.textContent).toContain('A 续聊回答')
    expect(container.textContent).not.toContain('错误线程尾包')
    const state = getOwnedChatSessionStore().getState()
    expect(state.threads).toHaveLength(storedCount)
    expect(state.threads.find((t) => t.hostThreadId === a)!.feed.messages.map((m) => m.text)).toEqual(['A 历史问题', 'A 继续提问', 'A 续聊回答'])
    expect(state.threads.find((t) => t.hostThreadId === b)!.feed.messages.map((m) => m.text)).toEqual(['B 历史问题'])

    await act(async () => { useAcpUiStore.getState().switchThread(b) })
    expect(container.textContent).toContain('B 历史问题')
    expect(container.textContent).not.toContain('A 续聊回答')
  })
})
