// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentToolCallCard } from './AgentToolCallCard'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { useAcpUiStore } from '@/stores/acp-ui-store'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function tool(overrides: Partial<AcpChatMessage> = {}): AcpChatMessage {
  return {
    id: 'tool-1',
    role: 'tool',
    text: '',
    createdAt: 1000,
    updatedAt: 2000,
    toolCallId: 'tc-1',
    toolKind: 'read',
    toolTitle: 'Read: /w/a.ts',
    toolStatus: 'completed',
    toolContentText: 'const x = 1',
    ...overrides,
  }
}

describe('AgentToolCallCard（社区 Tool 外壳）', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useAcpUiStore.getState().setPendingPermission(null)
  })

  function render(message: AcpChatMessage) {
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentToolCallCard, { message }),
        ),
      )
    })
  }

  function headerExpanded(): boolean | null {
    const header = container.querySelector('[data-slot="ai-tool-header"]')
    if (!header) return null
    return header.getAttribute('aria-expanded') === 'true'
  }

  function approvalCards(): number {
    return container.querySelectorAll('[data-testid="agent-permission-card"]').length
  }

  it('普通成功调用默认收起，只显示标题与已完成徽标', () => {
    render(tool())
    expect(container.textContent).toContain('读取文件')
    expect(container.textContent).toContain('已完成')
    expect(container.textContent).not.toContain('const x = 1')
  })

  it('失败摘要在标题行可见，详情默认展开', () => {
    render(
      tool({ toolStatus: 'failed', toolContentText: '未知工具 xxx', streaming: false }),
    )
    expect(container.textContent).toContain('失败')
    expect(container.textContent).toContain('工具不可用')
    expect(container.textContent).toContain('当前版本不支持')
  })

  it('取消显示已取消，绝不显示成功', () => {
    render(tool({ toolStatus: 'cancelled' }))
    expect(container.textContent).toContain('已取消')
    expect(container.textContent).not.toContain('已完成')
  })

  it('未知状态显示状态未知，绝不显示成功', () => {
    render(tool({ toolStatus: 'mystery-status', streaming: false }))
    expect(container.textContent).toContain('状态未知')
    expect(container.textContent).not.toContain('已完成')
  })

  it('审批操作在折叠容器外且全时间线只有一份', () => {
    useAcpUiStore.getState().setPendingPermission({
      requestId: 7,
      summary: '删除文件 a.ts',
      options: [
        { optionId: 'allow-once', name: '允许', kind: 'allow_once' },
        { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
      ],
      toolCallId: 'tc-1',
    })
    render(tool({ toolStatus: 'pending' }))
    expect(container.textContent).toContain('等待批准')
    // 详情默认收起（pending 非流式），但审批按钮仍然可见
    expect(approvalCards()).toBe(1)
    expect(container.textContent).toContain('删除文件 a.ts')
  })

  it('无正文的待审批工具（静态行）同样外挂一份审批卡', () => {
    // 真实 permission 先到、tool content 尚未到达时的形态：hasBodyDetails 为 false。
    // 回归：审批卡不能因为走静态行而消失（R2 阻断缺陷）。
    useAcpUiStore.getState().setPendingPermission({
      requestId: 8,
      summary: '执行删除',
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      toolCallId: 'tc-1',
    })
    render(
      tool({
        toolStatus: 'pending',
        toolTitle: 'delete_file',
        toolContentText: '',
        text: 'delete_file',
        toolKind: 'delete',
      }),
    )
    expect(container.textContent).toContain('等待批准')
    expect(approvalCards()).toBe(1)
    expect(container.textContent).toContain('执行删除')
  })

  it('执行中展开的普通工具完成后自动收起（用户未主动选择时）', () => {
    const running = tool({ toolStatus: 'in_progress', streaming: true })
    render(running)
    expect(headerExpanded()).toBe(true)
    render({ ...running, toolStatus: 'completed', streaming: false })
    expect(headerExpanded()).toBe(false)
    expect(container.textContent).not.toContain('const x = 1')
  })

  it('用户主动展开后，完成时保持展开（不覆盖用户选择）', () => {
    const running = tool({ toolStatus: 'in_progress', streaming: true })
    render(running)
    // running 默认已展开：先手动收起再展开，标记一次主动选择
    const header = container.querySelector<HTMLElement>('[data-slot="ai-tool-header"]')!
    act(() => {
      header.click()
    })
    expect(headerExpanded()).toBe(false)
    act(() => {
      header.click()
    })
    expect(headerExpanded()).toBe(true)
    render({ ...running, toolStatus: 'completed', streaming: false })
    expect(headerExpanded()).toBe(true)
  })

  it('落定的未知残留默认收起，不顶进行中样式', () => {
    render(tool({ toolStatus: 'in_progress', streaming: false }))
    expect(container.textContent).toContain('状态未知')
    expect(headerExpanded()).toBe(false)
  })
})
