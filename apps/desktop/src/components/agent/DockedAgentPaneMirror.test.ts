// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DockedAgentPane } from './DockedAgentPane'
import { FloatingAIHud } from './FloatingAIHud'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 捕获挂载面传给 AgentPanel 的读源 prop（不渲染真面板，只断言接线）
vi.mock('@/components/agent/AgentPanel', () => ({
  AgentPanel: (props: { messageSource?: string }) =>
    createElement('div', {
      'data-testid': 'mock-agent-panel',
      'data-message-source': props.messageSource ?? 'host-default',
    }),
  useIsDockedAgentVisible: () => false,
}))

vi.mock('@/api/reading-marks-api', () => ({
  readingMarksApi: {
    list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    create: vi.fn().mockResolvedValue({ ok: true, value: { id: 'mock-1' } }),
    update: vi.fn().mockResolvedValue({ ok: true, value: { id: 'mock-1' } }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

/**
 * P4b 挂载面接线：停靠面 opt-in 包镜像读源，悬浮面保持宿主默认。
 * 既有用例（`DockedAgentPane.test.ts` / `FloatingAIHud.test.ts`）一行不动。
 */
describe('P4b 挂载面读源接线', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    useAcpUiStore.setState({
      panelOpen: true,
      hudDisplayMode: 'floating',
      status: 'connected',
      selectedRuntimeId: 'codex-acp',
    })
    useReaderHudUiStore.setState({
      hudActiveTab: 'chat',
      floatingPosition: { x: 100, y: 100 },
      dockedAgentWidth: 340,
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
  })

  it('停靠面传 package-mirror 读源', async () => {
    await act(async () => {
      root.render(createElement(DockedAgentPane, { workspaceRoot: '/workspace' }))
    })
    const panel = container.querySelector('[data-testid="mock-agent-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('data-message-source')).toBe('package-mirror')
  })

  it('悬浮面不传读源（宿主默认，一行不动）', async () => {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(FloatingAIHud, { workspaceRoot: '/workspace' }),
        ),
      )
    })
    const panel = container.querySelector('[data-testid="mock-agent-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('data-message-source')).toBe('host-default')
  })
})
