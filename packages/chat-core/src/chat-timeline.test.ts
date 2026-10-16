import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './chat-message'
import { groupChatTimeline, isRichToolMessage } from './chat-timeline'

let seq = 0
function msg(overrides: Partial<ChatMessage>): ChatMessage {
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

describe('groupChatTimeline 回合归属（U1）', () => {
  function tool(id: string, title: string, status: 'completed' = 'completed') {
    return msg({ id, role: 'tool', toolTitle: title, toolStatus: status, toolCallId: id })
  }

  it('穿插多条 assistant 文本仍汇总为一条工作记录，文本顺序保留', () => {
    const user = msg({ id: 'u1', role: 'user', text: '查' })
    const t1 = tool('t1', 'read_text_file')
    const mid = msg({ id: 'a1', role: 'agent', text: '先读了正文' })
    const t2 = tool('t2', 'search')
    const fin = msg({ id: 'a2', role: 'agent', text: '结论' })
    const timeline = groupChatTimeline([user, t1, mid, t2, fin], { nowMs: 9000 })
    expect(timeline.map((i) => i.kind)).toEqual(['message', 'work-log', 'message', 'message'])
    const group = timeline[1]!
    expect(group.kind).toBe('work-log')
    if (group.kind === 'work-log') {
      expect(group.toolCallCount).toBe(2)
      expect(group.messages.map((m) => m.id)).toEqual(['t1', 't2'])
    }
    // 文本不丢失不拼接
    expect((timeline[2] as { message: ChatMessage }).message.text).toBe('先读了正文')
    expect((timeline[3] as { message: ChatMessage }).message.text).toBe('结论')
  })

  it('两个用户回合各一条工作记录，不跨边界合并', () => {
    const timeline = groupChatTimeline(
      [
        msg({ id: 'u1', role: 'user', text: '一' }),
        tool('t1', 'read_text_file'),
        msg({ id: 'u2', role: 'user', text: '二' }),
        tool('t2', 'search'),
      ],
      { nowMs: 9000 },
    )
    expect(timeline.map((i) => i.kind)).toEqual(['message', 'work-log', 'message', 'work-log'])
    expect(timeline[1]?.key).not.toBe(timeline[3]?.key)
  })

  it('无 user 历史前缀自成独立片段', () => {
    const timeline = groupChatTimeline([tool('t1', 'read_text_file')], { nowMs: 9000 })
    expect(timeline.map((i) => i.kind)).toEqual(['work-log'])
    expect(timeline[0]?.key).toBe('work-log:prefix:default')
  })

  it('切线程不串 key（scopeKey 隔离）', () => {
    const msgs = [msg({ id: 'u1', role: 'user', text: 'x' }), tool('t1', 'read_text_file')]
    const a = groupChatTimeline(msgs, { scopeKey: 'thread-a', nowMs: 1 })
    const b = groupChatTimeline(msgs, { scopeKey: 'thread-b', nowMs: 1 })
    expect(a[1]?.key).not.toBe(b[1]?.key)
  })

  it('迟到结果不重复、位置跟随消息', () => {
    const user = msg({ id: 'u1', role: 'user', text: '查' })
    const t1 = tool('t1', 'read_text_file')
    const first = groupChatTimeline([user, t1], { nowMs: 9000 })
    // 迟到富结果追加到末尾：只出现一次，位置在末尾
    const late = msg({
      id: 'late-1',
      role: 'tool',
      toolTitle: 'montree_generate_diagram',
      toolStatus: 'completed',
      toolCallId: 'late-1',
      toolContentText: JSON.stringify({ diagramId: 'd', mermaidCode: 'graph TD; A-->B' }),
    })
    const second = groupChatTimeline([user, t1, late], { nowMs: 9000 })
    expect(first[1]?.key).toBe(second[1]?.key)
    const ids = second.flatMap((i) => (i.kind === 'work-log' ? i.messages : [i.message])).map((m) => m.id)
    expect(ids.filter((id) => id === 'late-1')).toHaveLength(1)
    expect(second.at(-1)).toMatchObject({ kind: 'message' })
  })

  it('同 result.id 不同调用各渲染一条（U1 结果身份）', () => {
    const same = JSON.stringify({ diagramId: 'same', mermaidCode: 'graph TD; A-->B' })
    const timeline = groupChatTimeline(
      [
        msg({ id: 'u1', role: 'user', text: '查' }),
        msg({ id: 'r1', role: 'tool', toolTitle: 'montree_generate_diagram', toolStatus: 'completed', toolCallId: 'r1', toolContentText: same }),
        msg({ id: 'r2', role: 'tool', toolTitle: 'montree_generate_diagram', toolStatus: 'completed', toolCallId: 'r2', toolContentText: same }),
      ],
      { nowMs: 9000 },
    )
    expect(timeline.map((i) => i.kind)).toEqual(['message', 'message', 'message'])
    expect(timeline[1]?.key).toBe('msg:r1')
    expect(timeline[2]?.key).toBe('msg:r2')
  })

  it('窗口裁剪：计数用完整派生并注明未加载，可见只放窗口内', () => {
    const user = msg({ id: 'u1', role: 'user', text: '查' })
    const t1 = tool('t1', 'read_text_file')
    const t2 = tool('t2', 'search')
    const t3 = tool('t3', 'read_text_file')
    const all = [user, t1, t2, t3]
    const timeline = groupChatTimeline(all, {
      nowMs: 9000,
      visibleIds: new Set(['u1', 't3']),
    })
    expect(timeline.map((i) => i.kind)).toEqual(['message', 'work-log'])
    const group = timeline[1]!
    if (group.kind !== 'work-log') expect.unreachable('应为工作记录组')
    // 跨窗口调用不算成可见调用：详情只有 t3，但计数是整回合 3 并注明
    expect(group.messages.map((m) => m.id)).toEqual(['t3'])
    expect(group.toolCallCount).toBe(3)
    expect(group.hiddenToolCallCount).toBe(2)
  })

  it('前补不改变既有回合 key（U1 稳定）', () => {
    const user = msg({ id: 'u1', role: 'user', text: '查' })
    const t1 = tool('t1', 'read_text_file')
    const before = groupChatTimeline([user, t1], { nowMs: 1 })
    const older = msg({ id: 'u0', role: 'user', text: '旧' })
    const after = groupChatTimeline([older, user, t1], { nowMs: 1 })
    const keysBefore = before.map((i) => i.key)
    const keysAfter = after.map((i) => i.key)
    for (const key of keysBefore) {
      expect(keysAfter).toContain(key)
    }
  })

  it('取消/未知计入状态计数，不判成功', () => {
    const timeline = groupChatTimeline(
      [
        msg({ id: 'u1', role: 'user', text: '查' }),
        tool('ok', 'read_text_file', 'completed'),
        msg({ id: 'c1', role: 'tool', toolTitle: 'edit', toolStatus: 'cancelled', toolCallId: 'c1' }),
        msg({ id: 'x1', role: 'tool', toolTitle: 'mystery', toolCallId: 'x1' }),
      ],
      { nowMs: 9000 },
    )
    const group = timeline.find((i) => i.kind === 'work-log')
    expect(group?.kind).toBe('work-log')
    if (group?.kind === 'work-log') {
      expect(group.toolCallCount).toBe(3)
      expect(group.cancelledCount).toBe(1)
      expect(group.unknownCount).toBe(1)
      expect(group.hasFailure).toBe(false)
    }
  })

  it('无可信时间省略历时', () => {
    const t = msg({ role: 'tool', toolTitle: 'A', toolStatus: 'completed' })
    // createdAt 缺失（msg() 默认有，用 delete 去掉）
    delete (t as { createdAt?: number }).createdAt
    const timeline = groupChatTimeline([t], { nowMs: 9000 })
    const group = timeline[0]!
    if (group.kind !== 'work-log') expect.unreachable('应为工作记录组')
    expect(group.hasTrustedTime).toBe(false)
    expect(group.durationLabel).toBe('')
  })

  it('运行进度与最近事件只报真实终态（U6 平滑/反馈）', () => {
    const running = msg({
      id: 'r1', role: 'tool', toolCallId: 'r1', toolTitle: 'read_text_file',
      toolStatus: 'in_progress', streaming: true, createdAt: 1000,
    })
    const done = msg({
      id: 'd1', role: 'tool', toolCallId: 'd1', toolTitle: 'search',
      toolStatus: 'completed', streaming: false, createdAt: 1100, updatedAt: 1500,
    })
    const failedLate = msg({
      id: 'f1', role: 'tool', toolCallId: 'f1', toolTitle: 'edit',
      toolStatus: 'failed', streaming: false, createdAt: 1200, updatedAt: 1600,
    })
    const timeline = groupChatTimeline(
      [msg({ id: 'u1', role: 'user', text: '查' }), running, done],
      { nowMs: 9000 },
    )
    const group = timeline.find((i) => i.kind === 'work-log')
    if (group?.kind !== 'work-log') expect.unreachable('应为工作记录组')
    // 运行中不计入 done；最近事件是最后落定的 done（失败单条不进组但计数）
    expect(group.toolCallCount).toBe(2)
    expect(group.completedCount).toBe(1)
    expect(group.lastEvent).toEqual({ title: '搜索文档', ok: true })
    // 失败工具提升为单条，不进组 details，但失败计数保留
    const withFailed = groupChatTimeline(
      [msg({ id: 'u2', role: 'user', text: '查' }), running, done, failedLate],
      { nowMs: 9000 },
    )
    const group2 = withFailed.find((i) => i.kind === 'work-log')
    if (group2?.kind !== 'work-log') expect.unreachable('应为工作记录组')
    expect(group2.failedCount).toBe(1)
    expect(group2.lastEvent).toEqual({ title: '搜索文档', ok: true })
    expect(group2.messages.map((m) => m.id)).not.toContain('f1')
  })
})
