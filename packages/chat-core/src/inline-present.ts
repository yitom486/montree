import { parsePresentResult } from '@montree/contracts'
import type { ChatMessage } from './chat-message'

export type InlinePresentPart =
  | { kind: 'markdown'; text: string; offset: number }
  | { kind: 'present'; reference: string; offset: number }

/** Only complete, top-level fences are references; examples inside other fences stay literal. */
export function splitInlinePresent(text: string): InlinePresentPart[] {
  const parts: InlinePresentPart[] = []
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  let offset = 0
  let start = 0
  for (let i = 0; i < lines.length; i++) {
    const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/.exec(lines[i]!)
    if (!opening) { offset += lines[i]!.length; continue }
    const fence = opening[1]!
    let end = i + 1
    const close = new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}[ \t]*\r?\n?$')
    while (end < lines.length && !close.test(lines[end]!)) end++
    if (end === lines.length) break
    const body = lines.slice(i + 1, end).join('').trim()
    const length = lines.slice(i, end + 1).join('').length
    if (opening[2]!.trim() === 'montree-present' && /^[A-Za-z0-9_.:-]{1,160}$/.test(body)) {
      if (offset > start) parts.push({ kind: 'markdown', text: text.slice(start, offset), offset: start })
      parts.push({ kind: 'present', reference: body, offset })
      start = offset + length
    }
    offset += length
    i = end
  }
  if (start < text.length) parts.push({ kind: 'markdown', text: text.slice(start), offset: start })
  return parts
}

export interface InlinePresentSlot {
  message?: ChatMessage
  state: 'ready' | 'streaming' | 'duplicate' | 'unavailable'
}

/** Resolve within a user turn, using only prior successful results. Hidden answers cannot steal cards. */
export function planInlinePresent(messages: ChatMessage[], visibleIds: Set<string>) {
  const slotsByMessage = new Map<string, Map<number, InlinePresentSlot>>()
  const claimedToolIds = new Set<string>()
  const available = new Map<string, ChatMessage>()
  const references = new Map<string, InlinePresentPart[]>()
  for (const message of messages) {
    if (message.role !== 'agent' || !visibleIds.has(message.id) || !message.text.includes('montree-present')) continue
    const parts = splitInlinePresent(message.text).filter(part => part.kind === 'present')
    if (parts.length) references.set(message.id, parts)
  }
  // Ordinary streaming replies must not reparse historical tool JSON on every chunk.
  if (!references.size) return { slotsByMessage, claimedToolIds }
  for (const message of messages) {
    if (message.role === 'user') available.clear()
    if (message.role === 'tool' && message.toolStatus === 'completed' && !message.streaming) {
      const detail = message.toolContentText || message.text
      const result = message.presentResult ?? (detail.includes('schemaVersion') ? parsePresentResult(detail) : null)
      if (result) {
        const verified = message.presentResult ? message : { ...message, presentResult: result }
        available.set(result.id, verified)
        if (message.toolCallId) available.set(message.toolCallId, verified)
      }
    }
    const parts = references.get(message.id)
    if (!parts) continue
    const slots = new Map<number, InlinePresentSlot>()
    for (const part of parts) {
      if (part.kind !== 'present') continue
      const tool = available.get(part.reference)
      if (!tool) slots.set(part.offset, { state: 'unavailable' })
      else if (message.streaming) slots.set(part.offset, { state: 'streaming' })
      else if (claimedToolIds.has(tool.id)) slots.set(part.offset, { state: 'duplicate' })
      else {
        claimedToolIds.add(tool.id)
        slots.set(part.offset, { state: 'ready', message: tool })
      }
    }
    slotsByMessage.set(message.id, slots)
  }
  return { slotsByMessage, claimedToolIds }
}
