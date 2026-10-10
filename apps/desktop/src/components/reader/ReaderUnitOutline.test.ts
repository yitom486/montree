// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderUnitOutline } from './ReaderUnitOutline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('ReaderUnitOutline', () => {
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

  const units = [
    { label: '第一章 绪论', href: 'chap1.html', level: 0 },
    { label: '第二章 系统架构', href: 'chap2.html', level: 0 },
  ]

  it('单轨模式下渲染基础条目数与标题，不渲染切换器', async () => {
    await act(async () => {
      root.render(
        createElement(ReaderUnitOutline, {
          units,
          onToggle: vi.fn(),
          onSelectUnit: vi.fn(),
        }),
      )
    })

    expect(container.textContent).toContain('目录')
    expect(container.textContent).toContain('2')
    expect(container.textContent).not.toContain('当前板块')
  })

  it('双轨模式下渲染切换胶囊按钮，点击可触发 onSelectTocView', async () => {
    const onSelectTocView = vi.fn()
    const tocViews = [
      { id: 'section', label: '当前板块', count: 2 },
      { id: 'site', label: '全站大纲', count: 215 },
    ]

    await act(async () => {
      root.render(
        createElement(ReaderUnitOutline, {
          units,
          onToggle: vi.fn(),
          onSelectUnit: vi.fn(),
          tocViews,
          activeTocView: 'section',
          onSelectTocView,
        }),
      )
    })

    expect(container.textContent).toContain('当前板块')
    expect(container.textContent).toContain('全站大纲')

    const siteBtn = container.querySelector('button[title*="全站大纲"]') as HTMLButtonElement
    expect(siteBtn).toBeTruthy()
    act(() => {
      siteBtn.click()
    })
    expect(onSelectTocView).toHaveBeenCalledWith('site')
  })
})
