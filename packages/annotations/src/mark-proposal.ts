/** AI 提议的阅读标记（批注 / 高亮），须用户确认后才写入 marks 文件。 */

export type ProposedMarkKind = 'highlight' | 'note'

export type ProposedMarkSource = 'agent' | 'annotation'

export type MarkProposalStatus = 'pending' | 'adopted' | 'dismissed'

/** 单条标记提议的操作类型；省略时由 note 是否为空推断。 */
export type MarkProposalKind = 'highlight' | 'note' | 'auto'

export interface ProposedMark {
  id: string
  kind: ProposedMarkKind
  excerpt: string
  note: string
  locationHint?: string
  /** 所在章在扁平目录中的下标 */
  flatIndex?: number
  source: ProposedMarkSource
}

export interface MarkProposalItem {
  excerpt: string
  note?: string
  flatIndex?: number
  kind?: MarkProposalKind
}

/** montree_propose_mark 统一入参：单条或批量（marks 优先）。 */
export interface MarkProposalPayload {
  excerpt?: string
  note?: string
  flatIndex?: number
  kind?: MarkProposalKind
  marks?: MarkProposalItem[]
}

export const MARK_PROPOSAL_BATCH_MAX = 10

export interface MarkProposalToolResult {
  proposed: true
  note: string
  excerpt: string
  message: string
  locationHint?: string
  kind?: ProposedMarkKind
}

export interface MarkProposalBatchToolResult {
  proposed: true
  count: number
  marks: MarkProposalToolResult[]
  message: string
}

export function resolveMarkProposalKind(
  note: string | undefined,
  kind?: MarkProposalKind,
): ProposedMarkKind {
  if (kind === 'highlight') return 'highlight'
  if (kind === 'note') return 'note'
  return proposedMarkKind(note ?? '')
}

export function proposedMarkKind(note: string): ProposedMarkKind {
  return note.trim() ? 'note' : 'highlight'
}

export function toProposedMark(
  payload: Pick<ProposedMark, 'excerpt' | 'note'> & {
    id?: string
    locationHint?: string
    flatIndex?: number
    source?: ProposedMarkSource
    kind?: MarkProposalKind
  },
): ProposedMark {
  const note = payload.note ?? ''
  return {
    id: payload.id ?? `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: resolveMarkProposalKind(note, payload.kind),
    excerpt: payload.excerpt ?? '',
    note,
    locationHint: payload.locationHint,
    flatIndex: payload.flatIndex,
    source: payload.source ?? 'agent',
  }
}
