// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentResultEntry } from '@yitom/chat-ui'
import { ToolBusinessResult } from '@/components/agent/tools/ToolBusinessResult'
import { ChatMessageBubble } from '@yitom/chat-ui'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 注：工作记录行为（U2）已随 `AgentActivityGroup` 宿主适配器退出，由包
// `ChatActivityGroup` 及包侧工作记录测试覆盖；此处仅保留
// 结果独立入口与业务槽位（U3，仍是宿主接线职责）。

let seq = 0
function toolMsg(overrides: Partial<AcpChatMessage>): AcpChatMessage {
  seq += 1
  return {
    id: `t-${seq}`,
    role: 'tool',
    text: '输出',
    createdAt: 1000 + seq,
    updatedAt: 2000 + seq,
    toolCallId: `tc-${seq}`,
    toolKind: 'read',
    toolTitle: 'read_text_file',
    toolStatus: 'completed',
    streaming: false,
    ...overrides,
  }
}

describe('AgentResultEntry 结果独立入口（U3）', () => {
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
    queryClient.clear()
  })

  const diagramText = JSON.stringify({
    diagramId: 'd1',
    diagramType: 'flowchart',
    title: '推演',
    summary: '摘要',
    mermaidCode: 'graph TD; A-->B',
  })

  function renderEntry(message: AcpChatMessage) {
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentResultEntry, {
            message,
            businessResultSlot: createElement(ToolBusinessResult, { message, compactResults: true }),
          }),
        ),
      )
    })
  }

  it('结果只渲染一次：一个过程壳 + 一张业务卡', () => {
    renderEntry(toolMsg({ toolTitle: 'montree_generate_diagram', toolContentText: diagramText }))
    expect(container.querySelectorAll('[data-slot="ai-tool"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="diagram-viewer-card"]')).toHaveLength(1)
  })

  it('图表默认紧凑：标题摘要在，完整功能经入口进入', () => {
    renderEntry(toolMsg({ toolTitle: 'montree_generate_diagram', toolContentText: diagramText }))
    expect(container.textContent).toContain('推演')
    // 紧凑态不直接渲染 Mermaid 画布
    expect(container.querySelector('.mermaid')).toBeNull()
    const entry = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('查看完整图表'),
    ) as HTMLElement
    expect(entry).toBeTruthy()
    act(() => {
      entry.click()
    })
    // 完整视图同步出现（复制入口与概览页签）；Mermaid 出图为异步，不在此断言
    expect(container.textContent).toContain('复制代码')
    expect(container.textContent).toContain('概览')
  })

  it('失败默认收起但摘要可见，恢复操作在折叠外', () => {
    const failed = toolMsg({
      toolTitle: 'montree_propose_mark',
      toolStatus: 'failed',
      text: '定位失败：正文未找到该句',
      toolContentText: '定位失败：正文未找到该句',
    })
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ChatMessageBubble, {
            message: failed,
            resolveMarkProposal: useAcpUiStore.getState().resolveMarkProposal,
            pendingPermission: useAcpUiStore.getState().pendingPermission,
          }),
        ),
      )
    })
    // 失败徽标与短错误摘要可见（行内 headline），原始长 pre 不默认展开
    expect(container.textContent).toContain('失败')
    expect(container.textContent).toContain('操作未成功')
    expect(container.querySelector('pre')).toBeNull()
    // 恢复操作在折叠外可点
    expect(container.textContent).toContain('去划词')
  })

  it('待审批走工具卡且审批槽在折叠外唯一', () => {
    const pendingId = 'tc-approval-1'
    useAcpUiStore.setState({
      pendingPermission: {
        requestId: 7,
        toolCallId: pendingId,
        summary: '执行命令',
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
    })
    try {
      const message = toolMsg({ toolCallId: pendingId, toolTitle: 'terminal', toolStatus: 'pending' })
      act(() => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(ChatMessageBubble, {
              message,
              resolveMarkProposal: useAcpUiStore.getState().resolveMarkProposal,
              pendingPermission: useAcpUiStore.getState().pendingPermission,
            }),
          ),
        )
      })
      // 审批卡渲染（折叠外），且仍走工具卡而非结果入口
      expect(container.querySelectorAll('[data-testid="agent-permission-card"]')).toHaveLength(1)
      expect(container.querySelectorAll('[data-testid="diagram-viewer-card"]')).toHaveLength(0)
      expect(container.textContent).toContain('等待批准')
    } finally {
      useAcpUiStore.setState({ pendingPermission: null })
    }
  })
})
