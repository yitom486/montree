import { describe, expect, it } from 'vitest'
import { isProposalPromotedToAgent } from './mark-promotion'
import type { ChatMessage } from './chat-message'
import { toProposedMark } from '@montree/annotations'

describe('mark-promotion', () => {
  it('isProposalPromotedToAgent 检测已挂载', () => {
    const proposal = toProposedMark({ id: 'p1', excerpt: '', note: 'x', source: 'agent' })
    const messages: ChatMessage[] = [
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
})
