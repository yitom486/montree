import { describe, expect, it } from 'vitest'
import { planInlinePresent, splitInlinePresent } from './inline-present'
import type { ChatMessage } from './chat-message'

const fence = (id = 'chart-1') => ['```montree-present', id, '```'].join('\n')
const msg = (id: string, role: ChatMessage['role'], text = ''): ChatMessage => ({ id, role, text, createdAt: 1 })
const tool: ChatMessage = { ...msg('tool-1', 'tool'), toolCallId: 'call-1', toolStatus: 'completed',
  toolContentText: JSON.stringify({ schemaVersion: 1, kind: 'html-artifact', id: 'chart-1', title: '图', html: '<button>点我</button>' }) }
const user = msg('u', 'user')
const answer = msg('a', 'agent', '解释前文\n\n' + fence() + '\n解释后文')
const plan = (messages: ChatMessage[], visible = messages.map(m => m.id)) => planInlinePresent(messages, new Set(visible))

describe('inline present placement', () => {
  it('splits paragraph/component/paragraph with stable source offsets', () => {
    const parts = splitInlinePresent(answer.text)
    expect(parts.map(p => p.kind)).toEqual(['markdown', 'present', 'markdown'])
    expect(parts[0]).toMatchObject({ text: '解释前文\n\n', offset: 0 })
    expect(parts[1]).toMatchObject({ reference: 'chart-1' })
    expect(parts[2]).toMatchObject({ text: '解释后文' })
  })
  it('ignores quoted examples, ordinary fences and incomplete references', () => {
    for (const text of ['````md\n' + fence() + '\n````', '> ' + fence().replaceAll('\n', '\n> '), '```montree-present\nchart-1', fence('bad id')]) {
      expect(splitInlinePresent(text).every(p => p.kind === 'markdown')).toBe(true)
    }
    expect(splitInlinePresent(fence().replaceAll('```', '~~~'))[0]?.kind).toBe('present')
  })
  it('places validated prior result once and preserves original data', () => {
    const result = plan([user, tool, answer])
    expect([...result.slotsByMessage.get('a')!.values()][0]?.message?.presentResult?.id).toBe('chart-1')
    expect([...result.claimedToolIds]).toEqual(['tool-1'])
    expect(tool.presentResult).toBeUndefined()
  })
  it('does not steal fallback during streaming or pagination', () => {
    expect(plan([user, tool, { ...answer, streaming: true }]).claimedToolIds.size).toBe(0)
    expect(plan([user, tool, answer], ['tool-1']).claimedToolIds.size).toBe(0)
  })
  it('rejects cross-turn, future, failed and malformed result references', () => {
    for (const messages of [[tool, user, answer], [user, answer, tool], [user, { ...tool, toolStatus: 'failed' }, answer], [user, { ...tool, toolContentText: '{}' }, answer]]) {
      const result = plan(messages)
      expect(result.claimedToolIds.size).toBe(0)
      expect([...result.slotsByMessage.get('a')!.values()][0]?.state).toBe('unavailable')
    }
  })
  it('deduplicates repeated references and tool-call aliases', () => {
    const result = plan([user, tool, { ...answer, text: fence() + '\n' + fence('call-1') }, msg('a2', 'agent', fence())])
    expect([...result.slotsByMessage.get('a')!.values()].map(s => s.state)).toEqual(['ready', 'duplicate'])
    expect([...result.slotsByMessage.get('a2')!.values()][0]?.state).toBe('duplicate')
  })
})
