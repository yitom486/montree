import { describe, expect, it } from 'vitest'
import {
  applyChatEvent,
  finalizeFeedMessages,
  type ChatFeedState,
} from './chat-feed'

function ctx() {
  let clock = 1000
  let seq = 0
  return {
    now: () => (clock += 10),
    createId: (role: string) => `${role}-n${(seq += 1)}`,
  }
}

function empty(): ChatFeedState {
  return { messages: [], turnSettled: false }
}

describe('chat-feed 文本分支', () => {
  it('尾部同 role 流式消息纯拼接，不新建', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'text-chunk', role: 'agent', text: '你' }, c)
    s = applyChatEvent(s, { type: 'text-chunk', role: 'agent', text: '好' }, c)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0]).toMatchObject({ id: 'agent-n1', text: '你好', streaming: true })
  })

  it('空 agent 占位被填充而非另起', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'begin-reply' }, c)
    s = applyChatEvent(s, { type: 'text-chunk', role: 'agent', text: 'hi' }, c)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0]).toMatchObject({ id: 'agent-n1', text: 'hi' })
  })

  it('thought 插到空占位之前', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'begin-reply' }, c)
    s = applyChatEvent(s, { type: 'text-chunk', role: 'thought', text: '想' }, c)
    expect(s.messages.map((m) => m.role)).toEqual(['thought', 'agent'])
  })

  it('冻结后迟到 chunk 另起 settled 气泡，不点亮', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'text-chunk', role: 'agent', text: 'a' }, c)
    s = applyChatEvent(s, { type: 'finish-turn' }, c)
    expect(s.turnSettled).toBe(true)
    s = applyChatEvent(s, { type: 'text-chunk', role: 'agent', text: 'b' }, c)
    // 对齐宿主 734-776：尾部非流式则 push 新 settled 消息（下次收尾 prune 再规整）
    expect(s.messages).toHaveLength(2)
    expect(s.messages.map((m) => [m.text, m.streaming])).toEqual([
      ['a', false],
      ['b', false],
    ])
  })

  it('begin-reply 复用尾部流式占位并清 turnSettled', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'finish-turn' }, c)
    s = applyChatEvent(s, { type: 'begin-reply' }, c)
    expect(s.turnSettled).toBe(false)
    expect(s.messages).toHaveLength(1)
    s = applyChatEvent(s, { type: 'begin-reply' }, c)
    expect(s.messages).toHaveLength(1)
  })

  it('user/system 追加直写', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'user-append', text: 'q' }, c)
    s = applyChatEvent(s, { type: 'system-append', text: 's' }, c)
    expect(s.messages.map((m) => [m.role, m.streaming ?? false])).toEqual([
      ['user', false],
      ['system', false],
    ])
  })
})

describe('chat-feed 工具分支', () => {
  it('同 toolCallId 原位 patch，保留 id/createdAt/提议字段', () => {
    const c = ctx()
    let s = applyChatEvent(
      empty(),
      { type: 'tool-call', call: { toolCallId: 't1', title: '搜', status: 'in_progress', contentText: 'a' } },
      c,
    )
    const first = s.messages[0]!
    s = applyChatEvent(
      s,
      { type: 'tool-call', call: { toolCallId: 't1', status: 'completed' } },
      c,
    )
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0]).toMatchObject({
      id: first.id,
      createdAt: first.createdAt,
      toolCallId: 't1',
      toolStatus: 'completed',
      toolTitle: '搜',
      toolContentText: 'a',
    })
  })

  it('无 toolCallId 直接 no-op', () => {
    const s = applyChatEvent(empty(), { type: 'tool-call', call: { toolCallId: '' } }, ctx())
    expect(s.messages).toHaveLength(0)
  })

  it('缺省 status 按 pending 点亮 streaming', () => {
    const s = applyChatEvent(
      empty(),
      { type: 'tool-call', call: { toolCallId: 't1' } },
      ctx(),
    )
    expect(s.messages[0]).toMatchObject({ toolStatus: 'pending', streaming: true })
  })

  it('tool-chunk 丢失 id/空文本丢弃；新建 in_progress；拼接不重亮 turnEnded', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'tool-chunk', toolCallId: '', text: 'x' }, c)
    s = applyChatEvent(s, { type: 'tool-chunk', toolCallId: 't1', text: '' }, c)
    expect(s.messages).toHaveLength(0)
    s = applyChatEvent(s, { type: 'tool-chunk', toolCallId: 't1', text: 'a' }, c)
    expect(s.messages[0]).toMatchObject({ toolStatus: 'in_progress', streaming: true })
    s = applyChatEvent(s, { type: 'finish-turn' }, c)
    s = applyChatEvent(s, { type: 'tool-chunk', toolCallId: 't1', text: 'b' }, c)
    expect(s.messages[0]).toMatchObject({
      toolContentText: 'ab',
      streaming: false,
      turnEnded: true,
    })
  })
})

