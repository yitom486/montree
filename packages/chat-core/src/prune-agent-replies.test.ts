import { describe, expect, it } from 'vitest'
import { pruneIntermediateAgentReplies } from './prune-agent-replies'
import type { ChatMessage } from './chat-message'

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'text'>,
): ChatMessage {
  return { createdAt: 1, ...partial }
}

describe('pruneIntermediateAgentReplies', () => {
  it('keeps only the last agent reply after the latest user message', () => {
    const input = [
      msg({ id: 'u1', role: 'user', text: 'do it' }),
      msg({ id: 't1', role: 'thought', text: 'thinking' }),
      msg({ id: 'a1', role: 'agent', text: 'will create…' }),
      msg({ id: 'tool1', role: 'tool', text: 'write', toolCallId: 'c1' }),
      msg({ id: 'a2', role: 'agent', text: 'create failed, retry' }),
      msg({ id: 'tool2', role: 'tool', text: 'write', toolCallId: 'c2' }),
      msg({ id: 'a3', role: 'agent', text: 'done, file deleted' }),
    ]
    const out = pruneIntermediateAgentReplies(input)
    expect(out.map((m) => m.id)).toEqual(['u1', 't1', 'tool1', 'tool2', 'a3'])
    expect(out.find((m) => m.role === 'agent')?.text).toBe('done, file deleted')
  })

  it('drops empty agent placeholders', () => {
    const out = pruneIntermediateAgentReplies([
      msg({ id: 'u1', role: 'user', text: 'hi' }),
      msg({ id: 'a0', role: 'agent', text: '' }),
      msg({ id: 'a1', role: 'agent', text: 'hello' }),
    ])
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1'])
  })

  it('does not touch earlier turns', () => {
    const out = pruneIntermediateAgentReplies([
      msg({ id: 'u0', role: 'user', text: 'old' }),
      msg({ id: 'a0', role: 'agent', text: 'old reply 1' }),
      msg({ id: 'a0b', role: 'agent', text: 'old reply 2' }),
      msg({ id: 'u1', role: 'user', text: 'new' }),
      msg({ id: 'a1', role: 'agent', text: 'mid' }),
      msg({ id: 'a2', role: 'agent', text: 'final' }),
    ])
    expect(out.map((m) => m.id)).toEqual(['u0', 'a0', 'a0b', 'u1', 'a2'])
  })
})
