import { useCallback } from 'react'
import type { ReadingMark } from '@montree/contracts'
import {
  type ReadingNotesChapterRef,
  type ReadingNotesContentKind,
  type ReadingNotesScope,
} from '@montree/reader-core'
import { saveAnkiCardsExport } from '@/lib/reader/marks/export-anki-cards'
import { saveReadingNotesExport } from '@/lib/reader/marks/save-reading-notes-export'

/**
 * 三阅读器（PDF / Foliate / WebDoc）笔记与 Anki 导出菜单的共享外壳。
 * toc 与当前章的推导各家不同（页码 / CFI / URL），由调用方传入；
 * 落盘（save + 成功提示 + 文件对话框）三家完全一致，收敛于此。
 */
export interface ReaderExportMenuOptions {
  marks: ReadingMark[]
  filePath: string
  getToc: () => ReadingNotesChapterRef[]
  getCurrentChapter: (toc: ReadingNotesChapterRef[]) => ReadingNotesChapterRef | null
  resolveChapter: (mark: ReadingMark, toc: ReadingNotesChapterRef[]) => ReadingNotesChapterRef
}

export interface ReaderExportMenu {
  handleExportNotes: (contentKind: ReadingNotesContentKind, scope: ReadingNotesScope) => void
  handleExportAnkiCards: (scope: ReadingNotesScope) => void
}

export function useReaderExportMenu(options: ReaderExportMenuOptions): ReaderExportMenu {
  const { marks, filePath, getToc, getCurrentChapter, resolveChapter } = options

  const handleExportNotes = useCallback(
    (contentKind: ReadingNotesContentKind, scope: ReadingNotesScope) => {
      const toc = getToc()
      void saveReadingNotesExport({
        marks,
        toc,
        contentKind,
        scope,
        currentChapter: scope === 'chapter' ? getCurrentChapter(toc) : null,
        filePath,
        resolveChapter,
      })
    },
    [marks, filePath, getToc, getCurrentChapter, resolveChapter],
  )

  const handleExportAnkiCards = useCallback(
    (scope: ReadingNotesScope) => {
      const toc = getToc()
      void saveAnkiCardsExport({
        marks,
        toc,
        scope,
        currentChapter: scope === 'chapter' ? getCurrentChapter(toc) : null,
        filePath,
        resolveChapter,
      })
    },
    [marks, filePath, getToc, getCurrentChapter, resolveChapter],
  )

  return { handleExportNotes, handleExportAnkiCards }
}
