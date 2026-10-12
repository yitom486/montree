// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentMessageList } from './AgentMessageList'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 聊天历史分页窗：初次只看末 5 条，上滑/按钮 5 条 5 条向前补，
 * 离底冻结不移位，切线程重置。消息以 AcpChatMessage 原样进 store（真结构）。
 */
describe('AgentMessageList 历史分页', () => {
  let container: HTMLDivElement
  let root: Root

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
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
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

  function viewport(): HTMLElement {
    return (
      (container.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null) ??
      container
    )
  }

  function loadMoreButton(): HTMLElement | null {
    return container.querySelector('[data-testid="chat-load-more"]')
  }

  async function scrollContainerTo(top: number) {
    // 监听与 hook 都回落到外层 container（happy-dom 无排版，手动给几何量）
    Object.defineProperty(container, 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true })
    container.scrollTop = top
    await act(async () => {
      container.dispatchEvent(new Event('scroll', { bubbles: true }))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
  }

  it('12 条初次只看末 5 条，按钮显示剩余 7 条', async () => {
    seedThread('t1', makeMessages(12))
    await renderList()
    const text = container.textContent ?? ''
    expect(text).toContain('正文m12')
    expect(text).toContain('正文m08')
    expect(text).not.toContain('正文m07')
    expect(text).not.toContain('正文m01')
    expect(loadMoreButton()?.textContent).toContain('还剩 7 条')
  })

  it('点加载更早补 5 条，再点全量后按钮消失', async () => {
    seedThread('t1', makeMessages(12))
    await renderList()
    const click = async () => {
      await act(async () => {
        loadMoreButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }
    await click()
    let text = container.textContent ?? ''
    expect(text).toContain('正文m03')
    expect(text).not.toContain('正文m02')
    expect(loadMoreButton()?.textContent).toContain('还剩 2 条')
    await click()
    text = container.textContent ?? ''
    expect(text).toContain('正文m01')
    expect(loadMoreButton()).toBeNull()
  })

  it('滑到顶部自动向前补', async () => {
    seedThread('t1', makeMessages(12))
    await renderList()
    await scrollContainerTo(0)
    const text = container.textContent ?? ''
    expect(text).toContain('正文m03')
    expect(text).not.toContain('正文m02')
  })

  it('不足 5 条全显无按钮；切线程重置窗口', async () => {
    seedThread('t1', makeMessages(3))
    await renderList()
    expect(container.textContent).toContain('正文m01')
    expect(loadMoreButton()).toBeNull()

    seedThread('t2', makeMessages(12))
    await act(async () => {})
    const text = container.textContent ?? ''
    expect(text).toContain('正文m12')
    expect(text).not.toContain('正文m07')
    expect(loadMoreButton()?.textContent).toContain('还剩 7 条')
  })

  it('离底冻结：中部加载更多后窗口起点固定', async () => {
    seedThread('t1', makeMessages(12))
    await renderList()
    // 滚到中部离底 → 冻结末 5 条窗口 [m8..m12]
    await scrollContainerTo(1500)
    // 此时自动补可能已触发（顶部阈值外，不会）；点按钮向前补到 [m3..m12]
    const button = loadMoreButton()
    expect(button).not.toBeNull()
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const text = container.textContent ?? ''
    expect(text).toContain('正文m03')
    expect(text).not.toContain('正文m02')
  })

  it('贴底状态下新增消息自然可见，绝不被历史切片截断', async () => {
    seedThread('t1', makeMessages(12))
    await renderList()
    expect(container.textContent).toContain('正文m12')

    // 追加 m13 与 m14
    await act(async () => {
      useAcpUiStore.setState((s) => ({
        ...s,
        threads: s.threads.map((t) =>
          t.id === 't1'
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  { id: 'm13', role: 'user', text: '新问题m13', createdAt: 2000 } as AcpChatMessage,
                  { id: 'm14', role: 'agent', text: '回答正文m14', createdAt: 2001 } as AcpChatMessage,
                ],
              }
            : t,
        ),
      }))
    })

    const text = container.textContent ?? ''
    expect(text).toContain('新问题m13')
    expect(text).toContain('回答正文m14')
  })

  it('上滑看历史后点击回到底部可恢复贴底，新消息可见', async () => {
    seedThread('t1', makeMessages(12))
    await renderList()

    // 向上滑动滚轮，触发上滑标记
    const el = container.querySelector('.flex-1.overflow-y-auto') ?? container
    await act(async () => {
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
    })

    // 用户发出新提问
    await act(async () => {
      useAcpUiStore.setState((s) => ({
        ...s,
        threads: s.threads.map((t) =>
          t.id === 't1'
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  { id: 'm13', role: 'user', text: '新用户问题m13', createdAt: 2000 } as AcpChatMessage,
                ],
              }
            : t,
        ),
      }))
    })

    // 点击回到底部
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('回到底部'))
    if (btn) {
      await act(async () => {
        btn.click()
      })
    }

    const text = container.textContent ?? ''
    expect(text).toContain('新用户问题m13')
  })
})

