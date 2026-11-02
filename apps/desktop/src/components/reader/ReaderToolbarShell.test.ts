// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderToolbarShell } from './ReaderToolbarShell'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('ReaderToolbarShell', () => {
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

  async function renderShell(props?: Partial<React.ComponentProps<typeof ReaderToolbarShell>>) {
    await act(async () => {
      root.render(
        createElement(ReaderToolbarShell, {
          onTocToggle: vi.fn(),
          onAddBookmark: vi.fn(),
          ...props,
        }),
      )
    })
  }

  async function openMenu() {
    const button = container.querySelector('[aria-label="更多工具"]')!
    await act(async () => {
      button.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('正文顶部只保留目录与单一更多入口，不渲染重复学习/标记入口', async () => {
    await renderShell()
    expect(Array.from(container.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual(['目录', '更多工具'])
    for (const label of ['批注簿', '加书签', '卡片流', '札记箱', '听书', '考考我']) {
      expect(container.textContent).not.toContain(label)
    }
  })

  it('从更多工具添加书签并打开统一卡片区', async () => {
    const onAddBookmark = vi.fn()
    useReaderHudUiStore.setState({ isCardRailOpen: false, workspacePanelTab: 'chat' })
    await renderShell({ onAddBookmark })
    await openMenu()
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent === '添加书签')!
    await act(async () => item.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onAddBookmark).toHaveBeenCalledOnce()
    expect(useReaderHudUiStore.getState().isCardRailOpen).toBe(true)
    expect(useReaderHudUiStore.getState().workspacePanelTab).toBe('cards')
  })

  it('格式专属操作合并到同一个菜单并保留回调', async () => {
    const onSelect = vi.fn()
    await renderShell({ menuItems: [{ key: 'ocr', label: '识别本页', onSelect }] })
    await openMenu()
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent === '识别本页')!
    await act(async () => item.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('[aria-label="更多工具"]')).toHaveLength(1)
  })

  it('不支持朗读时菜单显示禁用与原因', async () => {
    await renderShell({ readAloudDisabled: true, readAloudDisabledReason: '扫描件暂无可朗读文字' })
    await openMenu()
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent === '朗读本章')!
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(item.getAttribute('title')).toBe('扫描件暂无可朗读文字')
  })
})
