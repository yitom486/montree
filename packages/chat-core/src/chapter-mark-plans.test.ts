import { describe, expect, it } from 'vitest'
import { promoteChapterMarkPlansToLastAgent } from './chapter-mark-plans'
import type { ChatMessage } from './chat-message'

describe('promote-chapter-mark-plans', () => {
  it('回合结束把 tool 章级建议挂到最近 Agent 回复', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', text: '哪些章值得划重点', createdAt: 1 },
      {
        id: 't1',
        role: 'tool',
        text: '{}',
        createdAt: 2,
        chapterMarkPlan: [
          {
            id: 'c1',
            flatIndex: 2,
            title: '第三章',
            reason: '干货',
            status: 'pending',
          },
        ],
      },
      { id: 'a1', role: 'agent', text: '我建议这几章', createdAt: 3 },
    ]
    const next = promoteChapterMarkPlansToLastAgent(messages)
    expect(next.find((m) => m.id === 'a1')?.chapterMarkPlan?.[0]?.title).toBe('第三章')
  })
})
