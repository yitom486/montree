import { describe, expect, it } from 'vitest'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { groupChatTimeline, isRichToolMessage } from './chat-timeline'

let seq = 0
function msg(overrides: Partial<AcpChatMessage>): AcpChatMessage {
  seq += 1
  return {
    id: `msg-${seq}`,
    role: 'agent',
    text: '',
    createdAt: 1000 + seq,
    ...overrides,
  }
}

describe('isRichToolMessage', () => {
  it('识别图表工具为富卡片', () => {
    expect(
      isRichToolMessage(
        msg({
          role: 'tool',
          toolTitle: 'montree_generate_diagram',
          text: JSON.stringify({ mermaidCode: 'graph TD; A-->B' }),
        }),
      ),
    ).toBe(true)
  })

  it('普通文件读取工具不是富卡片', () => {
    expect(
      isRichToolMessage(
        msg({ role: 'tool', toolTitle: 'Read: /path/to/file.ts', toolContentText: 'x' }),
      ),
    ).toBe(false)
  })
})

describe('groupChatTimeline', () => {
  it('连续 thought/tool 收成工作记录，计数只算工具调用', () => {
    const user = msg({ role: 'user', text: '你好' })
    const thought = msg({ role: 'thought', text: '想' })
    const t1 = msg({ role: 'tool', toolTitle: 'Read: /a.ts', toolStatus: 'completed' })
    const t2 = msg({ role: 'tool', toolTitle: 'Read: /b.ts', toolStatus: 'completed' })
    const reply = msg({ role: 'agent', text: '好' })
    const timeline = groupChatTimeline([user, thought, t1, t2, reply], { nowMs: 5000 })

    expect(timeline.map((i) => i.kind)).toEqual(['message', 'work-log', 'message'])
    const group = timeline[1]!
    expect(group.kind).toBe('work-log')
    if (group.kind === 'work-log') {
      expect(group.messages).toHaveLength(3)
      expect(group.toolCallCount).toBe(2)
      expect(group.hasFailure).toBe(false)
      expect(group.isActive).toBe(false)
      expect(group.endedAt).not.toBeNull()
      expect(group.currentAction).toBeNull()
    }
  })

  it('失败工具提升为单条，主时间线可见', () => {
    const thought = msg({ role: 'thought', text: '想' })
    const failed = msg({ role: 'tool', toolTitle: 'Read', toolStatus: 'failed' })
    const timeline = groupChatTimeline([thought, failed], { nowMs: 5000 })
    expect(timeline.map((i) => i.kind)).toEqual(['work-log', 'message'])
    expect(timeline[1]?.kind).toBe('message')
    if (timeline[1]?.kind === 'message') {
      expect(timeline[1].message.toolStatus).toBe('failed')
    }
  })

  it('待审批工具提升为单条，不被工作记录折叠吞掉', () => {
    const thought = msg({ role: 'thought', text: '想' })
    const pending = msg({
      role: 'tool',
      toolCallId: 'tc-del',
      toolTitle: 'Delete',
      toolStatus: 'pending',
    })
    const timeline = groupChatTimeline([thought, pending], {
      pendingToolCallId: 'tc-del',
      nowMs: 5000,
    })
    expect(timeline.map((i) => i.kind)).toEqual(['work-log', 'message'])
    const group = timeline[0]!
    if (group.kind === 'work-log') {
      expect(group.hasAwaitingApproval).toBe(false)
    }
  })

  it('工作记录标注等待审批但不吞按钮（非命中组仅标记）', () => {
    const pending = msg({
      role: 'tool',
      toolCallId: 'tc-del',
      toolTitle: 'Delete',
      toolStatus: 'pending',
    })
    const timeline = groupChatTimeline([pending], {
      pendingToolCallId: 'other-id',
      nowMs: 5000,
    })
    expect(timeline[0]?.kind).toBe('work-log')
  })

  it('富卡片提升到主时间线', () => {
    const read = msg({ role: 'tool', toolTitle: 'Read: chapter.html', toolStatus: 'completed' })
    const diagram = msg({
      role: 'tool',
      toolTitle: 'montree_generate_diagram',
      toolStatus: 'completed',
      toolContentText: JSON.stringify({ diagramId: 'd', mermaidCode: 'graph TD; A-->B' }),
    })
    const timeline = groupChatTimeline([read, diagram], { nowMs: 5000 })
    expect(timeline.map((i) => i.kind)).toEqual(['work-log', 'message'])
  })

  it('进行中工作记录给出当前操作与历时，endedAt 为空', () => {
    const t = msg({
      role: 'tool',
      toolTitle: 'Read: /a.ts',
      toolStatus: 'in_progress',
      streaming: true,
      createdAt: 1000,
    })
    const timeline = groupChatTimeline([t], { nowMs: 4000 })
    const group = timeline[0]!
    expect(group.kind).toBe('work-log')
    if (group.kind === 'work-log') {
      expect(group.isActive).toBe(true)
      expect(group.endedAt).toBeNull()
      expect(group.currentAction).toBe('读取文件')
      expect(group.durationLabel).toBe('3s')
    }
  })

  it('当前操作只选仍在运行的工具，已完成的后来者不冒充', () => {
    const running = msg({
      role: 'tool',
      toolCallId: 'tc-read',
      toolTitle: 'read_text_file',
      toolStatus: 'in_progress',
      streaming: true,
      createdAt: 1000,
    })
    const done = msg({
      role: 'tool',
      toolCallId: 'tc-search',
      toolTitle: 'search',
      toolStatus: 'completed',
      streaming: false,
      createdAt: 1100,
    })
    const timeline = groupChatTimeline([running, done], { nowMs: 4000 })
    expect(timeline[0]?.kind).toBe('work-log')
    if (timeline[0]?.kind === 'work-log') {
      expect(timeline[0].currentAction).toBe('读取文件')
    }
  })

  it('多个并行运行时表达数量，不伪造串行顺序', () => {
    const a = msg({
      role: 'tool', toolCallId: 'tc-a', toolTitle: 'read_text_file',
      toolStatus: 'in_progress', streaming: true, createdAt: 1000,
    })
    const b = msg({
      role: 'tool', toolCallId: 'tc-b', toolTitle: 'search',
      toolStatus: 'in_progress', streaming: true, createdAt: 1000,
    })
    const timeline = groupChatTimeline([a, b], { nowMs: 4000 })
    if (timeline[0]?.kind === 'work-log') {
      expect(timeline[0].currentAction).toBe('2 个工具并行执行')
    } else {
      expect.unreachable('应为工作记录组')
    }
  })

  it('组内无运行工具时回退“工作中”，不把完成工具当当前动作', () => {
    const thought = msg({ role: 'thought', text: '想', streaming: true, createdAt: 1000 })
    const done = msg({
      role: 'tool', toolCallId: 'tc-d', toolTitle: 'search',
      toolStatus: 'completed', streaming: false, createdAt: 1100,
    })
    const timeline = groupChatTimeline([thought, done], { nowMs: 4000 })
    // done 已完成：按失败/富卡片规则不提升，组内仅 thought 流式
    if (timeline[0]?.kind === 'work-log') {
      expect(timeline[0].currentAction).toBe('工作中')
    } else {
      expect.unreachable('应为工作记录组')
    }
  })

  it('key 稳定：尾部追加不改变既有组 key，无重复条目', () => {
    const thought = msg({ role: 'thought', text: '想' })
    const t1 = msg({ role: 'tool', toolTitle: 'A', toolStatus: 'completed' })
    const first = groupChatTimeline([thought, t1], { nowMs: 5000 })
    const t2 = msg({ role: 'tool', toolTitle: 'B', toolStatus: 'completed' })
    const second = groupChatTimeline([thought, t1, t2], { nowMs: 5000 })
    expect(first[0]?.key).toBe(second[0]?.key)
    const seen = second.flatMap((i) => (i.kind === 'work-log' ? i.messages : [i.message]))
    expect(seen.map((m) => m.id).sort()).toEqual(
      [thought, t1, t2].map((m) => m.id).sort(),
    )
  })

  it('不修改输入数组与消息', () => {
    const input = [
      msg({ role: 'thought', text: '想' }),
      msg({ role: 'tool', toolTitle: 'A', toolStatus: 'completed' }),
    ]
    const frozen = JSON.parse(JSON.stringify(input))
    groupChatTimeline(input, { nowMs: 5000 })
    expect(input).toEqual(frozen)
  })

  it('空输入返回空时间线', () => {
    expect(groupChatTimeline([], { nowMs: 1 })).toEqual([])
  })
})
