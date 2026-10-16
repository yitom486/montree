// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupChatTimeline, type ChatMessage } from '@montree/chat-core'
import { ChatActivityGroup, type ChatActivityGroupProps, type ChatWorkLogItem, type GenerativeSubmitPayload } from '@montree/chat-ui'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const user: ChatMessage = { id: 'user-1', role: 'user', text: '查阅', createdAt: 1 }
function tool(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'tool', text: `${id}工具输出`, createdAt: 1000, updatedAt: 2000,
    toolCallId: `call-${id}`, toolTitle: 'read_text_file', toolKind: 'read',
    toolStatus: 'completed', streaming: false, ...overrides }
}

function workLog(messages: ChatMessage[]): ChatWorkLogItem {
  const item = groupChatTimeline([user, ...messages], { scopeKey: 'test-thread', nowMs: 3000 }).find((item) => item.kind === 'work-log')
  if (!item || item.kind !== 'work-log') throw new Error('work-log missing')
  return item
}

describe('ChatActivityGroup 可移植工作记录交互', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(group: ChatWorkLogItem, props: Partial<ChatActivityGroupProps> = {}) {
    act(() => { root.render(h(ChatActivityGroup, { key: group.key, group, resolveMarkProposal: () => {}, pendingPermission: null, ...props })) })
  }
  function header(): HTMLButtonElement {
    return container.querySelector('[data-slot="agent-activity"] > button')!
  }
  function row(): HTMLButtonElement {
    return container.querySelector('[data-slot="agent-activity-row"] > button')!
  }
  function click(button: HTMLButtonElement) { act(() => button.click()) }

  it('运行中摘要统计全回合，只展示最新工具；新调用复用行并重置旧详情', () => {
    const completed = tool('old', { toolTitle: 'search' })
    const running = tool('running', { streaming: true, toolStatus: 'in_progress' })
    render(workLog([completed, running]))
    expect(header().textContent).toContain('1/2')
    expect(header().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[data-slot="agent-activity-row"]')).toHaveLength(1)
    expect(row().textContent).toContain('读取文件')
    expect(container.textContent).not.toContain('搜索文档')
    expect(container.querySelector('pre')).toBeNull()
    click(row())
    expect(container.textContent).toContain('running工具输出')
    const stableRow = row()
    render(workLog([completed, running, tool('next', { toolTitle: 'search', streaming: true, toolStatus: 'in_progress' })]))
    expect(row()).toBe(stableRow)
    expect(row().getAttribute('aria-expanded')).toBe('false')
    expect(row().textContent).toContain('搜索文档')
    expect(container.textContent).not.toContain('running工具输出')
  })

  it('手动折叠在思考增量与后续工具到达时保持，不被自动展开抢占', () => {
    const thought: ChatMessage = { id: 'thought', role: 'thought', text: '分析证据', createdAt: 1000, streaming: true }
    render(workLog([thought]))
    expect(header().getAttribute('aria-expanded')).toBe('true')
    click(header())
    render(workLog([{ ...thought, text: '分析更多证据' }]))
    expect(header().getAttribute('aria-expanded')).toBe('false')
    render(workLog([{ ...thought, text: '分析更多证据' }, tool('next', { streaming: true, toolStatus: 'in_progress' })]))
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-slot="agent-activity-row"]')).toBeNull()
  })

  it('落定只收起一次，手动再次展开能查看全历史，后续静态更新保持展开', () => {
    const old = tool('old', { toolTitle: 'search' })
    const latest = tool('latest', { toolStatus: 'in_progress', streaming: true })
    render(workLog([old, latest]))
    expect(header().getAttribute('aria-expanded')).toBe('true')
    const settled = workLog([old, { ...latest, toolStatus: 'completed', streaming: false }])
    render(settled)
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.agent-beam-ring-amber')).toBeNull()
    click(header())
    expect(container.querySelectorAll('[data-slot="agent-activity-row"]')).toHaveLength(2)
    expect(container.textContent).toContain('搜索文档')
    expect(container.textContent).toContain('读取文件')
    render({ ...settled, durationLabel: '2秒' })
    expect(header().getAttribute('aria-expanded')).toBe('true')
  })

  it('取消与未知在摘要和详情保持独立状态，不显示完成', () => {
    render(workLog([tool('cancelled', { toolStatus: 'cancelled' })]))
    expect(container.querySelector('[data-slot="agent-activity"]')?.getAttribute('data-state')).toBe('cancelled')
    expect(header().textContent).toContain('已取消 1')
    click(header())
    expect(row().textContent).toContain('已取消')
    expect(container.textContent).not.toContain('已完成')
    render(workLog([tool('unknown', { toolStatus: 'unsupported' })]))
    expect(container.querySelector('[data-slot="agent-activity"]')?.getAttribute('data-state')).toBe('unknown')
    expect(header().textContent).toContain('未知 1')
    expect(row().textContent).toContain('未知')
    expect(container.textContent).not.toContain('已完成')
  })

  it('业务槽与计划槽只有一个 DOM 出口，线程和生成式提交回调贯通工具详情', () => {
    const submit = vi.fn()
    const payload: GenerativeSubmitPayload = { resultId: 'r1', threadId: 'thread-9', title: '结果', selections: { mode: 'brief' }, displayText: '继续', promptText: '继续分析' }
    const plan: ChatMessage = { id: 'plan', role: 'plan', text: '检索计划', createdAt: 1000, planEntries: [{ content: '读章节', status: 'completed' }] }
    render(workLog([plan, tool('with-slot')]), {
      threadId: 'thread-9', prompting: false, onGenerativeSubmit: submit,
      renderPlanCard: (message) => h('div', { 'data-testid': 'plan-slot' }, message.text),
      renderBusinessResult: (message, opts) => h('button', {
        'data-testid': 'business-slot',
        'data-thread': opts.threadId,
        'data-prompting': String(opts.prompting),
        onClick: () => opts.onGenerativeSubmit?.(payload),
      }, message.id),
    })
    click(header())
    expect(container.querySelectorAll('[data-testid="plan-slot"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="business-slot"]')).toBeNull()
    click(row())
    const slot = container.querySelector<HTMLButtonElement>('[data-testid="business-slot"]')!
    expect(container.querySelectorAll('[data-testid="business-slot"]')).toHaveLength(1)
    expect(slot.dataset.thread).toBe('thread-9')
    expect(slot.dataset.prompting).toBe('false')
    click(slot)
    expect(submit).toHaveBeenCalledExactlyOnceWith(payload)
    click(row())
    expect(container.querySelector('[data-testid="business-slot"]')).toBeNull()
    click(row())
    expect(container.querySelectorAll('[data-testid="business-slot"]')).toHaveLength(1)
  })

  it('工具详情中的审批经 prop 回调响应，同一张卡连点只发送一次', () => {
    const permission = { requestId: 11, toolCallId: 'call-pending', summary: '允许读取？', options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }] }
    const respond = vi.fn()
    render(workLog([tool('pending', { streaming: true, toolStatus: 'pending' })]), {
      pendingPermission: permission, onPermissionRespond: respond,
    })
    click(row())
    const cards = container.querySelectorAll('[data-testid="agent-permission-card"]')
    expect(cards).toHaveLength(1)
    const approve = cards[0]!.querySelector('button')!
    act(() => { approve.click(); approve.click() })
    expect(respond).toHaveBeenCalledExactlyOnceWith('allow')
  })
})
