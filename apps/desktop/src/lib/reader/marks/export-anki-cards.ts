import type { ReadingMark } from '@montree/contracts'
import {
  bookTitleFromPath,
  type ReadingNotesChapterRef,
  type ReadingNotesScope,
} from '@montree/reader-core'
import { fileApi } from '@/api/file-api'
import { isOk } from '@montree/contracts'
import { reportAppError } from '@/lib/workspace/report-error'
import { toast } from 'sonner'
import { buildAnkiCardsExport } from '@montree/annotations'

// 门面：纯构建已整迁入 packages/annotations/src/anki-cards.ts，调用方零改
//（ReaderContentShell 的 buildAnkiCardsExport 与单测的各纯函数仍可从此文件导入）。
// sonner / file-api / deep-link 不动：save 路径仍在此文件。
export {
  buildAnkiCardsExport,
  buildAnkiExportFileName,
  escapeAnkiHtml,
  formatFlashcardForAnkiHtml,
  sanitizeAnkiTag,
} from '@montree/annotations'
export type {
  BuildAnkiCardsExportInput,
  BuildAnkiCardsExportResult,
} from '@montree/annotations'

/**
 * 调起文件保存对话框导出 Anki 记忆卡片。
 */
export async function saveAnkiCardsExport(options: {
  marks: ReadingMark[]
  toc: ReadingNotesChapterRef[]
  scope: ReadingNotesScope
  currentChapter?: ReadingNotesChapterRef | null
  filePath: string
  resolveChapter: (mark: ReadingMark, toc: ReadingNotesChapterRef[]) => ReadingNotesChapterRef
}): Promise<void> {
  const built = buildAnkiCardsExport({
    marks: options.marks,
    toc: options.toc,
    scope: options.scope,
    currentChapter: options.currentChapter,
    bookTitle: bookTitleFromPath(options.filePath),
    resolveChapter: options.resolveChapter,
  })

  if (!built) {
    toast.message('当前范围没有可导出的记忆卡片')
    return
  }

  const result = await fileApi.exportMarkdown({
    content: built.content,
    suggestedName: built.suggestedName,
    title: '导出 Anki 记忆卡片',
    filters: [
      { name: 'Anki 导入文件 (*.txt;*.tsv)', extensions: ['txt', 'tsv'] },
      { name: '所有文件 (*.*)', extensions: ['*'] },
    ],
  })

  if (!isOk(result)) {
    reportAppError(result.error)
    return
  }

  toast.success(`已成功导出 ${built.cardCount} 张 Anki 记忆卡片`)
}
