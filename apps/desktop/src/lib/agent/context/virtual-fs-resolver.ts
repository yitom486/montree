import type {
  MontreeSnapshotArgs,
  MontreeSnapshotResource,
} from '@montree/contracts'
import type { MarkProposalItem, MarkProposalKind, MarkProposalPayload } from '@montree/annotations'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { collectActiveDocument, collectReadingState } from './collect-turn-context'
import {
  readCurrentDocumentText,
  readViewportText,
} from './reader-content-registry'
import { readChapterByRef } from './read-chapter-by-ref'
import {
  createBookmarkForAgent,
  createNoteForAgent,
  listHighlightsForAgent,
  listMarksForAgent,
  proposeMarkAtForAgentResult,
} from './read-marks-for-agent'
import { suggestChaptersForAgent } from './suggest-chapters-for-agent'
import {
  deleteTocDraftEntry,
  readTocDraft,
  upsertTocDraftEntry,
  writeTocDraft,
} from './toc-draft'
import { readSelectionWithContext } from './read-selection-context'
import { searchReaderContent } from './search-reader-content'
import { inspectIndexedContentForAgent } from './inspect-indexed-content'
import type { MontreeActiveDocument, MontreeReadingState } from './turn-context'

function parseMarkProposalArgs(args?: MontreeSnapshotArgs): MarkProposalPayload {
  const marksRaw = (args as { marks?: unknown } | undefined)?.marks
  const marks = Array.isArray(marksRaw)
    ? marksRaw
        .map((row): MarkProposalItem | null => {
          if (!row || typeof row !== 'object') return null
          const item = row as Record<string, unknown>
          const excerpt = typeof item.excerpt === 'string' ? item.excerpt.trim() : ''
          if (!excerpt) return null
          const kind =
            item.kind === 'highlight' || item.kind === 'note' || item.kind === 'auto'
              ? (item.kind as MarkProposalKind)
              : undefined
          return {
            excerpt,
            note: typeof item.note === 'string' ? item.note : undefined,
            flatIndex:
              typeof item.flatIndex === 'number' && Number.isFinite(item.flatIndex)
                ? item.flatIndex
                : undefined,
            kind,
          }
        })
        .filter((row): row is MarkProposalItem => row !== null)
    : undefined

  const kind =
    args?.kind === 'highlight' || args?.kind === 'note' || args?.kind === 'auto'
      ? args.kind
      : undefined

  return {
    excerpt: args?.excerpt,
    note: args?.note,
    flatIndex: args?.flatIndex,
    kind,
    marks: marks?.length ? marks : undefined,
  }
}

/** 目录条目上限：整本书目录再大也不该一次灌满 Agent 上下文 */
export const TOC_ENTRY_LIMIT = 600

export interface MontreeTocEntry {
  index: number
  level: number
  label: string
}

export interface MontreeTocSnapshot {
  document: MontreeActiveDocument | null
  format: string | null
  unitCount: number
  /** 当前所在条目下标，未知为 -1 */
  currentIndex: number
  truncated: boolean
  entries: MontreeTocEntry[]
}

export interface MontreeFocusedSnapshot {
  activeDocument: MontreeActiveDocument | null
  reading?: MontreeReadingState
}

interface TocSourceUnit {
  label: string
  level?: number
}

export function buildTocEntries(
  units: readonly TocSourceUnit[],
  limit = TOC_ENTRY_LIMIT,
): { entries: MontreeTocEntry[]; truncated: boolean } {
  const entries = units.slice(0, limit).map((unit, index) => ({
    index,
    level: unit.level ?? 0,
    label: unit.label,
  }))
  return { entries, truncated: units.length > limit }
}

function buildTocSnapshot(): MontreeTocSnapshot {
  const document = collectActiveDocument()
  const reader = useReaderNavigationStore.getState()
  const sameFile = Boolean(document) && reader.filePath === document?.path

  if (!sameFile || !reader.ready) {
    return {
      document,
      format: null,
      unitCount: 0,
      currentIndex: -1,
      truncated: false,
      entries: [],
    }
  }

  const { entries, truncated } = buildTocEntries(reader.units)
  return {
    document,
    format: reader.format,
    unitCount: reader.units.length,
    currentIndex: reader.nav.flatIndex,
    truncated,
    entries,
  }
}

