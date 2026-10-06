import { describe, expect, it } from 'vitest'
import { promoteMarkProposalsToLastAgent, isProposalPromotedToAgent } from '@/lib/agent/promote-mark-proposals'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { toProposedMark } from '@montree/annotations'

describe('promote-mark-proposals', () => {
  it('把工具 propose 挂到最近 Agent 回复下方', () => {
    const proposal = toProposedMark({ excerpt: '原文', note: '批注', source: 'agent' })
    const messages: AcpChatMessage[] = [
      { id: 'u1', role: 'user', text: '写批注', createdAt: 1 },
      {
        id: 't1',
        role: 'tool',
        text: '{}',
        createdAt: 2,
        toolCallId: 'tc1',
        markProposal: proposal,
        markProposalStatus: 'pending',
      },
      { id: 'a1', role: 'agent', text: '已整理草稿', createdAt: 3 },
    ]
    const next = promoteMarkProposalsToLastAgent(messages)
    const agent = next.find((m) => m.id === 'a1')
    expect(agent?.markProposals).toHaveLength(1)
    expect(agent?.markProposals?.[0]?.proposal.note).toBe('批注')
  })

  it('isProposalPromotedToAgent 检测已挂载', () => {
    const proposal = toProposedMark({ id: 'p1', excerpt: '', note: 'x', source: 'agent' })
    const messages: AcpChatMessage[] = [
      {
        id: 'a1',
        role: 'agent',
        text: 'ok',
        createdAt: 1,
        markProposals: [{ proposal, status: 'pending' }],
      },
    ]
    expect(isProposalPromotedToAgent(messages, 'p1')).toBe(true)
  })

  it('只提升当前用户回合的工具提议，不把已保存的旧卡片搬到最新回复', () => {
    const previous = toProposedMark({
      id: 'previous',
      excerpt: '上一轮原文',
      note: '',
      source: 'agent',
    })
    const current = toProposedMark({
      id: 'current',
      excerpt: '本轮原文',
      note: '本轮批注',
      source: 'agent',
    })
    const messages: AcpChatMessage[] = [
      { id: 'u1', role: 'user', text: '上一轮划重点', createdAt: 1 },
      {
        id: 't1',
        role: 'tool',
        text: '{}',
        createdAt: 2,
        toolCallId: 'previous-tool',
        markProposal: previous,
        markProposalStatus: 'adopted',
      },
      {
        id: 'a1',
        role: 'agent',
        text: '上一轮已保存',
        createdAt: 3,
        markProposals: [{ proposal: previous, status: 'adopted' }],
      },
      { id: 'u2', role: 'user', text: '本轮划重点', createdAt: 4 },
      {
        id: 't2',
        role: 'tool',
        text: '{}',
        createdAt: 5,
        toolCallId: 'current-tool',
        markProposal: current,
        markProposalStatus: 'pending',
      },
      { id: 'a2', role: 'agent', text: '本轮待确认', createdAt: 6 },
    ]

    const next = promoteMarkProposalsToLastAgent(messages)

    expect(next.find((message) => message.id === 'a1')?.markProposals).toEqual([
      { proposal: previous, status: 'adopted' },
    ])
    expect(next.find((message) => message.id === 'a2')?.markProposals).toEqual([
      { proposal: current, status: 'pending', toolCallId: 'current-tool' },
    ])
  })
})
