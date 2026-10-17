import { describe, expect, it } from 'vitest'
import { MONTREE_SETTLE_COMPLETE_KIND } from '@yitom/contracts'
import { STD_SESSION_UPDATE_KIND } from '@yitom/chat-session'
import { classifyAcpUpdate, normalizeUsageUpdate } from './acp-update-adapter'

/**
 * 适配层行为契约：一条 ACP session/update 只翻译成一个意图，
 * 字段归一化（工具双拼、计划、usage、文本角色）与旧宿主逐条等价。
 */
describe('classifyAcpUpdate 协议识别', () => {
  it('标准文本 chunk 按 kind 定角色', () => {
    expect(
      classifyAcpUpdate({
        sessionUpdate: STD_SESSION_UPDATE_KIND.agentMessage,
        content: { type: 'text', text: '正文' },
      }),
    ).toEqual({ type: 'text', role: 'agent', text: '正文' })

    expect(
      classifyAcpUpdate({
        sessionUpdate: STD_SESSION_UPDATE_KIND.agentThought,
        content: [{ type: 'text', text: '思考' }],
      }),
    ).toEqual({ type: 'text', role: 'thought', text: '思考' })

    expect(
      classifyAcpUpdate({
        sessionUpdate: STD_SESSION_UPDATE_KIND.userMessage,
        content: { type: 'text', text: '回放' },
      }),
    ).toEqual({ type: 'text', role: 'user', text: '回放' })
  })

  it('session_message 系列是 transcript 正文，转 agent 而非 thought', () => {
    expect(
      classifyAcpUpdate({
        sessionUpdate: STD_SESSION_UPDATE_KIND.sessionMessage,
        content: [{ type: 'text', text: '子会话说' }],
      }),
    ).toEqual({ type: 'text', role: 'agent', text: '子会话说' })
    expect(
      classifyAcpUpdate({
        sessionUpdate: STD_SESSION_UPDATE_KIND.sessionMessageChunk,
        content: { type: 'text', text: '续' },
      }),
    ).toEqual({ type: 'text', role: 'agent', text: '续' })
  })

  it('空文本不产意图（不建空泡）', () => {
    expect(
      classifyAcpUpdate({
        sessionUpdate: STD_SESSION_UPDATE_KIND.agentMessage,
        content: { type: 'text', text: '' },
      }),
    ).toEqual({ type: 'ignored', reason: 'no-feed-event' })
  })

  it('未知 kind 有文本走 agent 并带留痕字段；无文本只留痕', () => {
    expect(
      classifyAcpUpdate({ sessionUpdate: 'future_kind', content: { type: 'text', text: 'x' } }),
    ).toEqual({ type: 'text', role: 'agent', text: 'x', unknownKind: 'future_kind' })
    expect(classifyAcpUpdate({ sessionUpdate: 'future_kind' })).toEqual({
      type: 'ignored',
      reason: 'no-feed-event',
      unknownKind: 'future_kind',
    })
  })

  it('已知但无 feed 表达的成员明确丢弃', () => {
    for (const kind of [
      STD_SESSION_UPDATE_KIND.notice,
      STD_SESSION_UPDATE_KIND.compaction,
      STD_SESSION_UPDATE_KIND.compactionSummary,
      STD_SESSION_UPDATE_KIND.subagent,
      STD_SESSION_UPDATE_KIND.currentMode,
      STD_SESSION_UPDATE_KIND.sessionInfo,
      STD_SESSION_UPDATE_KIND.availableCommands,
    ]) {
      expect(
        classifyAcpUpdate({ sessionUpdate: kind, content: { type: 'text', text: '不该进历史' } }),
      ).toEqual({ type: 'ignored', reason: 'no-feed-event' })
    }
  })

  it('模型配置两种写法都不进 feed', () => {
    expect(classifyAcpUpdate({ sessionUpdate: 'config_option_update' })).toEqual({
      type: 'ignored',
      reason: 'config',
    })
    expect(classifyAcpUpdate({ sessionUpdate: 'config_options_update' })).toEqual({
      type: 'ignored',
      reason: 'config',
    })
  })

  it('定居标记与畸形载荷', () => {
    expect(classifyAcpUpdate({ sessionUpdate: MONTREE_SETTLE_COMPLETE_KIND })).toEqual({
      type: 'settle-complete',
    })
    expect(classifyAcpUpdate(null)).toEqual({ type: 'ignored', reason: 'malformed' })
    expect(classifyAcpUpdate([{ sessionUpdate: 'plan' }])).toEqual({
      type: 'ignored',
      reason: 'malformed',
    })
  })

  it('同一事件只产出一个意图（不重复应用）', () => {
    const intent = classifyAcpUpdate({
      sessionUpdate: STD_SESSION_UPDATE_KIND.agentMessage,
      content: { type: 'text', text: '唯一' },
    })
    expect(intent).not.toBeInstanceOf(Array)
    expect(intent).toEqual({ type: 'text', role: 'agent', text: '唯一' })
  })
})

