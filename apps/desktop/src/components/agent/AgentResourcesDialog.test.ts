// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inspection: null as any,
  detail: null as any,
}))

vi.mock('@/hooks/agent/useAgentInspection', () => ({
  useAgentInspection: () => mocks.inspection,
  useAgentSkill: () => mocks.detail,
}))
vi.mock('@/api/agent-inspection-api', () => ({
  agentInspectionApi: { inspect: vi.fn(), skill: vi.fn(), reveal: vi.fn() },
}))
vi.mock('@/api/app-api', () => ({ appApi: { openExternal: vi.fn() } }))
vi.mock('@/hooks/preview/useCodeBlockCopy', () => ({ useCodeBlockCopy: () => {} }))

import { AgentResourcesDialog } from './AgentResourcesDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const inspection = {
  sessionId: 'session-1',
  runtimeId: 'mock',
  agentName: 'Mock Agent',
  agentVersion: '1',
  connectionStatus: 'connected',
  workspace: 'workspace',
  observedAt: '2026-10-23T00:00:00.000Z',
  skills: [],
  warnings: [],
  mcpCoverage: 'MCP coverage',
  skillsCoverage: 'Skills coverage',
  mcps: [{
    id: 'montree',
    name: 'Montree 文档与阅读工具',
    transport: 'stdio',
    endpoint: 'endpoint',
    attached: true,
    status: 'connected',
    activeClients: 1,
    discoveries: 2,
    disconnects: 0,
    lastDiscoveredAt: '2026-10-23T00:00:00.000Z',
    tools: [],
  }],
}

const context = { threadId: 'thread-1', sessionId: 'session-1', runtimeId: 'mock' }

describe('AgentResourcesDialog stale data', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.detail = { data: null, isPending: false, isError: false, error: null, refetch: vi.fn() }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  async function render() {
    await act(async () => {
      root.render(createElement(AgentResourcesDialog, { context, kind: 'mcp', onClose: () => {} }))
    })
  }

  it('keeps the last successful MCP result visible when a background poll fails', async () => {
    mocks.inspection = {
      data: inspection,
      isPending: false,
      isError: true,
      error: new Error('poll failed'),
      isFetching: false,
      refetch: vi.fn(),
    }
    await render()
    expect(document.body.textContent).toContain('Montree 文档与阅读工具')
    expect(document.body.textContent).toContain('刷新失败，显示上次结果：poll failed')
  })

  it('keeps manual refresh available during background MCP polling', async () => {
    mocks.inspection = {
      data: inspection,
      isPending: false,
      isError: false,
      error: null,
      isFetching: true,
      refetch: vi.fn(),
    }
    await render()
    const refresh = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('刷新'))
    expect(refresh).toBeDefined()
    expect(refresh?.disabled).toBe(false)
  })

  it('shows the blocking error only when there is no successful result', async () => {
    mocks.inspection = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('first load failed'),
      isFetching: false,
      refetch: vi.fn(),
    }
    await render()
    expect(document.body.textContent).toContain('first load failed')
    expect(document.body.textContent).not.toContain('最近检查')
  })
})
