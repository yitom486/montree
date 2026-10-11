// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentActivityGroup, type WorkLogItem } from './AgentActivityGroup'
import { AgentResultEntry } from '@/components/agent/tools/AgentResultEntry'
import { AgentMessageBubble } from './AgentMessageBubble'
import { groupChatTimeline } from '@/lib/agent/chat-timeline'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

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

function workLogOf(messages: AcpChatMessage[]): WorkLogItem {
  const user: AcpChatMessage = { id: 'u-9', role: 'user', text: '查', createdAt: 1 }
  const timeline = groupChatTimeline([user, ...messages], { nowMs: 9999 })
  const group = timeline.find((i) => i.kind === 'work-log')
  if (!group || group.kind !== 'work-log') throw new Error('expected work-log')
  return group
}

describe('AgentActivityGroup 工作记录（U2）', () => {
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

  function render(group: WorkLogItem) {
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentActivityGroup, { group }),
        ),
      )
    })
  }

  it('运行中默认收起，只显示真实当前操作', () => {
    const running = toolMsg({ toolStatus: 'in_progress', streaming: true, toolTitle: 'read_text_file' })
    render(workLogOf([running]))
    expect(container.textContent).toContain('读取文件')
    // 收起：详情输出不可见
    expect(container.textContent).not.toContain('输出')
    expect(container.querySelector('[aria-expanded="false"]')).not.toBeNull()
  })

  it('运行摘要显示进度与最近事件，附呼吸微光条', () => {
    const running = toolMsg({ id: 't-r', toolCallId: 'tc-r', toolStatus: 'in_progress', streaming: true, toolTitle: 'read_text_file' })
    const done = toolMsg({ id: 't-d', toolCallId: 'tc-d', toolStatus: 'completed', streaming: false, toolTitle: 'search' })
    render(workLogOf([running, done]))
    // 进度 1/2（运行中不计入 done），最近事件是落定的搜索
    expect(container.textContent).toContain('1/2')
    expect(container.textContent).toContain('✓')
    expect(container.textContent).toContain('搜索文档')
    // 运行中的呼吸条存在（aria-hidden 装饰），落定组没有
    expect(container.querySelector('button > span[aria-hidden="true"]')).not.toBeNull()
  })

  it('用户打开后，落定/后续 chunk 不覆盖选择', () => {
    const running = toolMsg({ id: 't-run', toolCallId: 'tc-run', toolStatus: 'in_progress', streaming: true })
    const group = workLogOf([running])
    render(group)
    const toggle = container.querySelector('button[aria-expanded]') as HTMLElement
    act(() => {
      toggle.click()
    })
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull()
    // 再打开行内单个调用（排除组汇总行：含“历时”的是组按钮）
    const row = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('读取文件') && !b.textContent?.includes('历时'),
    ) as HTMLElement
    act(() => {
      row.click()
    })
    expect(container.textContent).toContain('输出')
    // 落定：同一 key 重渲染，组与行仍保持打开；
    // 同一行直接呈现详情，无第二个工具头；完成不会收起已打开的行。
    const settled = workLogOf([{ ...running, streaming: false, toolStatus: 'completed' }])
    expect(settled.key).toBe(group.key)
    render(settled)
    expect(container.querySelectorAll('[aria-expanded="true"]').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('button').length).toBe(2)
    expect(container.textContent).toContain('输出')
  })

  it('取消/未知在摘要可见，不判成功', () => {
    const group = workLogOf([
      toolMsg({ toolStatus: 'cancelled' }),
      toolMsg({ toolTitle: 'mystery-tool', toolStatus: undefined }),
    ])
    render(group)
    expect(container.textContent).toContain('已取消 1')
    expect(container.textContent).toContain('未知 1')
    expect(container.textContent).not.toContain('已完成')
  })

  it('详情行按需展开单个调用，不套整组气泡', () => {
    const group = workLogOf([toolMsg({ toolTitle: 'read_text_file' })])
    render(group)
    act(() => {
      ;(container.querySelector('button[aria-expanded]') as HTMLElement).click()
    })
    const row = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('读取文件') && !b.textContent?.includes('历时'),
    ) as HTMLElement
    expect(row).toBeTruthy()
    act(() => {
      row.click()
    })
    // 一次展开直接看到详情，没有第二层需要点击的工具头。
    expect(container.querySelectorAll('button').length).toBe(2)
    expect(container.textContent).toContain('输出')
    expect(container.querySelector('pre')).not.toBeNull()
  })
})

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
          createElement(AgentResultEntry, { message }),
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
          createElement(AgentMessageBubble, { message: failed }),
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
            createElement(AgentMessageBubble, { message }),
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
