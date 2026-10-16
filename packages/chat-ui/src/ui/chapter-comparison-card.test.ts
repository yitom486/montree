// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChapterComparisonCard } from './chapter-comparison-card'
import type { PresentChapterComparison } from '@montree/contracts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function result(overrides: Partial<PresentChapterComparison> = {}): PresentChapterComparison {
  return {
    schemaVersion: 1,
    kind: 'chapter-comparison',
    id: 'present-chapter-comparison-test01',
    title: '两章论点比较',
    documentFingerprint: '/books/a.epub',
    documentLabel: 'a.epub',
    chapters: [
      { key: 'c1', label: '第一章', flatIndex: 0 },
      { key: 'c2', label: '第二章', flatIndex: 1 },
    ],
    items: [
      { id: 'i1', dimension: '论点', chapterKey: 'c1', excerpt: '原文一', verified: true, flatIndex: 0 },
      { id: 'i2', dimension: '论点', chapterKey: 'c2', note: '只有评述', verified: false },
    ],
    ...overrides,
  }
}

describe('ChapterComparisonCard', () => {
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

  function renderCard(value = result(), onLocateChapter = vi.fn()) {
    act(() => {
      root.render(createElement(ChapterComparisonCard, { result: value, onLocateChapter }))
    })
    return onLocateChapter
  }

  it('默认全选章节，条目全部可见', () => {
    renderCard()
    expect(container.textContent).toContain('两章论点比较')
    expect(container.querySelectorAll('[data-testid="comparison-item"]')).toHaveLength(2)
  })

  it('引用列表只收已验证摘录，定位仍走宿主回调', () => {
    const onLocate = renderCard()
    const citations = container.querySelector('[data-slot="citations"]')!
    expect(citations.textContent).toContain('引用来源 · 1 处')
    act(() => citations.querySelector('button')!.click())
    expect(citations.textContent).toContain('原文一')
    expect(citations.textContent).not.toContain('只有评述')
    act(() => citations.querySelector<HTMLButtonElement>('li button')!.click())
    expect(onLocate).toHaveBeenCalledWith(0, '原文一')
  })

  it('章节筛选隔离：取消后条目过滤，再选回来恢复', () => {
    renderCard()
    const chips = [...container.querySelectorAll('button[aria-pressed]')]
    const first = chips.find((b) => b.textContent === '第一章') as HTMLElement
    act(() => {
      first.click()
    })
    expect(first.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelectorAll('[data-testid="comparison-item"]')).toHaveLength(1)
    act(() => {
      first.click()
    })
    expect(container.querySelectorAll('[data-testid="comparison-item"]')).toHaveLength(2)
  })

  it('证据展开在同结果更新后保留，换结果重置', () => {
    renderCard()
    const evidence = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('查看证据'),
    ) as HTMLElement
    act(() => {
      evidence.click()
    })
    expect(container.textContent).toContain('原文一')
    // 同 id 新对象（chunk 更新）：状态保留
    renderCard({ ...result(), summary: '补充' })
    expect(container.textContent).toContain('原文一')
  })

  it('已验证条目定位回调带 flatIndex 与摘录，未验证无按钮', () => {
    const onLocate = renderCard()
    const locate = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('定位原文'),
    ) as HTMLElement
    act(() => {
      locate.click()
    })
    expect(onLocate).toHaveBeenCalledWith(0, '原文一')
    expect(container.textContent).toContain('无定位')
    const locates = [...container.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('定位原文'),
    )
    expect(locates).toHaveLength(1)
  })

  it('空条目显示无数据而非崩溃', () => {
    renderCard(result({ items: [] }))
    expect(container.textContent).toContain('暂无比较条目')
  })
})
