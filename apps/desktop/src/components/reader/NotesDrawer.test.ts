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

    expect(container.textContent).toContain('全书札记与知识卡片箱')
    expect(container.textContent).toContain('分布式系统原理')
    expect(container.textContent).toContain('Paxos 核心共识')
    expect(container.textContent).toContain('分布式真理')
    expect(container.textContent).toContain('考考我')
    expect(container.textContent).toContain('资产盘点')
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
      b.textContent?.includes('引用')
    )
    expect(quoteTab).toBeDefined()

    await act(async () => {
      quoteTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('分布式真理')
    expect(container.textContent).not.toContain('Paxos 核心共识')
  })

  it('triggers AI quiz from notes drawer header and single card button', async () => {
    const onOpenQuiz = vi.fn()

    await act(async () => {
      root.render(
        renderDrawer({
          isOpen: true,
          onClose: vi.fn(),
          marks: mockMarks,
          bookTitle: '分布式系统原理',
          onOpenQuiz,
        })
      )
    })

    const quizButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('考考我') || b.getAttribute('title')?.includes('深度思考测验')
    )
    expect(quizButtons.length).toBeGreaterThan(0)

    // 点击顶栏一键测验
    await act(async () => {
      quizButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onOpenQuiz).toHaveBeenCalledTimes(1)
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

  it('renders rich markdown and mermaid diagram inside note card', async () => {
    const markWithRichMarkdown: ReadingMark = {
      id: 'rich-note-1',
      filePath: '/book.pdf',
      fileFingerprint: 'fp-1',
      kind: 'note',
      category: 'diagram',
      title: '范式流转与图谱',
      note: '> **核心解读**：对比价值评价与发生逻辑\n\n### 架构思维\n\n```mermaid\nflowchart TD\nA[起点] --> B[终点]\n```',
      excerpt: '义和团运动的起源考察',
      keyPoints: ['微观质感', '因果闭环'],
      aiSummary: '深度解构微观社会生态',
      createdAt: 1710000002000,
      updatedAt: 1710000002000,
      anchor: { format: 'pdf', page: 3 },
    }

    await act(async () => {
      root.render(
        renderDrawer({
          isOpen: true,
          onClose: vi.fn(),
          marks: [markWithRichMarkdown],
          bookTitle: '历史研究',
        }),
      )
    })

    // 块引用与加粗富文本
    const blockquote = container.querySelector('blockquote')
    expect(blockquote).not.toBeNull()
    expect(blockquote?.textContent).toContain('核心解读')

    // 标题渲染
    const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent)
    expect(headings.some((text) => text?.includes('架构思维'))).toBe(true)

    // 要点 Pill
    expect(container.textContent).toContain('微观质感')
    expect(container.textContent).toContain('因果闭环')

    // Mermaid 容器与箭头保留校验（严防 --> 被错误拆分为换行）
    const mermaidContainer = container.querySelector('[data-mermaid-source]')
    expect(mermaidContainer).not.toBeNull()
    const source = mermaidContainer?.getAttribute('data-mermaid-source') ?? ''
    expect(source).toContain('flowchart TD')
    expect(source).toContain('A[起点] --> B[终点]')
    expect(source).not.toContain('--\n')

    // 抽屉右上角关闭按钮
    const closeBtn = container.querySelector('button[title="关闭抽屉"]')
    expect(closeBtn).not.toBeNull()
  })
})
