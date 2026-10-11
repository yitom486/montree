// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToolApprovalSlot } from './ToolApprovalSlot'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpPendingPermission } from '@/stores/acp-ui-store'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const pending: AcpPendingPermission = {
  requestId: 71,
  summary: '删除文件',
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
  toolCallId: 'tc-1',
}

describe('ToolApprovalSlot', () => {
  let container: HTMLDivElement
  let root: Root
  const queryClient = new QueryClient()

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
    useAcpUiStore.getState().setPendingPermission(null)
  })

  function renderSlot(message: { role: 'tool'; toolCallId?: string }) {
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ToolApprovalSlot, { message }),
        ),
      )
    })
  }

  it('命中当前 pending 时渲染唯一审批卡', () => {
    useAcpUiStore.getState().setPendingPermission(pending)
    renderSlot({ role: 'tool', toolCallId: 'tc-1' })
    expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(1)
  })

  it('toolCallId 不一致时不渲染', () => {
    useAcpUiStore.getState().setPendingPermission(pending)
    renderSlot({ role: 'tool', toolCallId: 'other' })
    expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(0)
  })

  it('无 pending 时不渲染', () => {
    renderSlot({ role: 'tool', toolCallId: 'tc-1' })
    expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(0)
  })
})
