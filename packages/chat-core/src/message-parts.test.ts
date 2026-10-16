import { describe, expect, it } from 'vitest'
import type { MontreePresentResult } from '@montree/contracts'
import type { ChapterMarkPlanEntry, ProposedMark } from '@montree/annotations'
import type { ChatMessage } from './chat-message'
import type { AcpPlanEntry } from './plan'
import { splitMessage } from './message-parts'

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

function proposal(id: string): ProposedMark {
  return { id, kind: 'note', excerpt: `摘录${id}`, note: `注${id}`, source: 'agent' }
}

function chapterEntry(id: string, flatIndex: number): ChapterMarkPlanEntry {
  return { id, flatIndex, title: `章${id}`, reason: `理由${id}`, status: 'pending' }
}

const PRESENT: MontreePresentResult = {
  schemaVersion: 1,
  kind: 'chapter-comparison',
  id: 'present-chapter-comparison-abcdef12',
  title: '比较',
  documentFingerprint: '/books/a.epub',
  chapters: [
    { key: 'c1', label: '第一章', flatIndex: 0 },
    { key: 'c2', label: '第二章', flatIndex: 1 },
  ],
  items: [],
}

const PLAN_ENTRIES: AcpPlanEntry[] = [
  { content: '读第一章', status: 'completed' },
  { content: '读第二章', status: 'pending' },
]

describe('splitMessage 主块', () => {
  it('user 正文产 text part', () => {
    const parts = splitMessage(msg({ role: 'user', text: '你好' }))
    expect(parts).toEqual([{ kind: 'text', text: '你好' }])
  })

  it('agent 正文产 text part', () => {
    const parts = splitMessage(msg({ role: 'agent', text: '结论' }))
    expect(parts).toEqual([{ kind: 'text', text: '结论' }])
  })

  it('thought 产 thought part 并透传 streaming', () => {
    expect(splitMessage(msg({ role: 'thought', text: '想', streaming: true }))).toEqual([
      { kind: 'thought', text: '想', streaming: true },
    ])
    expect(splitMessage(msg({ role: 'thought', text: '想定', streaming: false }))).toEqual([
      { kind: 'thought', text: '想定', streaming: false },
    ])
  })

  it('空流式 thought 仍产 thought part（无文本门限）', () => {
    expect(splitMessage(msg({ role: 'thought', text: '', streaming: true }))).toEqual([
      { kind: 'thought', text: '', streaming: true },
    ])
  })

  it('空白正文不产 text part', () => {
    expect(splitMessage(msg({ role: 'agent', text: '   ' }))).toEqual([])
  })

  it('tool 产 tool part（整体透传）', () => {
    const m = msg({ role: 'tool', toolCallId: 'tc-1', toolTitle: 'read_text_file', toolStatus: 'completed' })
    const parts = splitMessage(m)
    expect(parts).toEqual([{ kind: 'tool', message: m }])
  })

  it('tool 正文不单独产 text part', () => {
    const parts = splitMessage(
      msg({ role: 'tool', toolCallId: 'tc-1', toolTitle: 'read', text: 'raw detail' }),
    )
    expect(parts.map((p) => p.kind)).toEqual(['tool'])
  })

  it('plan role 只产 plan part，不渲染正文', () => {
    const parts = splitMessage(
      msg({ role: 'plan', text: '忽略的正文', planEntries: PLAN_ENTRIES }),
    )
    expect(parts).toEqual([{ kind: 'plan', entries: PLAN_ENTRIES }])
  })

  it('plan role 空 planEntries 不产 part', () => {
    expect(splitMessage(msg({ role: 'plan', text: '', planEntries: [] }))).toEqual([])
  })
})

describe('splitMessage 审批', () => {
  it('needsApproval 为 true 时前置 approval part', () => {
    const parts = splitMessage(
      msg({ role: 'tool', toolCallId: 'tc-del', toolTitle: 'Delete', toolStatus: 'pending' }),
      { needsApproval: true },
    )
    expect(parts.map((p) => p.kind)).toEqual(['approval', 'tool'])
    expect(parts[0]).toEqual({ kind: 'approval', toolCallId: 'tc-del' })
  })

  it('toolCallId 缺失不产 approval part', () => {
    const parts = splitMessage(
      msg({ role: 'tool', toolTitle: 'Delete', toolStatus: 'pending' }),
      { needsApproval: true },
    )
    expect(parts.map((p) => p.kind)).toEqual(['tool'])
  })

  it('非 tool role 即使 needsApproval 也不产 approval', () => {
    const parts = splitMessage(msg({ role: 'agent', text: 'x' }), { needsApproval: true })
    expect(parts.map((p) => p.kind)).toEqual(['text'])
  })

  it('缺省不产 approval', () => {
    const parts = splitMessage(
      msg({ role: 'tool', toolCallId: 'tc-del', toolTitle: 'Delete' }),
    )
    expect(parts.map((p) => p.kind)).toEqual(['tool'])
  })
})

