import { describe, expect, it } from 'vitest'
import {
  shouldShowOrphanPermissionCard,
  timelineRendersInlineApproval,
  toolMessageNeedsApproval,
} from './permission-ui'
import type { PendingApprovalRef } from './permission-ui'
import { groupChatTimeline } from './chat-timeline'
import type { ChatMessage } from './chat-message'

const pending = (partial: Partial<PendingApprovalRef> = {}): PendingApprovalRef => ({
  toolCallId: 'tc-del',
  ...partial,
})

describe('toolMessageNeedsApproval', () => {
  it('matches pending toolCallId on tool messages', () => {
    expect(
      toolMessageNeedsApproval({ role: 'tool', toolCallId: 'tc-del' }, pending()),
    ).toBe(true)
    expect(
      toolMessageNeedsApproval({ role: 'tool', toolCallId: 'other' }, pending()),
    ).toBe(false)
    expect(
      toolMessageNeedsApproval({ role: 'agent', toolCallId: 'tc-del' }, pending()),
    ).toBe(false)
  })
})

describe('shouldShowOrphanPermissionCard', () => {
  it('shows when no toolCallId', () => {
    expect(
      shouldShowOrphanPermissionCard(pending({ toolCallId: undefined }), []),
    ).toBe(true)
  })

  it('shows when tool not yet in timeline', () => {
    expect(
      shouldShowOrphanPermissionCard(pending(), [
        { role: 'agent' },
        { role: 'tool', toolCallId: 'other' },
      ]),
    ).toBe(true)
  })

  it('hides when matching tool card exists (inline buttons instead)', () => {
    expect(
      shouldShowOrphanPermissionCard(pending(), [
        { role: 'tool', toolCallId: 'tc-del' },
      ]),
    ).toBe(false)
  })

  it('hides when no pending', () => {
    expect(shouldShowOrphanPermissionCard(null, [])).toBe(false)
  })

  it('shows when matching tool exists but is cropped from the visible window', () => {
    // AgentMessageList 只把可见窗口传给兜底：历史裁剪掉对应工具卡时、
    // 审批按钮不能跟着消失（R2 单一审批挂载规则回归）。
    expect(
      shouldShowOrphanPermissionCard(pending(), [
        { role: 'agent' },
        { role: 'tool', toolCallId: 'other' },
      ]),
    ).toBe(true)
  })

  it('single-mount rule: visible matching tool owns the approval, orphan stays hidden', () => {
    expect(
      shouldShowOrphanPermissionCard(pending(), [
        { role: 'agent' },
        { role: 'tool', toolCallId: 'tc-del' },
      ]),
    ).toBe(false)
  })
})

describe('timelineRendersInlineApproval', () => {
  const msg = (overrides: Partial<ChatMessage>): ChatMessage => ({
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'agent',
    text: '',
    createdAt: 1000,
    ...overrides,
  })

  it('工作记录内的匹配工具算已渲染（审批槽在组内卡外挂）', () => {
    const items = groupChatTimeline(
      [
        msg({ role: 'thought', text: '想' }),
        msg({ role: 'tool', toolCallId: 'tc-del', toolTitle: 'Delete', toolStatus: 'in_progress', streaming: true }),
      ],
      { nowMs: 2000 },
    )
    expect(timelineRendersInlineApproval(items, 'tc-del')).toBe(true)
    expect(timelineRendersInlineApproval(items, 'other')).toBe(false)
  })

  it('被分组跳过的消息不算渲染：promote 后隐藏的工具仍需兜底', () => {
    // 空时间线（匹配工具被裁剪/跳过）→ 无内联槽，调用方应浮出兜底
    expect(timelineRendersInlineApproval([], 'tc-del')).toBe(false)
    expect(timelineRendersInlineApproval([], undefined)).toBe(false)
    expect(timelineRendersInlineApproval([], null)).toBe(false)
  })

  it('待审批提升为单条后算已渲染，与兜底互斥', () => {
    const items = groupChatTimeline(
      [msg({ role: 'tool', toolCallId: 'tc-del', toolTitle: 'Delete', toolStatus: 'pending' })],
      { pendingToolCallId: 'tc-del', nowMs: 2000 },
    )
    expect(items[0]?.kind).toBe('message')
    expect(timelineRendersInlineApproval(items, 'tc-del')).toBe(true)
  })
})
