// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppTitleBar } from './AppTitleBar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('AppTitleBar', () => {
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

  it('渲染未打开文件时的默认胶囊标题', () => {
    act(() => {
      root.render(
        createElement(AppTitleBar, {
          sidebarVisible: true,
        }),
      )
    })

    expect(container.textContent).toContain('Inkdown')
    expect(container.textContent).toContain('Ctrl P')
  })

  it('正确解析并显示当前打开的书籍名称', () => {
    act(() => {
      root.render(
        createElement(AppTitleBar, {
          activeFilePath: 'D:/books/社会科学/论美国的民主.epub',
          isDirty: true,
          sidebarVisible: true,
        }),
      )
    })

    expect(container.textContent).toContain('论美国的民主.epub')
  })

  it('点击胶囊触发 onQuickOpen 回调', () => {
    const onQuickOpen = vi.fn()
    act(() => {
      root.render(
        createElement(AppTitleBar, {
          activeFilePath: 'D:/workspace/note.md',
          onQuickOpen,
        }),
      )
    })

    const quickOpenBtn = container.querySelector('button[title*="Ctrl+P"]') as HTMLButtonElement | null
    expect(quickOpenBtn).not.toBeNull()
    act(() => {
      quickOpenBtn?.click()
    })
    expect(onQuickOpen).toHaveBeenCalledTimes(1)
  })

  it('点击侧边栏开关触发 onToggleSidebar 回调', () => {
    const onToggleSidebar = vi.fn()
    act(() => {
      root.render(
        createElement(AppTitleBar, {
          sidebarVisible: true,
          onToggleSidebar,
        }),
      )
    })

    const toggleBtn = container.querySelector('button[aria-label="折叠侧边栏"]') as HTMLButtonElement | null
    expect(toggleBtn).not.toBeNull()
    act(() => {
      toggleBtn?.click()
    })
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })
})
