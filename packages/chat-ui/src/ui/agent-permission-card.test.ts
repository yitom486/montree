// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPermissionCard, type AgentApprovalPending } from './agent-permission-card'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const pending: AgentApprovalPending = {
  requestId: 71,
  summary: '删除文件',
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
  toolCallId: 'tc-1',
}

describe('AgentPermissionCard（解耦：响应经 onRespond 回宿主）', () => {
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

  function mountCard(onRespond: (optionId: string | null) => void, value: AgentApprovalPending = pending): HTMLElement {
    act(() => {
      root.render(createElement(AgentPermissionCard, { pending: value, onRespond }))
    })
    return container
  }

  it('点击选项上报 optionId', () => {
    const onRespond = vi.fn()
    mountCard(onRespond)
    const button = container.querySelector('button')!
    act(() => {
      button.click()
    })
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith('allow')
  })

  it('同一按钮连点只上报一次', () => {
    const onRespond = vi.fn()
    mountCard(onRespond)
    const button = container.querySelector('button')!
    act(() => {
      button.click()
      button.click()
    })
    expect(onRespond).toHaveBeenCalledTimes(1)
  })

  it('取消上报 null', () => {
    const onRespond = vi.fn()
    mountCard(onRespond)
    const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent === '取消')!
    act(() => {
      cancel.click()
    })
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith(null)
  })

  it('空选项时回退为允许/拒绝两项', () => {
    const onRespond = vi.fn()
    mountCard(onRespond, { ...pending, options: [] })
    const labels = [...container.querySelectorAll('[data-testid="bui-approval-card"] button')]
      .map((b) => b.textContent)
      .filter((t) => t !== '取消')
    expect(labels).toEqual(['允许', '拒绝'])
    act(() => {
      ;(container.querySelector('[data-testid="bui-approval-card"] button') as HTMLButtonElement).click()
    })
    expect(onRespond).toHaveBeenCalledWith('allow-once')
  })
})
