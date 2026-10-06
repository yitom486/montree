import { toast } from 'sonner'
import type {
  MarkProposalItem,
  MarkProposalKind,
  MarkProposalPayload,
  MarkProposalBatchToolResult,
  MarkProposalToolResult,
  ProposedMark,
  ProposedMarkSource,
} from '@montree/annotations'
import {
  MARK_PROPOSAL_BATCH_MAX,
  toProposedMark,
} from '@montree/annotations'
import { getReaderMarksProvider } from '@/lib/agent/context/reader-marks-registry'
import { resolveMarkTarget } from '@/lib/agent/context/resolve-mark-target'
import {
  markProposalDevFail,
  markProposalDevLog,
  markProposalTextPreview,
} from '@/lib/agent/context/mark-proposal-dev-log'
import { readSelectionText } from '@/lib/agent/context/reader-selection-registry'
import {
  annotationFileKey,
  useAnnotationAgentStore,
} from '@/stores/annotation-agent-store'

export interface ProposeMarkOptions {
  excerpt?: string
  flatIndex?: number
  kind?: MarkProposalKind
  filePath?: string
  fileFingerprint?: string
  locationHint?: string
  source?: ProposedMarkSource
  /** 批量提议时不弹 toast、不写 pendingDraft */
  silent?: boolean
}

export interface ProposeMarkResult {
  proposed: true
  note: string
  excerpt: string
  message: string
  locationHint?: string
  kind: 'highlight' | 'note'
  mark: ProposedMark
}

export interface AdoptProposedMarkInput {
  note: string
  excerpt?: string
  flatIndex?: number
  kind?: MarkProposalKind
}

function resolveNote(payload: MarkProposalPayload | MarkProposalItem, fallback = ''): string {
  if (payload.kind === 'highlight') return ''
  return payload.note?.trim() ?? fallback
}

export async function proposeMarkForAgent(
  note: string,
  options: ProposeMarkOptions = {},
): Promise<ProposeMarkResult> {
  const provider = getReaderMarksProvider()
  const filePath = options.filePath ?? provider?.filePath
  if (!filePath && !provider) {
    throw new Error('当前阅读器未就绪，无法提出标记')
  }

  const trimmed = options.kind === 'highlight' ? '' : note.trim()
  const excerpt =
    options.excerpt?.trim() ||
    (provider ? readSelectionText(provider.filePath)?.trim() ?? '' : '')
  const fileKey = annotationFileKey(options.fileFingerprint ?? '', filePath ?? provider!.filePath)
  const mark = toProposedMark({
    excerpt,
    note: trimmed,
    kind: options.kind,
    locationHint: options.locationHint,
    flatIndex: options.flatIndex,
    source: options.source ?? 'agent',
  })

  const store = useAnnotationAgentStore.getState()
  if (!options.silent) {
    store.ensureFile(fileKey)
    store.setPendingDraft({
      fileKey,
      excerpt,
      note: trimmed,
      source: 'ai',
      lastIntentLabel: mark.kind === 'highlight' ? '高亮提议' : '批注草稿',
    })
    store.setPhase('editing')
    store.setProposeHost(options.source === 'annotation' ? 'annotation' : 'main-agent')
    toast.message(
      mark.kind === 'highlight' ? '已提出高亮，可在会话内确认' : '已提出批注草稿，可在会话内确认',
    )
  }

  return {
    proposed: true,
    note: trimmed,
    excerpt,
    kind: mark.kind,
    locationHint: options.locationHint,
    message:
      '已生成可编辑标记提议；用户确认「采用」后才会写入书签库，请勿假定已保存。',
    mark,
  }
}

function toToolResult(result: ProposeMarkResult): MarkProposalToolResult {
  return {
    proposed: true,
    note: result.note,
    excerpt: result.excerpt,
    message: result.message,
    locationHint: result.locationHint,
    kind: result.kind,
  }
}

/** montree_propose_mark：按 excerpt（+ 可选 flatIndex）定位后再提议。 */
export async function proposeMarkAtForAgent(
  payload: MarkProposalPayload,
  options: Omit<ProposeMarkOptions, 'excerpt' | 'flatIndex' | 'kind'> = {},
): Promise<ProposeMarkResult> {
  const excerpt = payload.excerpt?.trim()
  if (!excerpt) {
    throw new Error('montree_propose_mark 需要 excerpt 或 marks 参数')
  }

  const note = resolveNote(payload)
  const resolved = await resolveMarkTarget({
    excerpt,
    note,
    flatIndex: payload.flatIndex,
  })
  if (!resolved.ok) {
    throw new Error(resolved.reason)
  }

  const { target } = resolved
  markProposalDevLog('propose:resolve', {
    resolution: target.resolution,
    excerpt: markProposalTextPreview(target.excerpt),
    locationHint: target.locationHint,
  })
  return proposeMarkForAgent(note, {
    ...options,
    excerpt: target.excerpt,
    locationHint: target.locationHint,
    flatIndex: target.flatIndex,
    kind: payload.kind,
  })
}