describe('classifyAcpUpdate 工具归一化', () => {
  it('空 camelCase id 不回退 snake_case，保留宿主无 id 快照旁路语义', () => {
    for (const sessionUpdate of ['tool_call', 'tool_call_update']) {
      expect(classifyAcpUpdate({ sessionUpdate, toolCallId: '', tool_call_id: 'other-tool', status: 'completed' }))
        .toEqual({ type: 'tool-call' })
    }
    expect(classifyAcpUpdate({ sessionUpdate: 'tool_call', toolCallId: 'primary', tool_call_id: 'other-tool' }))
      .toMatchObject({ type: 'tool-call', toolCallId: 'primary' })
  })
  it('camelCase 与 snake_case 双拼都归一成同一个 toolCallId', () => {
    const camel = classifyAcpUpdate({
      sessionUpdate: STD_SESSION_UPDATE_KIND.toolCall,
      toolCallId: 'call-1',
      title: '读文件',
      kind: 'read',
      status: 'in_progress',
    })
    const snake = classifyAcpUpdate({
      sessionUpdate: STD_SESSION_UPDATE_KIND.toolCall,
      tool_call_id: 'call-1',
      title: '读文件',
      kind: 'read',
      status: 'in_progress',
    })
    expect(camel).toEqual(snake)
    expect(camel).toMatchObject({
      type: 'tool-call',
      toolCallId: 'call-1',
      call: { toolCallId: 'call-1', title: '读文件', kind: 'read', status: 'in_progress' },
    })
  })

  it('tool_call_update 携带内容/差异/定位时一并归一', () => {
    const intent = classifyAcpUpdate({
      sessionUpdate: STD_SESSION_UPDATE_KIND.toolCallUpdate,
      toolCallId: 'call-2',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '输出正文' } }],
      locations: [{ path: '/a.md', line: 3 }],
    })
    expect(intent.type).toBe('tool-call')
    if (intent.type !== 'tool-call') throw new Error('unreachable')
    expect(intent.call?.contentText).toContain('输出正文')
    expect(intent.call?.locations).toEqual([{ path: '/a.md', line: 3 }])
    expect(intent.call?.status).toBe('completed')
  })

  it('无 id 仍产出意图（宿主需消费快照旁路），但不带 call', () => {
    const intent = classifyAcpUpdate({
      sessionUpdate: STD_SESSION_UPDATE_KIND.toolCall,
      title: '无 id',
    })
    expect(intent).toEqual({ type: 'tool-call' })
    expect(intent.type === 'tool-call' && intent.call).toBeUndefined()
  })

  it('厂商 tool 内容分块只认 camelCase id，保持宿主既有语义', () => {
    expect(
      classifyAcpUpdate({
        sessionUpdate: 'tool_call_content_chunk',
        toolCallId: 'chunk-1',
        content: { type: 'text', text: '增量' },
      }),
    ).toEqual({ type: 'tool-content-chunk', toolCallId: 'chunk-1', text: '增量' })

    // 包 mapper 额外容忍 snake_case；宿主这里维持 camelCase-only（行为不变）
    expect(
      classifyAcpUpdate({
        sessionUpdate: 'tool_call_content_chunk',
        tool_call_id: 'chunk-2',
        content: { type: 'text', text: '增量' },
      }),
    ).toEqual({ type: 'ignored', reason: 'vendor-tool-chunk-no-id' })

    expect(
      classifyAcpUpdate({ sessionUpdate: 'tool_call_content_chunk', toolCallId: 'chunk-3' }),
    ).toEqual({ type: 'ignored', reason: 'vendor-tool-chunk-empty' })
  })
})

describe('classifyAcpUpdate 计划与用量', () => {
  it('plan / plan_update 都产出计划意图，plan_removed 删卡', () => {
    const entries = [
      { content: '写代码', status: 'in_progress' },
      { content: '跑测试', status: 'pending' },
    ]
    expect(
      classifyAcpUpdate({ sessionUpdate: STD_SESSION_UPDATE_KIND.plan, entries }),
    ).toEqual({
      type: 'plan',
      entries: [
        { content: '写代码', status: 'in_progress', priority: undefined },
        { content: '跑测试', status: 'pending', priority: undefined },
      ],
      active: true,
    })
    // 空 entries 视为清空该计划卡片（仍产出 plan 意图，由归约器替换）
    expect(
      classifyAcpUpdate({ sessionUpdate: STD_SESSION_UPDATE_KIND.planUpdate, entries: [] }),
    ).toEqual({ type: 'plan', entries: [], active: false })
    expect(
      classifyAcpUpdate({ sessionUpdate: STD_SESSION_UPDATE_KIND.planRemoved }),
    ).toEqual({ type: 'plan-remove' })
  })

  it('usage_update 归一化 used/size/cost/thinkingTokens', () => {
    expect(
      classifyAcpUpdate({
        sessionUpdate: STD_SESSION_UPDATE_KIND.usage,
        used: 8281,
        size: 262144,
        cost: { amount: 0, currency: 'USD' },
        _meta: { thinkingTokens: 20 },
      }),
    ).toEqual({
      type: 'usage',
      usage: {
        used: 8281,
        size: 262144,
        cost: { amount: 0, currency: 'USD' },
        thinkingTokens: 20,
      },
    })
    // 缺 _meta：不写 thinkingTokens 键
    expect(
      classifyAcpUpdate({ sessionUpdate: STD_SESSION_UPDATE_KIND.usage, used: 1, size: 2 }),
    ).toEqual({ type: 'usage', usage: { used: 1, size: 2 } })
  })

  it('usage 缺 used/size 整条丢弃；非法 cost 不落键', () => {
    expect(
      classifyAcpUpdate({ sessionUpdate: STD_SESSION_UPDATE_KIND.usage, used: 1 }),
    ).toEqual({ type: 'ignored', reason: 'usage-incomplete' })
    expect(
      classifyAcpUpdate({
        sessionUpdate: STD_SESSION_UPDATE_KIND.usage,
        used: Number.NaN,
        size: 10,
      }),
    ).toEqual({ type: 'ignored', reason: 'usage-incomplete' })

    expect(
      normalizeUsageUpdate({ used: 5, size: 10, cost: { amount: 'x', currency: 'USD' } }),
    ).toEqual({ used: 5, size: 10 })
    expect(normalizeUsageUpdate({ used: 5, size: 10, cost: [{ amount: 1 }] })).toEqual({
      used: 5,
      size: 10,
    })
  })
})
