import { describe, expect, it } from 'vitest'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@montree/contracts'
import { mapConnectionStatus, mapPermissionRequest, mapSessionUpdate } from './acp-events'

describe('mapSessionUpdate 文本三 chunk', () => {
  it('agent_message_chunk → agent text-chunk', () => {
    expect(
      mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: 'hi' }] }),
    ).toEqual([{ type: 'text-chunk', role: 'agent', text: 'hi' }])
  })
  it('agent_thought_chunk → thought', () => {
    expect(
      mapSessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: '想' }),
    ).toEqual([{ type: 'text-chunk', role: 'thought', text: '想' }])
  })
  it('user_message_chunk → user', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'user_message_chunk', content: 'u' })).toEqual([
      { type: 'text-chunk', role: 'user', text: 'u' },
    ])
  })
  it('空文本 → []', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: [] })).toEqual([])
    expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk' })).toEqual([])
  })
})

describe('mapSessionUpdate 工具双拼', () => {
  it('tool_call（蛇形 id）→ tool-call', () => {
    expect(
      mapSessionUpdate({
        sessionUpdate: 'tool_call',
        tool_call_id: 't1',
        title: '读',
        kind: 'read',
        status: 'in_progress',
      }),
    ).toEqual([
      {
        type: 'tool-call',
        call: { toolCallId: 't1', title: '读', kind: 'read', status: 'in_progress' },
      },
    ])
  })
  it('tool_call_update：diff + locations 走 core 解析', () => {
    const [event] = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't2',
      status: 'completed',
      content: [{ type: 'diff', path: 'a.ts', oldText: 'x', newText: 'y' }],
      locations: [{ path: 'a.ts', line: 3 }],
    })
    expect(event?.type).toBe('tool-call')
    if (event?.type !== 'tool-call') return
    expect(event.call.toolCallId).toBe('t2')
    expect(event.call.diffs).toEqual([{ path: 'a.ts', oldText: 'x', newText: 'y' }])
    expect(event.call.locations).toEqual([{ path: 'a.ts', line: 3 }])
  })
  it('无 id → []', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'tool_call', title: 'x' })).toEqual([])
  })
  it('tool_call_content_chunk → tool-chunk（host 同款 [content] 包裹压平）', () => {
    expect(
      mapSessionUpdate({
        sessionUpdate: 'tool_call_content_chunk',
        toolCallId: 't3',
        content: { type: 'text', text: 'out' },
      }),
    ).toEqual([{ type: 'tool-chunk', toolCallId: 't3', text: 'out' }])
    expect(
      mapSessionUpdate({ sessionUpdate: 'tool_call_content_chunk', toolCallId: 't3' }),
    ).toEqual([])
    expect(mapSessionUpdate({ sessionUpdate: 'tool_call_content_chunk', content: 'x' })).toEqual(
      [],
    )
  })
})

describe('mapSessionUpdate 计划/配置/收尾', () => {
  it('plan → plan 事件（entries + active）', () => {
    const [event] = mapSessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
      ],
    })
    expect(event?.type).toBe('plan')
    if (event?.type !== 'plan') return
    expect(event.entries).toHaveLength(2)
    expect(event.active).toBe(true)
  })
  it('plan_update 空 entries 仍产出清空事件', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'plan_update', entries: [] })).toEqual([
      { type: 'plan', entries: [], active: false },
    ])
  })
  it('config_option_update → []（模型配置走专有事件）', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'config_option_update' })).toEqual([])
    expect(mapSessionUpdate({ sessionUpdate: 'config_options_update' })).toEqual([])
  })
  it('montree_settle_complete → finish-turn', () => {
    expect(MONTREE_SETTLE_COMPLETE_KIND).toBe('montree_settle_complete')
    expect(mapSessionUpdate({ sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND })).toEqual([
      { type: 'finish-turn' },
    ])
  })
})

describe('mapSessionUpdate 未知/空 noop', () => {
  it('未知种类无文本 → []；有文本按宿主默认走 agent', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'available_commands_update' })).toEqual([])
    expect(mapSessionUpdate({ sessionUpdate: 'plan_removed' })).toEqual([])
    expect(mapSessionUpdate({ sessionUpdate: 'whatever_new', content: 't' })).toEqual([
      { type: 'text-chunk', role: 'agent', text: 't' },
    ])
  })
  it('非 record → []', () => {
    expect(mapSessionUpdate(null)).toEqual([])
    expect(mapSessionUpdate('x')).toEqual([])
    expect(mapSessionUpdate(42)).toEqual([])
  })
})

describe('mapPermissionRequest 三兼容', () => {
  it('tool_call_id + title/kind/status + optionId/name 全量形状', () => {
    const { permission, toolCall } = mapPermissionRequest({
      requestId: 9,
      sessionId: 's1',
      summary: '删文件？',
      toolCall: { tool_call_id: 't1', title: 'rm', kind: 'delete', status: 'pending' },
      options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }],
    })
    expect(permission).toEqual({
      requestId: 9,
      sessionId: 's1',
      toolCallId: 't1',
      summary: '删文件？',
      options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }],
      toolCall: { tool_call_id: 't1', title: 'rm', kind: 'delete', status: 'pending' },
    })
    expect(toolCall.toolCallId).toBe('t1')
    expect(toolCall.title).toBe('rm')
  })
  it('id/title 双兼容：toolCall.id + 选项 id/title', () => {
    const { permission, toolCall } = mapPermissionRequest({
      requestId: 10,
      toolCall: { id: 't2' },
      options: [{ id: 'deny', title: '拒绝', kind: 'reject_once' }],
    })
    expect(permission.toolCallId).toBe('t2')
    expect(permission.options).toEqual([{ optionId: 'deny', name: '拒绝', kind: 'reject_once' }])
    expect(permission.summary).toBe('Agent 请求执行工具')
    expect(toolCall.status).toBe('pending')
    expect(toolCall.kind).toBe('other')
  })
  it('summary 回退 toolCall.title；顶层 toolCallId 优先', () => {
    const { permission } = mapPermissionRequest({
      requestId: 11,
      toolCallId: 'top',
      toolCall: { toolCallId: 'inner', name: 'exec' },
      options: [],
    })
    expect(permission.toolCallId).toBe('top')
    expect(permission.summary).toBe('exec')
  })
})

describe('mapConnectionStatus', () => {
  it('五值透传，未知回 disconnected', () => {
    for (const s of ['connected', 'connecting', 'awaiting_auth', 'disconnected', 'error'] as const) {
      expect(mapConnectionStatus(s)).toBe(s)
    }
    expect(mapConnectionStatus('bogus')).toBe('disconnected')
    expect(mapConnectionStatus(undefined)).toBe('disconnected')
  })
})
