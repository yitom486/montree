// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarginaliaBar } from './MarginaliaBar'
import type { ReadingMark } from '@yitom/contracts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('MarginaliaBar', () => {
  let container: HTMLDivElement
  let root: Root

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
  })

  const mockMarks: ReadingMark[] = [
    {
      id: 'mark-concept-1',
      filePath: '/book.epub',
      fileFingerprint: 'fp-1',
      kind: 'note',
      category: 'concept',
      title: '分布式共识',
      note: 'Raft 与 Paxos 核心算法对比',
      excerpt: '多数派投票原则',
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
      anchor: { format: 'epub', cfi: 'epubcfi(/6/2)' },
    },
    {
      id: 'mark-quote-1',
      filePath: '/book.epub',
      fileFingerprint: 'fp-1',
      kind: 'highlight',
      category: 'quote',
      title: '经典名句',
      note: '架构设计就是关于取舍的艺术',
      excerpt: '取舍的艺术',
      createdAt: 1710000001000,
      updatedAt: 1710000001000,
      anchor: { format: 'epub', cfi: 'epubcfi(/6/4)' },
    },
    {
      id: 'mark-diagram-1',
      filePath: '/book.epub',
      fileFingerprint: 'fp-1',
      kind: 'note',
      category: 'diagram',
      diagramId: 'diag-123',
      title: '握手时序图谱',
      note: '客户端与服务端协商时序',
      excerpt: '三次握手流程',
      createdAt: 1710000002000,
      updatedAt: 1710000002000,
      anchor: { format: 'epub', cfi: 'epubcfi(/6/6)' },
    },
  ]

  async function openTypeFilters() {
    const trigger = container.querySelector('[aria-label="筛选卡片类型"]')!
    await act(async () => {
      trigger.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('renders mark categories, counts and titles accurately', async () => {
    const onMarkClick = vi.fn()
    const onToggleCardCollapse = vi.fn()
    const onToggleAllCollapse = vi.fn()

    await act(async () => {
      root.render(
        createElement(MarginaliaBar, {
          marks: mockMarks,
          onMarkClick,
          onToggleCardCollapse,
          onToggleAllCollapse,
        })
      )
    })

    expect(container.textContent).toContain('知识卡片')
    expect(container.textContent).toContain('全部类型 (3)')
    await openTypeFilters()
    expect(document.body.textContent).toContain('概念 (1)')
    expect(document.body.textContent).toContain('引用 (1)')
    expect(document.body.textContent).toContain('图谱 (1)')
    expect(container.textContent).toContain('分布式共识')
    expect(container.textContent).toContain('经典名句')
    expect(container.textContent).toContain('握手时序图谱')
  })

  it('filters cards when category button is clicked', async () => {
    const onMarkClick = vi.fn()
    const onToggleCardCollapse = vi.fn()
    const onToggleAllCollapse = vi.fn()

    await act(async () => {
      root.render(
        createElement(MarginaliaBar, {
          marks: mockMarks,
          onMarkClick,
          onToggleCardCollapse,
          onToggleAllCollapse,
        })
      )
    })

    await openTypeFilters()
    const conceptBtn = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find((b) =>
      b.textContent?.includes('概念 (1)')
    )
    expect(conceptBtn).toBeDefined()

    await act(async () => {
      conceptBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('分布式共识')
    expect(container.textContent).not.toContain('经典名句')
  })

  it('triggers onMarkClick and onOpenDiagram', async () => {
    const onMarkClick = vi.fn()
    const onToggleCardCollapse = vi.fn()
    const onToggleAllCollapse = vi.fn()
    const onOpenDiagram = vi.fn()

    await act(async () => {
      root.render(
        createElement(MarginaliaBar, {
          marks: mockMarks,
          onMarkClick,
          onToggleCardCollapse,
          onToggleAllCollapse,
          onOpenDiagram,
        })
      )
    })

    const card = container.querySelector('#card-mark-concept-1') as HTMLElement
    expect(card).toBeDefined()

    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onMarkClick).toHaveBeenCalledWith(mockMarks[0])

    const diagramBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('展开时序图')
    )
    expect(diagramBtn).toBeDefined()

    await act(async () => {
      diagramBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onOpenDiagram).toHaveBeenCalledWith('diag-123')
  })
  it('shows chapter source and dims cards outside current chapter', async () => {
    const chapterOfMark = (mark: ReadingMark) =>
      mark.id === 'mark-concept-1'
        ? { key: 'ch1', label: '第一章 北美的外貌' }
        : { key: 'ch2', label: '第二章 民主的起源' }

    await act(async () => {
      root.render(
        createElement(MarginaliaBar, {
          marks: mockMarks,
          onMarkClick: vi.fn(),
          onToggleCardCollapse: vi.fn(),
          onToggleAllCollapse: vi.fn(),
          chapterOfMark,
          currentChapterKey: 'ch1',
        })
      )
    })

    // 默认本章作用域：只见 ch1
    expect(container.textContent).toContain('第一章 北美的外貌')
    expect(container.textContent).not.toContain('经典名句')

    // 切到全书作用域：跨章回顾（注意不是分类筛选的"全部"）
    const bookBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('全书 ('),
    )
    expect(bookBtn).toBeDefined()
    await act(async () => {
      bookBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('第一章 北美的外貌')
    expect(container.textContent).toContain('第二章 民主的起源')
    const other = container.querySelector('#card-mark-quote-1')?.parentElement?.parentElement
    expect(other?.className).toContain('opacity-55')
  })

  it('follows reading fraction proportionally (co-scroll mechanics)', async () => {
    await act(async () => {
      root.render(
        createElement(MarginaliaBar, {
          marks: mockMarks,
          onMarkClick: vi.fn(),
          onToggleCardCollapse: vi.fn(),
          onToggleAllCollapse: vi.fn(),
          readingFraction: 0.5,
        })
      )
    })

    const rail = container.querySelector('#marginalia-notes-stream') as HTMLElement
    expect(rail).not.toBeNull()
    // happy-dom 无布局：伪造可滚动度量，验证等比映射赋值
    Object.defineProperty(rail, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(rail, 'clientHeight', { value: 400, configurable: true })

    // 初挂载 effect 已用初始值跑过（当时度量为 0）；推一次跟随事件触发赋值
    await act(async () => {
      window.dispatchEvent(new CustomEvent('montree:rail-follow', { detail: 0.5 }))
    })
    expect(rail.scrollTop).toBe(300)
  })

  it('defaults to current-chapter scope and swaps on chapter change', async () => {
    const chapterOfMark = (mark: ReadingMark) =>
      mark.id === 'mark-concept-1'
        ? { key: 'ch1', label: '第一章' }
        : { key: 'ch2', label: '第二章' }

    await act(async () => {
      root.render(
        createElement(MarginaliaBar, {
          marks: mockMarks,
          onMarkClick: vi.fn(),
          onToggleCardCollapse: vi.fn(),
          onToggleAllCollapse: vi.fn(),
          chapterOfMark,
          currentChapterKey: 'ch1',
        })
      )
    })

    // 默认本章：只见 ch1 的卡
    expect(container.textContent).toContain('分布式共识')
    expect(container.textContent).not.toContain('经典名句')
    expect(container.textContent).toContain('本章 (1)')

    // 切到全书作用域：跨章回顾（注意不是分类筛选的"全部"）
    const allBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('全书 (')
    )
    expect(allBtn).toBeDefined()
    await act(async () => {
      allBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('经典名句')
  })

  it('书签统一在卡片流筛选、定位和删除，不混入引用类别', async () => {
    const onMarkClick = vi.fn()
    const onDeleteMark = vi.fn()
    const bookmark: ReadingMark = { ...mockMarks[0], id: 'bookmark-1', kind: 'bookmark', category: undefined, title: '阅读位置' }
    await act(async () => {
      root.render(createElement(MarginaliaBar, {
        marks: [...mockMarks, bookmark], onMarkClick, onDeleteMark,
        onToggleCardCollapse: vi.fn(), onToggleAllCollapse: vi.fn(),
      }))
    })
    await openTypeFilters()
    const item = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find((item) => item.textContent === '书签 (1)')!
    await act(async () => item.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const card = container.querySelector('#card-bookmark-1')!
    expect(card.textContent).toContain('书签')
    expect(container.querySelector('#card-mark-quote-1')).toBeNull()
    await act(async () => card.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onMarkClick).toHaveBeenCalledWith(bookmark)
    await act(async () => card.querySelector('[title="删除卡片"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onDeleteMark).toHaveBeenCalledWith('bookmark-1')
  })
})
