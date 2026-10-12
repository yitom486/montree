// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DockedAgentPane } from './DockedAgentPane'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// AgentPanel 重，仅测拉伸壳
vi.mock('@/components/agent/AgentPanel', () => ({
  AgentPanel: () => createElement('div', { 'data-testid': 'mock-agent-panel' }, 'MockAgentPanel'),
  useIsDockedAgentVisible: () => false,
}))

describe('DockedAgentPane', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useReaderHudUiStore.setState({ dockedAgentWidth: 340 })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  async function renderPane() {
    await act(async () => {
      root.render(createElement(DockedAgentPane, { workspaceRoot: '/workspace' }))
    })
  }

  function dragHandleBy(dx: number) {
    const handle = container.querySelector(
      '[data-testid="docked-agent-resize-handle"]',
    ) as HTMLElement
    expect(handle).not.toBeNull()
    act(() => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 500, clientY: 0 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500 + dx, clientY: 0 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
  }

  function pane(): HTMLElement {
    return container.querySelector('[data-testid="docked-agent-pane"]') as HTMLElement
  }

  it('渲染面板与左侧拉伸手柄，初始 340', async () => {
    await renderPane()
    expect(container.querySelector('[data-testid="mock-agent-panel"]')).not.toBeNull()
    expect(pane().style.width).toBe('340px')
  })

  it('往左拖变宽并写入 store', async () => {
    await renderPane()
    dragHandleBy(-80)
    expect(useReaderHudUiStore.getState().dockedAgentWidth).toBe(420)
    expect(pane().style.width).toBe('420px')
  })

  it('往右拖变窄，钳制 280~640', async () => {
    await renderPane()
    dragHandleBy(10000)
    expect(useReaderHudUiStore.getState().dockedAgentWidth).toBe(280)
    dragHandleBy(-10000)
    expect(useReaderHudUiStore.getState().dockedAgentWidth).toBe(640)
  })

  it('拖拽中挂载全屏遮罩，window blur 时安全退出拖拽态', async () => {
    await renderPane()
    const handle = container.querySelector(
      '[data-testid="docked-agent-resize-handle"]',
    ) as HTMLElement
    expect(handle).not.toBeNull()

    // 初始没有遮罩
    expect(container.querySelector('[data-testid="docked-agent-resize-overlay"]')).toBeNull()

    // 开始拖拽
    act(() => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 500, clientY: 0 }))
    })
    expect(container.querySelector('[data-testid="docked-agent-resize-overlay"]')).not.toBeNull()

    // 窗口失焦，遮罩立即撤除
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(container.querySelector('[data-testid="docked-agent-resize-overlay"]')).toBeNull()
  })
})
