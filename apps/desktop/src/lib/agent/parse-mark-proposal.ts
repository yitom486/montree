import type {
  MarkProposalBatchToolResult,
  MarkProposalToolResult,
  ProposedMark,
} from '@montree/annotations'
import { toProposedMark } from '@montree/annotations'

const PROPOSE_TOOL_PATTERN =
  /montree_(?:propose_note|create_note|propose_mark|create_mark)|propose.?note|create.?note|提议批注|批注草稿/i

export function isProposeMarkToolTitle(title: string | undefined): boolean {
  if (!title?.trim()) return false
  return PROPOSE_TOOL_PATTERN.test(title)
}

function parseSingleToolResult(row: Record<string, unknown>): MarkProposalToolResult | null {
  if (row.proposed !== true) return null
  const note = typeof row.note === 'string' ? row.note : ''
  const excerpt = typeof row.excerpt === 'string' ? row.excerpt : ''
  return {
    proposed: true,
    note,
    excerpt,
    message: typeof row.message === 'string' ? row.message : '',
    locationHint: typeof row.locationHint === 'string' ? row.locationHint : undefined,
    kind: note.trim() ? 'note' : 'highlight',
  }
}

export function parseMarkProposalToolResult(text: string): MarkProposalToolResult | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const row = JSON.parse(trimmed) as Record<string, unknown>
    if (Array.isArray(row.marks)) return null
    return parseSingleToolResult(row)
  } catch {
    return null
  }
}

export function parseMarkProposalBatchToolResult(text: string): MarkProposalBatchToolResult | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const row = JSON.parse(trimmed) as Record<string, unknown>
    if (row.proposed !== true || !Array.isArray(row.marks)) return null
    const marks = row.marks
      .map((item) =>
        item && typeof item === 'object' ? parseSingleToolResult(item as Record<string, unknown>) : null,
      )
      .filter((item): item is MarkProposalToolResult => item !== null)
    if (marks.length === 0) return null
    return {
      proposed: true,
      count: typeof row.count === 'number' ? row.count : marks.length,
      marks,
      message: typeof row.message === 'string' ? row.message : '',
    }
  } catch {
    return null
  }
}

export function parseMarkProposalsFromTool(
  toolTitle: string | undefined,
  toolContentText: string | undefined,
  toolCallId?: string,
): ProposedMark[] {
  const batch = parseMarkProposalBatchToolResult(toolContentText ?? '')
  if (batch) {
    return batch.marks.map((item, index) =>
      toProposedMark({
        id: toolCallId ? `tool:${toolCallId}:${index}` : undefined,
        excerpt: item.excerpt,
        note: item.note,
        locationHint: item.locationHint,
        kind: item.kind,
        source: 'agent',
      }),
    )
  }

  const parsed = parseMarkProposalToolResult(toolContentText ?? '')
  if (parsed) {
    return [
      toProposedMark({
        id: toolCallId ? `tool:${toolCallId}` : undefined,
        excerpt: parsed.excerpt,
        note: parsed.note,
        locationHint: parsed.locationHint,
        kind: parsed.kind,
        source: 'agent',
      }),
    ]
  }

  if (!isProposeMarkToolTitle(toolTitle)) return []
  return []
}

export function parseMarkProposalFromTool(
  toolTitle: string | undefined,
  toolContentText: string | undefined,
  toolCallId?: string,
): ProposedMark | null {
  return parseMarkProposalsFromTool(toolTitle, toolContentText, toolCallId)[0] ?? null
}

export function enrichToolMessageWithMarkProposal<
  T extends {
    role: string
    toolTitle?: string
    toolContentText?: string
    text?: string
    toolCallId?: string
    toolStatus?: string
    streaming?: boolean
    markProposal?: ProposedMark
    markProposalStatus?: import('@montree/annotations').MarkProposalStatus
    markProposals?: Array<{
      proposal: ProposedMark
      status: import('@montree/annotations').MarkProposalStatus
    }>
  },
>(message: T, isActiveStatus: (status: string | undefined) => boolean): T {
  if (message.role !== 'tool' || message.markProposal || message.markProposals?.length) {
    return message
  }
  if (message.streaming || isActiveStatus(message.toolStatus)) return message

  const proposals = parseMarkProposalsFromTool(
    message.toolTitle,
    message.toolContentText ?? message.text,
    message.toolCallId,
  )
  if (proposals.length === 0) return message

  if (proposals.length === 1) {
    return {
      ...message,
      markProposal: proposals[0],
      markProposalStatus: message.markProposalStatus ?? 'pending',
    }
  }

  return {
    ...message,
    markProposals: proposals.map((proposal) => ({
      proposal,
      status: message.markProposalStatus ?? 'pending',
    })),
  }
}