function buildFocusedSnapshot(): MontreeFocusedSnapshot {
  const activeDocument = collectActiveDocument()
  return { activeDocument, reading: collectReadingState(activeDocument) }
}

/**
 * 把快照资源序列化成 Agent 能直接读的文本。
 * 全部取自渲染进程内存，不重新解析文件、不落盘。
 */
export async function resolveMontreeSnapshot(
  resource: MontreeSnapshotResource,
  args?: MontreeSnapshotArgs,
): Promise<string> {
  switch (resource) {
    case 'toc.json':
      return JSON.stringify(buildTocSnapshot(), null, 2)
    case 'focused.json':
      return JSON.stringify(buildFocusedSnapshot(), null, 2)
    case 'chapter.txt':
      return await readCurrentDocumentText()
    case 'viewport.txt':
      return await readViewportText()
    case 'search':
      return JSON.stringify(await searchReaderContent(args?.query ?? ''), null, 2)
    case 'content-audit':
      return inspectIndexedContentForAgent(args?.query ?? '', args?.limit)
    case 'selection':
      return JSON.stringify(await readSelectionWithContext(), null, 2)
    case 'chapter':
      return JSON.stringify(
        await readChapterByRef({
          flatIndex: args?.flatIndex,
          title: args?.title,
        }),
        null,
        2,
      )
    case 'marks':
      return JSON.stringify(
        await listMarksForAgent({
          filter:
            args?.filter === 'highlights' ||
            args?.filter === 'bookmarks' ||
            args?.filter === 'all'
              ? args.filter
              : undefined,
        }),
        null,
        2,
      )
    case 'highlights':
      return JSON.stringify(await listHighlightsForAgent(), null, 2)
    case 'create-bookmark':
      return JSON.stringify(await createBookmarkForAgent(), null, 2)
    case 'create-note':
    case 'propose-note':
      return JSON.stringify(await createNoteForAgent(args?.note ?? ''), null, 2)
    case 'propose-mark':
      return JSON.stringify(
        await proposeMarkAtForAgentResult(parseMarkProposalArgs(args)),
        null,
        2,
      )
    case 'suggest-chapters': {
      const chapters = Array.isArray(args?.chapters)
        ? args.chapters
            .map((row) => {
              if (!row || typeof row !== 'object') return null
              const item = row as Record<string, unknown>
              const flatIndex = item.flatIndex
              const title = typeof item.title === 'string' ? item.title : ''
              const reason = typeof item.reason === 'string' ? item.reason : ''
              if (typeof flatIndex !== 'number' || !Number.isFinite(flatIndex) || !title.trim()) {
                return null
              }
              return { flatIndex, title: title.trim(), reason: reason.trim() }
            })
            .filter((row): row is { flatIndex: number; title: string; reason: string } => row !== null)
        : []
      return JSON.stringify(await suggestChaptersForAgent(chapters), null, 2)
    }
    case 'toc-draft-read': {
      return JSON.stringify(readTocDraft() ?? { fingerprint: '', entries: [] }, null, 2)
    }
    case 'toc-draft-write': {
      return JSON.stringify(applyTocDraftWrite(args), null, 2)
    }
  }
}

/**
 * 目录 Agent 草稿写回（toc_* MCP 工具经快照回路到这里）。
 * 返回可直接回给模型的确认 JSON。
 */
function applyTocDraftWrite(args?: {
  op?: unknown
  fingerprint?: unknown
  entries?: unknown
  entry?: unknown
  title?: unknown
  index?: unknown
}): Record<string, unknown> {
  const fingerprint = typeof args?.fingerprint === 'string' ? args.fingerprint.trim() : ''
  if (!fingerprint) {
    return { ok: false, error: '缺少 fingerprint（取自任务提示）' }
  }
  const op = args?.op
  if (op === 'replace') {
    const { count, dropped } = writeTocDraft(fingerprint, args?.entries)
    return { ok: true, op, count, dropped }
  }
  if (op === 'upsert') {
    const result = upsertTocDraftEntry(fingerprint, args?.entry)
    if ('error' in result) return { ok: false, error: result.error }
    return { ok: true, op, ...result }
  }
  if (op === 'delete') {
    const result = deleteTocDraftEntry(fingerprint, {
      index: args?.index,
      title: args?.title,
    })
    return { ok: true, op, ...result }
  }
  return { ok: false, error: `未知 op（replace | upsert | delete）：${String(op)}` }
}
