import { describe, expect, it } from 'vitest'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@montree/contracts'
import { mapConnectionStatus, mapPermissionRequest, mapSessionUpdate } from './acp-events'
import { applyChatEvent, toToolDisplayModel, type ChatFeedState } from '@montree/chat-core'

describe('agy 思考与工具协议集成', () => {
  it('思考→绘图→完成稀疏更新→再次思考→正文，保留摘要并收起上一阶段', () => {
    let feed: ChatFeedState = { messages: [], turnSettled: false }
    const ingest = (update: unknown) => {
      for (const event of mapSessionUpdate(update)) feed = applyChatEvent(feed, event)
    }
    ingest({ sessionUpdate: 'agent_thought_chunk', messageId: 'msg_thought_agy_1', content: { type: 'text', text: '先梳理登录过程。' } })
    expect(feed.messages[0]).toMatchObject({ role: 'thought', streaming: true, text: '先梳理登录过程。' })
    ingest({ sessionUpdate: 'tool_call', toolCallId: 'agy-t1-s2', title: 'Call Mcp Tool', name: 'call_mcp_tool', status: 'in_progress',
      rawInput: { tool_name: 'montree_present', arguments: { kind: 'preset', preset: 'diagram', diagramType: 'sequence', title: '登录过程', source: 'do not store' } },
    })
    expect(feed.messages[0]?.streaming).toBe(false)
    expect(toToolDisplayModel(feed.messages[1]!)).toMatchObject({ title: '绘制时序图', activityLabel: '正在绘制时序图：登录过程', state: 'in-progress' })
    ingest({ sessionUpdate: 'tool_call_update', toolCallId: 'agy-t1-s2', name: 'call_mcp_tool', title: 'Call Mcp Tool', status: 'completed' })
    expect(toToolDisplayModel(feed.messages[1]!)).toMatchObject({ title: '绘制时序图', targetSummary: '登录过程', state: 'completed' })
    expect(JSON.stringify(feed)).not.toContain('do not store')
    ingest({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '核对图形结果。' } })
    expect(feed.messages.at(-1)).toMatchObject({ role: 'thought', streaming: true })
    ingest({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '图已绘制。' } })
    expect(feed.messages.filter(m => m.role === 'thought').every(m => !m.streaming)).toBe(true)
    expect(feed.messages.at(-1)).toMatchObject({ role: 'agent', text: '图已绘制。' })
  })

  it('只有 thinkingTokens 的 usage_update 不伪造思考正文', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'usage_update', used: 100, size: 1000, _meta: { thinkingTokens: 20 } })).toEqual([])
  })

  it('未知 kind 经 onUnknownKind 上报但行为不变', () => {
    const seen: string[] = []
    expect(mapSessionUpdate({ sessionUpdate: 'usage_update', used: 1 }, (k) => { seen.push(k) })).toEqual([])
    expect(seen).toEqual(['usage_update'])
    // 已知 kind 不上报
    mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: 'hi' }, (k) => { seen.push(k) })
    expect(seen).toEqual(['usage_update'])
    // 缺省回调时静默（旧行为）
    expect(mapSessionUpdate({ sessionUpdate: 'usage_update', used: 1 })).toEqual([])
  })

  it('迟到的工具完成事件不会结束下一阶段新到的思考', () => {
    let feed: ChatFeedState = { messages: [], turnSettled: false }
    for (const update of [
      { sessionUpdate: 'tool_call', toolCallId: 't1', status: 'in_progress' },
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '下一步分析。' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' },
    ]) {
      for (const event of mapSessionUpdate(update)) feed = applyChatEvent(feed, event)
    }
    expect(feed.messages.at(-1)).toMatchObject({ role: 'thought', streaming: true })
  })
})

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