describe('chat-feed 计划分支', () => {
  it('全线程单例复用 id，active 控制 streaming', () => {
    const c = ctx()
    const entries = [{ content: '做', status: 'in_progress' as const }]
    let s = applyChatEvent(empty(), { type: 'plan', entries, active: true }, c)
    const id = s.messages[0]!.id
    s = applyChatEvent(empty(), { type: 'plan', entries: [], active: false }, c)
    // 不同 state 各自单例；同 state 内复用
    let s2 = applyChatEvent(empty(), { type: 'plan', entries, active: true }, c)
    s2 = applyChatEvent(s2, { type: 'plan', entries: [], active: false }, c)
    expect(s2.messages).toHaveLength(1)
    expect(s2.messages[0]).toMatchObject({ id: s2.messages[0]!.id, streaming: false, text: '' })
    expect(id).toBeTruthy()
  })
})

describe('chat-feed 冻结与收尾', () => {
  it('finish-turn：pending→cancelled，in_progress 保留原值并打 turnEnded，其余仅落 streaming', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'text-chunk', role: 'agent', text: 'a' }, c)
    s = applyChatEvent(s, { type: 'tool-call', call: { toolCallId: 'p', status: 'pending' } }, c)
    s = applyChatEvent(s, { type: 'tool-call', call: { toolCallId: 'r', status: 'in_progress' } }, c)
    s = applyChatEvent(s, { type: 'finish-turn' }, c)
    const byId = Object.fromEntries(s.messages.map((m) => [m.toolCallId ?? m.role, m]))
    expect(byId['p']).toMatchObject({ streaming: false, toolStatus: 'cancelled', turnEnded: true })
    expect(byId['r']).toMatchObject({ streaming: false, toolStatus: 'in_progress', turnEnded: true })
    expect(byId['agent']).toMatchObject({ streaming: false })
    expect('turnEnded' in byId['agent']!).toBe(false)
    expect(s.turnSettled).toBe(true)
  })

  it('freeze-light：只收 streaming + 300 裁剪 + blob 脱钩，不打 turnEnded 不改 status', () => {
    const c = ctx()
    let s: ChatFeedState = { messages: [], turnSettled: false }
    for (let i = 0; i < 305; i += 1) {
      s = applyChatEvent(s, { type: 'user-append', text: `m${i}` }, c)
    }
    s = applyChatEvent(s, { type: 'tool-call', call: { toolCallId: 't', status: 'pending' } }, c)
    s = applyChatEvent(s, { type: 'freeze-light' }, c)
    expect(s.messages).toHaveLength(300)
    expect(s.messages.some((m) => m.streaming)).toBe(false)
    expect(s.messages.some((m) => m.turnEnded === true)).toBe(false)
  })

  it('cancel-tools：只改 active 工具 status 为 cancelled，不碰 streaming', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'tool-call', call: { toolCallId: 't', status: 'in_progress' } }, c)
    s = applyChatEvent(s, { type: 'cancel-tools' }, c)
    expect(s.messages[0]).toMatchObject({ toolStatus: 'cancelled', streaming: true })
  })

  it('finish-turn 提议 promote：工具提议挂到最后 agent 下', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'user-append', text: 'q' }, c)
    s = applyChatEvent(s, { type: 'text-chunk', role: 'agent', text: '答' }, c)
    s = applyChatEvent(
      s,
      {
        type: 'tool-call',
        call: { toolCallId: 't', status: 'completed', contentText: 'done', title: 'mark' },
      },
      c,
    )
    // 直接挂提议字段模拟 enrich 产出，再收尾 promote
    const withProposal = {
      ...s,
      messages: s.messages.map((m) =>
        m.toolCallId === 't'
          ? {
              ...m,
              markProposal: { id: 'p1', kind: 'highlight' as const, excerpt: 'e', note: '', source: 'agent' as const },
              markProposalStatus: 'pending' as const,
            }
          : m,
      ),
    }
    const done = applyChatEvent(withProposal, { type: 'finish-turn' }, c)
    const agent = done.messages.find((m) => m.role === 'agent')
    expect(agent?.markProposals?.map((r) => r.proposal.id)).toEqual(['p1'])
  })

  it('rollback-turn：只删本回合 agent/thought，工具/用户/旧 agent 保留', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'user-append', text: 'old q' }, c)
    s = applyChatEvent(s, { type: 'text-chunk', role: 'agent', text: 'old a' }, c)
    s = applyChatEvent(s, { type: 'finish-turn' }, c)
    // 回合开始时的已有 id 快照（即使同毫秒也精确区分）
    const keepIds = s.messages.map((m) => m.id)
    let t: typeof s = { messages: s.messages, turnSettled: false }
    t = applyChatEvent(t, { type: 'user-append', text: 'new q' }, c)
    t = applyChatEvent(t, { type: 'text-chunk', role: 'agent', text: 'Individual quota reached.' }, c)
    t = applyChatEvent(t, { type: 'tool-call', call: { toolCallId: 'tk', status: 'completed', contentText: 'ok' } }, c)
    t = applyChatEvent(t, { type: 'text-chunk', role: 'thought', text: 'hmm' }, c)
    expect(t.messages).toHaveLength(6)
    const rolled = applyChatEvent(t, { type: 'rollback-turn', keepIds }, c)
    expect(rolled.messages.map((m) => m.role)).toEqual(['user', 'agent', 'user', 'tool'])
    expect(rolled.messages.map((m) => m.text)).toEqual(['old q', 'old a', 'new q', 'ok'])
    expect(rolled.turnSettled).toBe(false)
  })

  it('finalizeFeedMessages 幂等：重复收尾不增字段不变形', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'text-chunk', role: 'agent', text: 'a' }, c)
    s = applyChatEvent(s, { type: 'finish-turn' }, c)
    const once = JSON.stringify(s.messages)
    const twice = applyChatEvent({ messages: s.messages, turnSettled: true }, { type: 'finish-turn' }, c)
    expect(JSON.stringify(twice.messages)).toBe(once)
  })

  it('finish-turn settle:false：定居收尾冻结残留但不碰 turnSettled', () => {
    const c = ctx()
    let s = applyChatEvent(empty(), { type: 'text-chunk', role: 'agent', text: 'a' }, c)
    expect(s.turnSettled).toBe(false)
    s = applyChatEvent(s, { type: 'finish-turn', settle: false }, c)
    expect(s.messages.every((m) => !m.streaming)).toBe(true)
    expect(s.turnSettled).toBe(false)
    // 缺省仍置 true（prompt 回合收尾语义不变）
    const s2 = applyChatEvent(s, { type: 'text-chunk', role: 'agent', text: 'b' }, c)
    const done = applyChatEvent(s2, { type: 'finish-turn' }, c)
    expect(done.turnSettled).toBe(true)
  })
})
