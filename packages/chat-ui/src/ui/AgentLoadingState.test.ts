// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentLoadingState, currentRunStatus } from './AgentLoadingState'
import type { ChatMessage as AcpChatMessage } from '@montree/chat-core'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function message(role: AcpChatMessage['role'], extra: Partial<AcpChatMessage> = {}): AcpChatMessage {
  return { id: role, role, text: '', createdAt: 1000, ...extra }
}

describe('真实回合状态', () => {
  it('工具状态包含真实任务摘要，即使有上一阶段残留的思考消息', () => {
    const messages = [message('user'), message('thought', { text: '考虑中', streaming: true }), message('tool', {
      streaming: true, toolStatus: 'in_progress', toolTitle: 'Call Mcp Tool', toolName: 'montree_present',
      toolInputSummary: { kind: 'preset', preset: 'diagram', diagramType: 'sequence', title: '登录过程' },
    })]
    expect(currentRunStatus(messages, false)).toEqual({ phase: 'tool', label: '正在绘制时序图：登录过程' })
  })
  it('没有 reasoning 事件时只说等待响应', () => {
    expect(currentRunStatus([message('user'), message('agent', { streaming: true })], false).phase).toBe('waiting')
  })
  it('真实 reasoning 事件才说思考中', () => {
    expect(currentRunStatus([message('user'), message('thought', { streaming: true })], false).phase).toBe('thinking')
  })
  it('审批优先于工具运行，终态工具不冒充执行中', () => {
    const messages = [message('user'), message('tool', { toolStatus: 'in_progress', toolTitle: '读取当前页' })]
    expect(currentRunStatus(messages, true).phase).toBe('approval')
    expect(currentRunStatus(messages, false).label).toContain('读取当前页')
    // 终态工具不冒充执行中：转入组织回答而非等待响应（仍非 tool 相）
    expect(currentRunStatus([message('user'), message('tool', { toolStatus: 'failed', turnEnded: true })], false).phase).toBe('composing')
  })
  it('工具完成后、文本间隙显示正在组织回答；空占位仍是等待响应', () => {
    expect(
      currentRunStatus([message('user'), message('tool', { toolStatus: 'completed', toolTitle: '搜索文档' })], false),
    ).toEqual({ phase: 'composing', label: '正在组织回答' })
    expect(
      currentRunStatus([message('user'), message('agent', { text: '半截回答', streaming: false })], false).phase,
    ).toBe('composing')
    expect(
      currentRunStatus([message('user'), message('agent', { text: '   ', streaming: true })], false).phase,
    ).toBe('waiting')
  })
  it('不把上一回合的事件用于当前状态', () => {
    expect(currentRunStatus([message('thought', { streaming: true }), message('user')], false).phase).toBe('waiting')
  })
  it('回合进行中但无实质事件：说正在思考而非干等', () => {
    // 首包未到：只有用户提问
    expect(currentRunStatus([message('user')], false, true)).toEqual({ phase: 'thinking', label: '正在思考' })
    // 无正文思考被 ingest 丢弃：只剩空占位，仍算进行中
    expect(
      currentRunStatus([message('user'), message('agent', { text: '   ', streaming: true })], false, true),
    ).toEqual({ phase: 'thinking', label: '正在思考' })
    // 回合已结束才回落干等
    expect(currentRunStatus([message('user')], false, false).phase).toBe('waiting')
  })
  it('回合进行中有进展：仍说正在组织回答而非正在思考', () => {
    expect(
      currentRunStatus([message('user'), message('tool', { toolStatus: 'completed', toolTitle: '搜索文档' })], false, true).phase,
    ).toBe('composing')
  })
})

/** 用量后缀：可选 prop，缺省无后缀（零视觉变化），有值时在 label 后渲染。 */
describe('AgentLoadingState 用量后缀', () => {
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

  it('缺省不渲染后缀', () => {
    act(() => {
      root.render(createElement(AgentLoadingState, { label: '思考中', seconds: null }))
    })
    const row = container.querySelector('[data-testid="agent-loading-state"]')
    expect(row).not.toBeNull()
    expect(row!.textContent).not.toContain('已用')
  })

  it('有值时在 label 后以次级样式渲染', () => {
    act(() => {
      root.render(
        createElement(AgentLoadingState, { label: '思考中', seconds: null, usageText: '已用 8.3k tokens' }),
      )
    })
    expect(container.textContent).toContain('思考中')
    expect(container.textContent).toContain('已用 8.3k tokens')
  })
})
