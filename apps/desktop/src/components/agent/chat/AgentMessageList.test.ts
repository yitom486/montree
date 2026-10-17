// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentMessageList, formatUsageText } from './AgentMessageList'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { updateOwnedChatThreadMessages } from '@/lib/agent/chat-session-authority'
import { getOwnedChatSessionStore, resetOwnedChatSessionStoreForTests } from '@/lib/agent/chat-session-owner'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * AgentMessageList 宿主薄适配接线（C6）：通用列表编排由包 `ChatMessageList` 实现，
 * 此处只锁定宿主职责——包 feed 渲染、业务槽位、审批执行、章节回调、ref/右键接线与滚动落盘。
 * 分页/跟滚/恢复行为由包侧单测覆盖，不在此重复；右键菜单打开由真实 Electron（E2E）覆盖，
 * 此处只断言接线（ref 落点 + 事件无异常），不断言 happy-dom 下环境相关的 Radix 提交时序。
 */
describe('AgentMessageList 宿主接线', () => {
  let container: HTMLDivElement
  let root: Root
  const queryClient = new QueryClient()

  const makeMessages = (count: number, prefix = 'm'): AcpChatMessage[] =>
    Array.from({ length: count }, (_, i) => {
      const n = String(i + 1).padStart(2, '0')
      return {
        id: `${prefix}${n}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        text: `正文${prefix}${n}`,
        createdAt: 1000 + i,
      }
    }) as AcpChatMessage[]

  function seedThread(threadId: string, messages: AcpChatMessage[]) {
    useAcpUiStore.setState({
      threads: [{ id: threadId, title: 't', createdAt: 1, updatedAt: 1, messages }],
      activeThreadId: threadId,
    } as never)
    updateOwnedChatThreadMessages({ id: threadId, title: 't' }, messages, false)
    getOwnedChatSessionStore().switchThread(threadId)
  }

  beforeEach(() => {
    localStorage.clear()
    resetOwnedChatSessionStoreForTests()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    useAcpUiStore.setState({
      threads: [],
      activeThreadId: '',
      chatScrollByThread: {},
      pendingPermission: null,
    } as never)
  })

  async function renderList(props: {
    onChapterPlanSelect?: (payload: { entry: { id: string } }) => void
    onQuote?: (text: string) => void
    authHint?: string | null
    runtimeName?: string
  } = {}) {
    const messagesRef = createRef<HTMLDivElement>()
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentMessageList, {
            messagesRef,
            bottomRef: createRef<HTMLDivElement>(),
            authHint: props.authHint ?? null,
            runtimeName: props.runtimeName,
            onChapterPlanSelect: props.onChapterPlanSelect as never,
            onQuote: props.onQuote,
          }),
        ),
      )
    })
    return messagesRef
  }

  function viewport(): HTMLElement {
    const el = container.querySelector('[data-testid="chat-viewport"]')
    if (!(el instanceof HTMLElement)) throw new Error('viewport 缺失')
    return el
  }

  it('包 feed 正文正常渲染', async () => {
    seedThread('t1', makeMessages(3))
    await renderList()
    expect(container.textContent).toContain('正文m01')
    expect(container.textContent).toContain('正文m03')
  })

  it('空态展示运行时名与认证提示', async () => {
    seedThread('t1', [])
    await renderList({ authHint: '已检测到本机 Codex 登录', runtimeName: 'Codex' })
    expect(container.textContent).toContain('开始与 Codex 对话')
    expect(container.textContent).toContain('已检测到本机 Codex 登录')
  })

  it('图表业务槽接入且只渲染一次', async () => {
    const diagram = JSON.stringify({ diagramId: 'd1', diagramType: 'flowchart', title: '推演', summary: '摘要', mermaidCode: 'graph TD; A-->B' })
    seedThread('t1', [
      { id: 'u1', role: 'user', text: '画图', createdAt: 1 },
      { id: 't1', role: 'tool', text: diagram, createdAt: 2, updatedAt: 3, streaming: false, toolCallId: 'tc-1', toolKind: 'other', toolTitle: 'montree_generate_diagram', toolStatus: 'completed', toolContentText: diagram },
    ] as AcpChatMessage[])
    await renderList()
    expect(container.querySelectorAll('[data-testid="diagram-viewer-card"]')).toHaveLength(1)
  })

  it('孤立审批经宿主执行且只出现一次', async () => {
    seedThread('t1', makeMessages(2))
    useAcpUiStore.setState({
      pendingPermission: {
        requestId: 9,
        toolCallId: 'ghost-tool',
        summary: '执行命令',
        options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }],
      },
    } as never)
    await renderList()
    expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(1)
  })

  it('章节计划点选回调用宿主回调', async () => {
    const onChapterPlanSelect = vi.fn()
    seedThread('t1', [
      { id: 'u1', role: 'user', text: '划重点', createdAt: 1 },
      {
        id: 'a1', role: 'agent', text: '建议', createdAt: 2, streaming: false,
        chapterMarkPlan: [{ id: 'ch-3', flatIndex: 3, title: '第三章', reason: '核心', status: 'pending' }],
      },
    ] as AcpChatMessage[])
    await renderList({ onChapterPlanSelect })
    const entry = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('第三章')) as HTMLElement
    expect(entry).toBeTruthy()
    await act(async () => {
      entry.click()
    })
    expect(onChapterPlanSelect).toHaveBeenCalledTimes(1)
    expect(onChapterPlanSelect.mock.calls[0]![0].entry.id).toBe('ch-3')
  })

  it('外部 messagesRef 落在消息容器，右键事件可达根容器', async () => {
    seedThread('t1', makeMessages(2))
    const messagesRef = await renderList({ onQuote: () => {} })
    // ref 透传进包：落在带 message-list 探针的消息容器
    expect(messagesRef.current?.getAttribute('data-acp-probe')).toBe('message-list')
    // 右键外壳经 Slot 把 onContextMenu 注入包组件根 div（包侧单测锁定透传）；
    // 此处只断言事件可达且无异常，菜单打开由真实 Electron（E2E 右键引用）覆盖。
    await act(async () => {
      messagesRef.current!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(messagesRef.current?.isConnected).toBe(true)
  })

  it('滚动快照按线程落盘，不串线程', async () => {
    seedThread('t1', makeMessages(12))
    await renderList()
    const el = viewport()
    Object.defineProperty(el, 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
    el.scrollTop = 456
    await act(async () => {
      el.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(useAcpUiStore.getState().chatScrollByThread['t1']?.scrollTop).toBe(456)
    expect(useAcpUiStore.getState().chatScrollByThread['t2']).toBeUndefined()
  })
})

describe('formatUsageText 用量后缀', () => {
  it('无思考数只显示已用', () => {
    expect(formatUsageText({ used: 8281 })).toBe('已用 8.3k tokens')
    expect(formatUsageText({ used: 46 })).toBe('已用 46 tokens')
  })
  it('有思考数缀思考量', () => {
    expect(formatUsageText({ used: 8281, thinkingTokens: 2000 })).toBe('已用 8.3k tokens · 思考 2.0k')
  })
})
