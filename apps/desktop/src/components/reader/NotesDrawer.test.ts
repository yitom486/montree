// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesDrawer, type NotesDrawerProps } from './NotesDrawer'
import type { ReadingMark } from '@montree/contracts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('NotesDrawer', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    // 组件内 FTS 搜索走 useQuery；单测自备 client（应用根平时由 providers 提供）
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
  })

  function renderDrawer(props: NotesDrawerProps) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(NotesDrawer, props),
    )
  }

  const mockMarks: ReadingMark[] = [
    {
      id: 'note-1',
      filePath: '/book.pdf',
      fileFingerprint: 'fp-1',
      kind: 'note',
      category: 'concept',
      title: 'Paxos 核心共识',
      note: '两阶段提交与多数派 Quorum',
      excerpt: '多数派投票原则',
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
      anchor: { format: 'pdf', page: 1 },
    },
    {
      id: 'note-2',
      filePath: '/book.pdf',
      fileFingerprint: 'fp-1',
      kind: 'highlight',
      category: 'quote',
      title: '分布式真理',
      note: 'CAP 定理的本质取舍',
      excerpt: '分区容忍性不可避免',
      createdAt: 1710000001000,
      updatedAt: 1710000001000,
      anchor: { format: 'pdf', page: 2 },
    },
  ]

  it('renders drawer header and cards list when open', async () => {
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        renderDrawer({
          isOpen: true,
          onClose,
          marks: mockMarks,
          bookTitle: '分布式系统原理',
        })
      )
    })

    expect(container.textContent).toContain('全书札记与知识箱')
    expect(container.textContent).toContain('分布式系统原理')
    expect(container.textContent).toContain('Paxos 核心共识')
    expect(container.textContent).toContain('分布式真理')
  })

  it('filters cards by category tabs', async () => {
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        renderDrawer({
          isOpen: true,
          onClose,
          marks: mockMarks,
          bookTitle: '分布式系统原理',
        })
      )
    })

    const quoteTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === '引用'
    )
    expect(quoteTab).toBeDefined()

    await act(async () => {
      quoteTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('分布式真理')
    expect(container.textContent).not.toContain('Paxos 核心共识')
  })

  it('does not render when isOpen is false', async () => {
    await act(async () => {
      root.render(
        renderDrawer({
          isOpen: false,
          onClose: vi.fn(),
          marks: mockMarks,
        })
      )
    })

    expect(container.textContent).toBe('')
  })

  it('falls back to in-memory filtering when FTS IPC is unavailable', async () => {
    // 单测无 window.electronAPI：FTS 查询失败，回落内存 includes（今日行为）
    await act(async () => {
      root.render(
        renderDrawer({
          isOpen: true,
          onClose: vi.fn(),
          marks: mockMarks,
          filePath: '/book.pdf',
        })
      )
    })

    const input = container.querySelector('input[type="text"]')
    expect(input).not.toBeNull()
    await act(async () => {
      input!.setAttribute('value', 'CAP')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
      // 等 deferred 查询失败回落
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(container.textContent).toContain('分布式真理')
    expect(container.textContent).not.toContain('Paxos 核心共识')
  })
})
