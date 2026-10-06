import { fileApi } from '@/api/file-api'
import { isOk } from '@montree/contracts'
import { reportAppError } from '@/lib/workspace/report-error'
import {
  bookTitleFromPath,
  buildReadingNotesExport,
  type ReadingNotesChapterRef,
  type ReadingNotesContentKind,
  type ReadingNotesScope,
} from '@montree/reader-core'
import type { ReadingMark } from '@montree/contracts'
import { toast } from 'sonner'

export async function saveReadingNotesExport(options: {
  marks: ReadingMark[]
  toc: ReadingNotesChapterRef[]
  contentKind: ReadingNotesContentKind
  scope: ReadingNotesScope
  currentChapter?: ReadingNotesChapterRef | null
  filePath: string
  resolveChapter: (mark: ReadingMark, toc: ReadingNotesChapterRef[]) => ReadingNotesChapterRef
}): Promise<void> {
  const built = buildReadingNotesExport({
    marks: options.marks,
    toc: options.toc,
    contentKind: options.contentKind,
    scope: options.scope,
    currentChapter: options.currentChapter,
    bookTitle: bookTitleFromPath(options.filePath),
    resolveChapter: options.resolveChapter,
  })

  if (!built) {
    toast.message('当前范围没有可导出的笔记')
    return
  }

  const result = await fileApi.exportMarkdown({
    content: built.markdown,
    suggestedName: built.suggestedName,
  })

  if (!isOk(result)) {
    reportAppError(result.error)
    return
  }

  toast.success(`已导出 ${built.markCount} 条笔记`)
}
