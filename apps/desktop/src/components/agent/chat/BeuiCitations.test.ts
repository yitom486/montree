// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BeuiCitations, type BeuiCitationItem } from './BeuiCitations'
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('BeUI 结构化来源', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const render = (citations: BeuiCitationItem[]) => act(() => root.render(createElement(BeuiCitations, { citations })))

  it('无来源不显示，有来源点击宿主定位且不猜测跳转', () => {
    render([])
    expect(container.textContent).toBe('')
    const locate = vi.fn()
    render([{ id: 'book:chapter-1', title: '第一章', excerpt: '真实摘录', onSelect: locate }])
    act(() => container.querySelector('button')!.click())
    expect(container.textContent).toContain('真实摘录')
    act(() => container.querySelector<HTMLButtonElement>('li button')!.click())
    expect(locate).toHaveBeenCalledTimes(1)
  })

  it('正常网页链接可用，危险协议不生成链接，无远程 favicon', () => {
    render([{ id: 'bad', title: '不可跳转', url: 'javascript:alert(1)' }, { id: 'web', title: '网页证据', url: 'https://example.com' }])
    act(() => container.querySelector('button')!.click())
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/')
    expect(container.querySelector('img')).toBeNull()
  })

  it('增量追加来源不重置展开', () => {
    render([{ id: 'one', title: '第一处' }])
    act(() => container.querySelector('button')!.click())
    render([{ id: 'one', title: '第一处' }, { id: 'two', title: '第二处' }])
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
  })
})
