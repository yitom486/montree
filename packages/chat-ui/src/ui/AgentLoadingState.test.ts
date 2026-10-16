import { describe, expect, it } from 'vitest'
import { currentRunStatus } from './AgentLoadingState'
import type { ChatMessage as AcpChatMessage } from '@montree/chat-core'

function message(role: AcpChatMessage['role'], extra: Partial<AcpChatMessage> = {}): AcpChatMessage {
  return { id: role, role, text: '', createdAt: 1000, ...extra }
}

describe('真实回合状态', () => {
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
})