export async function proposeMarksBatchForAgent(
  payload: MarkProposalPayload,
  options: Omit<ProposeMarkOptions, 'excerpt' | 'flatIndex' | 'kind'> = {},
): Promise<MarkProposalBatchToolResult> {
  const rawItems = payload.marks ?? []
  if (rawItems.length === 0) {
    throw new Error('marks 数组不能为空')
  }
  const truncated = rawItems.length > MARK_PROPOSAL_BATCH_MAX
  const items = rawItems.slice(0, MARK_PROPOSAL_BATCH_MAX)

  const marks: MarkProposalToolResult[] = []
  for (const item of items) {
    const result = await proposeMarkAtForAgent(
      {
        excerpt: item.excerpt,
        note: resolveNote(item),
        flatIndex: item.flatIndex ?? payload.flatIndex,
        kind: item.kind,
      },
      { ...options, silent: true },
    )
    marks.push(toToolResult(result))
  }

  const truncateNote = truncated
    ? `（收到 ${rawItems.length} 条，超出 ${MARK_PROPOSAL_BATCH_MAX} 上限，已截断）`
    : ''

  return {
    proposed: true,
    count: marks.length,
    marks,
    message: `已生成 ${marks.length} 条标记提议${truncateNote}；用户确认「采用」后才会写入，请勿假定已保存。`,
  }
}

/** MCP / 快照统一入口：单条、批量、或仅选区（legacy propose_note）。 */
export async function proposeMarksUnifiedForAgent(
  payload: MarkProposalPayload,
  options: Omit<ProposeMarkOptions, 'excerpt' | 'flatIndex' | 'kind'> = {},
): Promise<MarkProposalToolResult | MarkProposalBatchToolResult> {
  markProposalDevLog('propose:unified', {
    excerpt: markProposalTextPreview(payload.excerpt),
    note: markProposalTextPreview(payload.note),
    marksCount: payload.marks?.length,
    kind: payload.kind,
    flatIndex: payload.flatIndex,
  })
  try {
    if (payload.marks?.length) {
      const batch = await proposeMarksBatchForAgent(payload, options)
      markProposalDevLog('propose:done', { mode: 'batch', count: batch.count })
      return batch
    }
    if (payload.excerpt?.trim()) {
      const single = toToolResult(await proposeMarkAtForAgent(payload, options))
      markProposalDevLog('propose:done', {
        mode: 'excerpt',
        excerpt: markProposalTextPreview(single.excerpt),
        kind: single.kind,
        locationHint: single.locationHint,
      })
      return single
    }
    const selection = toToolResult(
      await proposeMarkForAgent(resolveNote(payload), {
        ...options,
        kind: payload.kind,
      }),
    )
    markProposalDevLog('propose:done', { mode: 'selection', kind: selection.kind })
    return selection
  } catch (error) {
    markProposalDevFail('propose:unified', error, {
      excerpt: markProposalTextPreview(payload.excerpt),
      marksCount: payload.marks?.length,
    })
    throw error
  }
}

export async function adoptProposedMark(
  input: AdoptProposedMarkInput | string,
): Promise<void> {
  const payload: AdoptProposedMarkInput =
    typeof input === 'string' ? { note: input } : input

  markProposalDevLog('adopt:start', {
    excerpt: markProposalTextPreview(payload.excerpt),
    note: markProposalTextPreview(payload.note),
    flatIndex: payload.flatIndex,
    kind: payload.kind,
  })

  const provider = getReaderMarksProvider()
  if (!provider) {
    throw new Error('当前阅读器未就绪，无法保存标记')
  }

  const note = payload.kind === 'highlight' ? '' : payload.note.trim()
  const excerpt = payload.excerpt?.trim() ?? ''
  const selection = readSelectionText(provider.filePath)

  try {
    if (selection && (!excerpt || selectionMatchesExcerpt(selection, excerpt))) {
      markProposalDevLog('adopt:path', { path: 'selection' })
      await provider.createNoteFromSelection(note)
    } else if (excerpt) {
      markProposalDevLog('adopt:path', {
        path: 'createMarkAt',
        excerpt: markProposalTextPreview(excerpt),
      })
      await provider.createMarkAt({
        excerpt,
        note,
        flatIndex: payload.flatIndex,
      })
    } else {
      markProposalDevLog('adopt:path', { path: 'resolveMarkTarget' })
      const resolved = await resolveMarkTarget({
        excerpt: '',
        note,
        flatIndex: payload.flatIndex,
      })
      if (!resolved.ok) {
        throw new Error(resolved.reason)
      }
      const { target } = resolved
      if (target.resolution === 'selection' || target.resolution === 'sticky') {
        await provider.createNoteFromSelection(target.note)
      } else {
        await provider.createMarkAt({
          excerpt: target.excerpt,
          note: target.note,
          flatIndex: target.flatIndex,
        })
      }
    }

    markProposalDevLog('adopt:done', {})
  } catch (error) {
    markProposalDevFail('adopt:fail', error, {
      excerpt: markProposalTextPreview(excerpt),
      hadSelection: Boolean(selection?.trim()),
    })
    throw error
  }

  const store = useAnnotationAgentStore.getState()
  store.discardDraft()
  store.setExternalProposeOpen(false)
}

function selectionMatchesExcerpt(selection: string, excerpt: string): boolean {
  const sel = selection.trim()
  const ex = excerpt.trim()
  if (!sel || !ex) return false
  if (sel === ex) return true
  if (sel.length <= 240 && ex.length <= 240 && (sel.includes(ex) || ex.includes(sel))) {
    return true
  }
  return sel.length <= ex.length + 32 && ex.includes(sel.slice(0, Math.min(sel.length, 48)))
}

export function dismissProposedMark(): void {
  const store = useAnnotationAgentStore.getState()
  store.discardDraft()
  store.setExternalProposeOpen(false)
}
