// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolApprovalSlot } from './tool-approval-slot'
import type { AgentApprovalPending } from './agent-permission-card'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const pending: AgentApprovalPending = {
  requestId: 71,
  summary: '删除文件',
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
  toolCallId: 'tc-1',
}

describe('ToolApprovalSlot（解耦：pending 作 prop 输入）', () => {
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

  function renderSlot(message: { role: 'tool'; toolCallId?: string }, value: AgentApprovalPending | null) {
    const onRespond = vi.fn()
    act(() => {
      root.render(createElement(ToolApprovalSlot, { message, pending: value, onRespond }))
    })
    return onRespond
  }

  it('命中当前 pending 时渲染唯一审批卡', () => {
    renderSlot({ role: 'tool', toolCallId: 'tc-1' }, pending)
    expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(1)
  })

  it('toolCallId 不一致时不渲染', () => {
    renderSlot({ role: 'tool', toolCallId: 'other' }, pending)
    expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(0)
  })

  it('无 pending 时不渲染', () => {
    renderSlot({ role: 'tool', toolCallId: 'tc-1' }, null)
    expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(0)
  })

  it('审批选择透传给 onRespond', () => {
    const onRespond = renderSlot({ role: 'tool', toolCallId: 'tc-1' }, pending)
    const button = container.querySelector('button')!
    act(() => {
      button.click()
    })
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith('allow')
  })
})
