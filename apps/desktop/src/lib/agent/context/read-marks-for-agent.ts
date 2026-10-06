import { isReaderDocumentKind } from '@montree/contracts'
import type { DocumentKind } from '@montree/contracts'
import { readingMarksApi } from '@/api/reading-marks-api'
import { isOk } from '@montree/contracts'
import {
  collectHighlightPassages,
  serializeMarkPassage,
} from '@montree/reader-core'
import { collectActiveDocument } from './collect-turn-context'
import { getReaderMarksProvider } from './reader-marks-registry'

export {
  collectHighlightPassages,
  isHighlightPassage,
  serializeMarkPassage as serializeMarkForAgent,
} from '@montree/reader-core'

function supportsMontreeMarks(kind: DocumentKind): boolean {
  return kind === 'web' || isReaderDocumentKind(kind)
}

async function loadMarksForOpenDocument() {
  const document = collectActiveDocument()
  if (!document?.path) {
    throw new Error('当前没有打开的文档')
  }
  if (!supportsMontreeMarks(document.kind)) {
    throw new Error('当前不是 EPUB/PDF/MOBI/在线文档，不必用 Montree 书签工具')
  }

  const result = await readingMarksApi.list(document.path)
  if (!isOk(result)) {
    throw new Error(result.error.message || '读取书签失败')
  }

  return { document, marks: result.value }
}

export type MarkListFilter = 'all' | 'highlights' | 'bookmarks'

export async function listMarksForAgent(options?: {
  filter?: MarkListFilter
}): Promise<{
  documentPath: string
  filter: MarkListFilter
  count: number
  marks: ReturnType<typeof serializeMarkPassage>[]
}> {
  const filter = options?.filter ?? 'all'
  if (filter === 'highlights') {
    const highlights = await listHighlightsForAgent()
    return {
      documentPath: highlights.documentPath,
      filter,
      count: highlights.count,
      marks: highlights.highlights,
    }
  }

  const { document, marks } = await loadMarksForOpenDocument()
  const filtered =
    filter === 'bookmarks' ? marks.filter((mark) => mark.kind === 'bookmark') : marks
  return {
    documentPath: document.path,
    filter,
    count: filtered.length,
    marks: filtered.map(serializeMarkPassage),
  }
}

export async function listHighlightsForAgent(): Promise<{
  documentPath: string
  count: number
  highlightCount: number
  noteCount: number
  passages: string[]
  highlights: ReturnType<typeof collectHighlightPassages>
}> {
  const { document, marks } = await loadMarksForOpenDocument()
  const highlights = collectHighlightPassages(marks)
  return {
    documentPath: document.path,
    count: highlights.length,
    highlightCount: highlights.filter((item) => item.kind === 'highlight').length,
    noteCount: highlights.filter((item) => item.kind === 'note' || Boolean(item.note)).length,
    passages: highlights.map((item) => item.text),
    highlights,
  }
}

export async function createBookmarkForAgent(): Promise<ReturnType<typeof serializeMarkPassage>> {
  const provider = getReaderMarksProvider()
  if (!provider) {
    throw new Error('当前阅读器未就绪，无法创建书签')
  }
  const mark = await provider.createBookmark()
  return serializeMarkPassage(mark)
}

export {
  createNoteForAgent,
  proposeNoteForAgent,
  proposeMarkAtForAgentResult,
} from '@/lib/agent/context/propose-note-for-agent'
