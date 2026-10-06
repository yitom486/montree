import type { MarkProposalPayload } from '@montree/annotations'
import { excerptAppearsIn, findExcerptInText } from '@/lib/reader/marks/excerpt-text-match'
import {
  markProposalDevLog,
  markProposalTextPreview,
} from '@/lib/agent/context/mark-proposal-dev-log'
import { readChapterByRef } from '@/lib/agent/context/read-chapter-by-ref'
import {
  getReaderContentProvider,
  readCurrentDocumentText,
  readViewportText,
} from '@/lib/agent/context/reader-content-registry'
import { getReaderMarksProvider } from '@/lib/agent/context/reader-marks-registry'
import {
  hasActiveSelection,
  readSelectionText,
} from '@/lib/agent/context/reader-selection-registry'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'

export type MarkTargetResolution =
  | 'selection'
  | 'sticky'
  | 'excerpt-viewport'
  | 'excerpt-viewport-fuzzy'
  | 'excerpt-chapter'
  | 'excerpt-chapter-fuzzy'
  | 'excerpt-flat-index'
  | 'excerpt-flat-index-fuzzy'

export interface ResolvedMarkTarget {
  excerpt: string
  note: string
  kind: 'highlight' | 'note'
  flatIndex?: number
  locationHint: string
  resolution: MarkTargetResolution
}

export type ResolveMarkTargetResult =
  | { ok: true; target: ResolvedMarkTarget }
  | { ok: false; reason: string }

function selectionMatchesExcerpt(selection: string, excerpt: string): boolean {
  const sel = selection.trim()
  const ex = excerpt.trim()
  if (!sel || !ex) return false
  if (sel === ex) return true
  if (sel.length <= 240 && ex.length <= 240 && (sel.includes(ex) || ex.includes(sel))) {
    return true
  }
  if (excerptAppearsIn(sel, ex) || excerptAppearsIn(ex, sel)) return true
  if (sel.length <= 400 && ex.length <= 400) {
    return findExcerptInText(sel, ex) !== null || findExcerptInText(ex, sel) !== null
  }
  return false
}

function locationHintWithMatch(label: string, confidence: 'exact' | 'fuzzy'): string {
  return confidence === 'fuzzy' ? `${label}（推测匹配）` : label
}

function resolutionForMatch(
  scope: 'viewport' | 'chapter' | 'flat-index',
  confidence: 'exact' | 'fuzzy',
): MarkTargetResolution {
  if (scope === 'viewport') {
    return confidence === 'fuzzy' ? 'excerpt-viewport-fuzzy' : 'excerpt-viewport'
  }
  if (scope === 'chapter') {
    return confidence === 'fuzzy' ? 'excerpt-chapter-fuzzy' : 'excerpt-chapter'
  }
  return confidence === 'fuzzy' ? 'excerpt-flat-index-fuzzy' : 'excerpt-flat-index'
}

function resolveInHaystack(
  hint: string,
  haystack: string,
  scope: 'viewport' | 'chapter' | 'flat-index',
  label: string,
  note: string,
  kind: 'highlight' | 'note',
  flatIndex?: number,
): ResolvedMarkTarget | null {
  const match = findExcerptInText(haystack, hint)
  if (!match) return null
  markProposalDevLog('match:text', {
    scope,
    confidence: match.confidence,
    score: match.score,
    hint: markProposalTextPreview(hint),
    excerpt: markProposalTextPreview(match.excerpt),
  })
  return {
    excerpt: match.excerpt,
    note,
    kind,
    flatIndex,
    locationHint: locationHintWithMatch(label, match.confidence),
    resolution: resolutionForMatch(scope, match.confidence),
  }
}

export async function resolveMarkTarget(
  payload: MarkProposalPayload,
): Promise<ResolveMarkTargetResult> {
  const provider = getReaderMarksProvider()
  const filePath = provider?.filePath
  if (!filePath) {
    return { ok: false, reason: '当前阅读器未就绪，无法定位标记' }
  }

  const note = payload.note?.trim() ?? ''
  const kind = note ? ('note' as const) : ('highlight' as const)
  const selection = readSelectionText(filePath)
  const excerptInput = payload.excerpt?.trim() ?? ''

  if (selection && (!excerptInput || selectionMatchesExcerpt(selection, excerptInput))) {
    return {
      ok: true,
      target: {
        excerpt: selection,
        note,
        kind,
        locationHint: '当前选区',
        resolution: hasActiveSelection() ? 'selection' : 'sticky',
      },
    }
  }

  if (!excerptInput) {
    return {
      ok: false,
      reason: '需要摘录原文或当前选区；无选区时请提供 excerpt 参数',
    }
  }

  const flatIndex = payload.flatIndex

  if (typeof flatIndex === 'number') {
    const chapter = await readChapterByRef({ flatIndex })
    const target = resolveInHaystack(
      excerptInput,
      chapter.text,
      'flat-index',
      chapter.label,
      note,
      kind,
      flatIndex,
    )
    if (!target) {
      return {
        ok: false,
        reason: `未在指定章节（${chapter.label}）中找到与「${excerptInput.slice(0, 24)}${excerptInput.length > 24 ? '…' : ''}」相近的句子；请打开该章或划词后再试`,
      }
    }
    return { ok: true, target }
  }

  const content = getReaderContentProvider()
  if (content?.filePath === filePath && content.getViewportText) {
    try {
      const viewport = await readViewportText(filePath)
      const target = resolveInHaystack(
        excerptInput,
        viewport,
        'viewport',
        '当前视口',
        note,
        kind,
      )
      if (target) return { ok: true, target }
    } catch {
      // 视口不可用则降级到整章
    }
  }

  try {
    const chapterText = await readCurrentDocumentText(filePath)
    const nav = useReaderNavigationStore.getState()
    const label = nav.units[nav.nav.flatIndex]?.label ?? '当前章'
    const target = resolveInHaystack(
      excerptInput,
      chapterText,
      'chapter',
      label,
      note,
      kind,
      nav.nav.flatIndex >= 0 ? nav.nav.flatIndex : undefined,
    )
    if (target) return { ok: true, target }
  } catch {
    // fall through
  }

  const preview = excerptInput.slice(0, 32)
  return {
    ok: false,
    reason: `未在当前视口或章节中找到与「${preview}${excerptInput.length > 32 ? '…' : ''}」相近的句子；请打开对应章节、划词，或让 Agent 先读 viewport 再 propose`,
  }
}
