import { describe, expect, it } from 'vitest'
import { currentRunStatus } from './AgentLoadingState'
import type { ChatMessage as AcpChatMessage } from '@montree/chat-core'

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