describe('splitMessage 业务 parts', () => {
  it('presentResult 产 present part', () => {
    const parts = splitMessage(msg({ role: 'agent', text: '看', presentResult: PRESENT }))
    expect(parts.map((p) => p.kind)).toEqual(['text', 'present'])
    expect(parts[1]).toEqual({ kind: 'present', result: PRESENT })
  })

  it('单条 markProposal 产 proposal part（缺省 pending，归属消息 toolCallId）', () => {
    const parts = splitMessage(
      msg({
        role: 'tool',
        toolCallId: 'tc-p1',
        toolTitle: 'montree_propose_mark',
        markProposal: proposal('p1'),
      }),
    )
    expect(parts.map((p) => p.kind)).toEqual(['tool', 'proposal'])
    expect(parts[1]).toEqual({
      kind: 'proposal',
      items: [{ proposal: proposal('p1'), status: 'pending', toolCallId: 'tc-p1' }],
    })
  })

  it('dismissed 单条不产 proposal part', () => {
    const parts = splitMessage(
      msg({ role: 'tool', markProposal: proposal('p1'), markProposalStatus: 'dismissed' }),
    )
    expect(parts.map((p) => p.kind)).toEqual(['tool'])
  })

  it('markProposals 数组逐项保留 status/toolCallId', () => {
    const parts = splitMessage(
      msg({
        role: 'agent',
        text: '提议如下',
        markProposals: [
          { proposal: proposal('p1'), status: 'adopted', toolCallId: 'tc-a' },
          { proposal: proposal('p2'), status: 'pending' },
        ],
      }),
    )
    expect(parts.map((p) => p.kind)).toEqual(['text', 'proposal'])
    expect(parts[1]).toEqual({
      kind: 'proposal',
      items: [
        { proposal: proposal('p1'), status: 'adopted', toolCallId: 'tc-a' },
        { proposal: proposal('p2'), status: 'pending' },
      ],
    })
  })

  it('单条与数组合并为一个 proposal part，单条在前', () => {
    const parts = splitMessage(
      msg({
        role: 'agent',
        markProposal: proposal('single'),
        markProposalStatus: 'adopted',
        markProposals: [{ proposal: proposal('plural'), status: 'pending' }],
      }),
    )
    const proposalPart = parts.find((p) => p.kind === 'proposal')
    expect(proposalPart).toBeDefined()
    if (proposalPart?.kind === 'proposal') {
      expect(proposalPart.items.map((i) => i.proposal.id)).toEqual(['single', 'plural'])
    }
  })

  it('chapterMarkPlan 产 chapter-plan part', () => {
    const entries = [chapterEntry('ch1', 0), chapterEntry('ch2', 3)]
    const parts = splitMessage(msg({ role: 'agent', text: '建议', chapterMarkPlan: entries }))
    expect(parts.map((p) => p.kind)).toEqual(['text', 'chapter-plan'])
    expect(parts[1]).toEqual({ kind: 'chapter-plan', entries })
  })

  it('planEntries（非 plan role）产 plan part', () => {
    const parts = splitMessage(msg({ role: 'agent', text: '计划', planEntries: PLAN_ENTRIES }))
    expect(parts.map((p) => p.kind)).toEqual(['text', 'plan'])
    expect(parts[1]).toEqual({ kind: 'plan', entries: PLAN_ENTRIES })
  })

  it('steps 独立产 steps part（不并入 plan）', () => {
    const steps = [{ num: 1, title: '读', desc: '读正文', anchorId: 'a1' }]
    const parts = splitMessage(msg({ role: 'agent', text: '流转', steps }))
    expect(parts.map((p) => p.kind)).toEqual(['text', 'steps'])
    expect(parts[1]).toEqual({ kind: 'steps', steps })
  })

  it('空数组不产 part', () => {
    const parts = splitMessage(
      msg({ role: 'agent', text: 'x', markProposals: [], chapterMarkPlan: [], planEntries: [], steps: [] }),
    )
    expect(parts.map((p) => p.kind)).toEqual(['text'])
  })

  it('不修改输入消息', () => {
    const input = msg({
      role: 'agent',
      text: 'x',
      markProposals: [{ proposal: proposal('p1'), status: 'pending' }],
      steps: [{ num: 1, title: '读', desc: '读正文' }],
    })
    const frozen = JSON.parse(JSON.stringify(input))
    splitMessage(input)
    expect(input).toEqual(frozen)
  })
})

describe('splitMessage 顺序', () => {
  it('agent 全量顺序 = text → present → steps → proposal → chapter-plan → plan', () => {
    const parts = splitMessage(
      msg({
        role: 'agent',
        text: '正文',
        presentResult: PRESENT,
        steps: [{ num: 1, title: '读', desc: '读正文' }],
        markProposals: [{ proposal: proposal('p1'), status: 'pending' }],
        chapterMarkPlan: [chapterEntry('ch1', 0)],
        planEntries: PLAN_ENTRIES,
      }),
    )
    expect(parts.map((p) => p.kind)).toEqual([
      'text',
      'present',
      'steps',
      'proposal',
      'chapter-plan',
      'plan',
    ])
  })

  it('tool 全量顺序 = approval → tool → present → steps → proposal → chapter-plan → plan', () => {
    const parts = splitMessage(
      msg({
        role: 'tool',
        toolCallId: 'tc-all',
        toolTitle: 'montree_present',
        toolStatus: 'pending',
        presentResult: PRESENT,
        steps: [{ num: 1, title: '读', desc: '读正文' }],
        markProposal: proposal('single'),
        markProposals: [{ proposal: proposal('plural'), status: 'pending' }],
        chapterMarkPlan: [chapterEntry('ch1', 0)],
        planEntries: PLAN_ENTRIES,
      }),
      { needsApproval: true },
    )
    expect(parts.map((p) => p.kind)).toEqual([
      'approval',
      'tool',
      'present',
      'steps',
      'proposal',
      'chapter-plan',
      'plan',
    ])
    if (parts[4]?.kind === 'proposal') {
      expect(parts[4].items.map((i) => i.proposal.id)).toEqual(['single', 'plural'])
    } else {
      expect.unreachable('应有 proposal part')
    }
  })
})
