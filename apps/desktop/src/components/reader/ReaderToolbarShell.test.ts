// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderToolbarShell } from './ReaderToolbarShell'
import { useAcpUiStore } from '@/stores/acp-ui-store'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 阅读器工具栏：AI 伴读按钮是开关（开则关、关则悬浮开），不是只开不关。
 */
describe('ReaderToolbarShell', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useAcpUiStore.setState({ panelOpen: false, hudDisplayMode: 'docked' })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useAcpUiStore.setState({ panelOpen: false, hudDisplayMode: 'docked' })
  })

  async function renderShell() {
    await act(async () => {
      root.render(
        createElement(ReaderToolbarShell, {
          onTocToggle: vi.fn(),
          onMarksToggle: vi.fn(),
          onAddBookmark: vi.fn(),
        }),
      )
    })
  }

  function aiButton(): HTMLElement {
    const el = container.querySelector('button[aria-label="AI 伴读模态切换"]') as HTMLElement | null
    expect(el).not.toBeNull()
    return el!
  }

  it('渲染目录/批注簿/加书签/卡片流/札记箱/AI伴读', async () => {
    await renderShell()
    const text = container.textContent ?? ''
    for (const label of ['目录', '批注簿', '加书签', '卡片流', '札记箱', 'AI 伴读']) {
      expect(text).toContain(label)
    }
  })

  it('AI 伴读按钮可开关悬浮窗', async () => {
    await renderShell()
    aiButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await act(async () => {})
    expect(useAcpUiStore.getState().panelOpen).toBe(true)
    expect(useAcpUiStore.getState().hudDisplayMode).toBe('floating')

    aiButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await act(async () => {})
    expect(useAcpUiStore.getState().panelOpen).toBe(false)
  })

  it('展示卡片流数量角标', async () => {
    await act(async () => {
      root.render(
        createElement(ReaderToolbarShell, {
          onTocToggle: vi.fn(),
          onMarksToggle: vi.fn(),
          onAddBookmark: vi.fn(),
          cardCount: 5,
        }),
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('卡片流')
    expect(text).toContain('5')
  })
})
