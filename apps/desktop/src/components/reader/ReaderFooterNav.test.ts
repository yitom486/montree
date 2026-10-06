// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flattenEpubToc } from '@montree/reader-core'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { ReaderFooterNav } from './ReaderFooterNav'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 底栏翻页逻辑契约：上一单元 / 当前单元 / 下一单元必须与正文导航同源
 *（reader-navigation-store），与底栏"搬进正文列"的布局改造无关——
 * 本文件在改造前后都必须全绿，锁定"绑定关系不改变"。
 */
describe('ReaderFooterNav', () => {
  let container: HTMLDivElement
  let root: Root

  const chapters = flattenEpubToc([
    { label: '前言', href: 'preface.xhtml' },
    { label: '原编者的话', href: 'editor-note.xhtml' },
    { label: '论美国的民主1', href: 'book1-ch1.xhtml' },
  ])

  beforeEach(() => {
    useReaderNavigationStore.getState().beginSession('/books/fixture.epub', 'epub')
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

  async function renderFooter(props?: { onPrevious?: () => void; onNext?: () => void }) {
    await act(async () => {
      root.render(createElement(ReaderFooterNav, { ready: true, ...props }))
    })
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
  }

  it('中间章节：三段标题正确，两按钮可用，点击直达回调', async () => {
    act(() => {
      useReaderNavigationStore.getState().syncEpub(chapters, { href: 'editor-note.xhtml' })
    })
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    await renderFooter({ onPrevious, onNext })

    const text = container.textContent ?? ''
    expect(text).toContain('上一单元')
    expect(text).toContain('前言')
    expect(text).toContain('当前单元')
    expect(text).toContain('原编者的话')
    expect(text).toContain('下一单元')
    expect(text).toContain('论美国的民主1')

    const [prev, next] = buttons()
    expect(prev!.disabled).toBe(false)
    expect(next!.disabled).toBe(false)
    prev!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onPrevious).toHaveBeenCalledTimes(1)
    next!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('首章：上一单元致灰显示占位，下一单元可用', async () => {
    act(() => {
      useReaderNavigationStore.getState().syncEpub(chapters, { href: 'preface.xhtml' })
    })
    await renderFooter()

    const [prev, next] = buttons()
    expect(prev!.disabled).toBe(true)
    expect(next!.disabled).toBe(false)
    expect(container.textContent).toContain('当前单元')
    expect(container.textContent).toContain('前言')
  })

  it('末章：下一单元致灰，上一单元可用', async () => {
    act(() => {
      useReaderNavigationStore.getState().syncEpub(chapters, { href: 'book1-ch1.xhtml' })
    })
    await renderFooter()

    const [prev, next] = buttons()
    expect(prev!.disabled).toBe(false)
    expect(next!.disabled).toBe(true)
    expect(container.textContent).toContain('论美国的民主1')
  })

  it('正文导航变化后底栏同步变化（绑定不断）', async () => {
    act(() => {
      useReaderNavigationStore.getState().syncEpub(chapters, { href: 'preface.xhtml' })
    })
    await renderFooter()
    expect(container.textContent).toContain('前言')

    act(() => {
      useReaderNavigationStore.getState().syncEpub(chapters, { href: 'book1-ch1.xhtml' })
    })
    expect(container.textContent).toContain('论美国的民主1')
    const [, next] = buttons()
    expect(next!.disabled).toBe(true)
  })

  it('PDF：按页落章，三段标题与首末致灰同规则', async () => {
    useReaderNavigationStore.getState().beginSession('/books/fixture.pdf', 'pdf')
    const units = [
      { label: '封面', href: '1', level: 0 },
      { label: '第一章', href: '5', level: 0 },
      { label: '第二章', href: '20', level: 0 },
    ]
    act(() => {
      useReaderNavigationStore.getState().syncPdf(units, 7)
    })
    await renderFooter()

    const text = container.textContent ?? ''
    expect(text).toContain('封面')
    expect(text).toContain('第一章')
    expect(text).toContain('第二章')
    const [prev, next] = buttons()
    expect(prev!.disabled).toBe(false)
    expect(next!.disabled).toBe(false)

    act(() => {
      useReaderNavigationStore.getState().syncPdf(units, 21)
    })
    expect(container.textContent).toContain('第二章')
    expect(buttons()[1]!.disabled).toBe(true)
  })
})
