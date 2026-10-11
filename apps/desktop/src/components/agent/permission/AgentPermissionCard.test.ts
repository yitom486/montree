// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPermissionCard } from './AgentPermissionCard'
import { acpApi } from '@/api/acp-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpPendingPermission } from '@/stores/acp-ui-store'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const pending: AcpPendingPermission = {
  requestId: 71,
  summary: '删除文件',
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
  toolCallId: 'tc-1',
}

describe('AgentPermissionCard 响应幂等', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useAcpUiStore.getState().setPendingPermission(pending)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useAcpUiStore.getState().setPendingPermission(null)
    vi.restoreAllMocks()
  })

  function mountCard(value: AcpPendingPermission = pending): HTMLElement {
    act(() => {
      root.render(createElement(AgentPermissionCard, { pending: value }))
    })
    return container
  }

  it('镜像旧卡与重复点击只发送一次响应', () => {
    const respond = vi.spyOn(acpApi, 'respondPermission').mockReturnValue({ ok: true, value: undefined })
    // 双面板镜像：同一请求挂两份卡（两个挂载点），各点一次 Allow，只发送一次
    const host2 = document.createElement('div')
    document.body.appendChild(host2)
    const root2 = createRoot(host2)
    try {
      act(() => {
        root.render(createElement(AgentPermissionCard, { pending }))
        root2.render(createElement(AgentPermissionCard, { pending }))
      })
      const buttons = [...container.querySelectorAll('button'), ...host2.querySelectorAll('button')]
      act(() => {
        buttons[0]!.click()
      })
      expect(respond).toHaveBeenCalledTimes(1)
      act(() => {
        buttons[1]!.click()
      })
      expect(respond).toHaveBeenCalledTimes(1)
    } finally {
      act(() => {
        root2.unmount()
      })
      host2.remove()
    }
  })

  it('同一按钮连点只发送一次', () => {
    const respond = vi.spyOn(acpApi, 'respondPermission').mockReturnValue({ ok: true, value: undefined })
    useAcpUiStore.getState().setPendingPermission(pending)
    mountCard()
    const button = container.querySelector('button')!
    act(() => {
      button.click()
      button.click()
    })
    expect(respond).toHaveBeenCalledTimes(1)
  })

  it('请求已被替换时旧卡不再发送', () => {
    const respond = vi.spyOn(acpApi, 'respondPermission').mockReturnValue({ ok: true, value: undefined })
    mountCard()
    useAcpUiStore.getState().setPendingPermission({ ...pending, requestId: 72 })
    const staleButton = container.querySelector('button')!
    act(() => {
      staleButton.click()
    })
    expect(respond).not.toHaveBeenCalled()
  })
})
