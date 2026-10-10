// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebDocSidebarPanel } from './WebDocSidebarPanel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('WebDocSidebarPanel', () => {
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
    document.body.innerHTML = ''
  })

  it('展开模式下渲染手风琴 Header、输入框与最近记录', async () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    await act(async () => {
      root.render(
        createElement(WebDocSidebarPanel, {
          onOpenWebDoc: onOpen,
          recentWebUrls: ['https://example.com/docs/a', 'https://example.com/docs/b'],
          collapsed: false,
          onToggle,
        }),
      )
    })

    expect(container.textContent).toContain('在线文档')
    expect(container.textContent).toContain('2') // 最近数量 badge
    expect(container.querySelector('input')).not.toBeNull()
    expect(container.textContent).toContain('example.com/docs/a')
  })

  it('折叠模式下仅显示 Header 并不渲染输入框与列表', async () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    await act(async () => {
      root.render(
        createElement(WebDocSidebarPanel, {
          onOpenWebDoc: onOpen,
          recentWebUrls: ['https://example.com/docs/a'],
          collapsed: true,
          onToggle,
        }),
      )
    })

    expect(container.textContent).toContain('在线文档')
    expect(container.querySelector('input')).toBeNull()
    expect(container.textContent).not.toContain('example.com/docs/a')

    // 点击 Header 触发 onToggle
    const headerBtn = container.querySelector('button')
    expect(headerBtn).not.toBeNull()
    act(() => {
      headerBtn?.click()
    })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
