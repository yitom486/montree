import { ReaderUnitOutline } from '@/components/reader/ReaderUnitOutline'
import type { EpubChapter } from '@montree/reader-core'

interface EpubChapterOutlineProps {
  chapters: EpubChapter[]
  currentHref?: string
  collapsed?: boolean
  onToggle: () => void
  onSelectChapter: (chapter: EpubChapter) => void
}

/** @deprecated 请使用 ReaderUnitOutline */
export function EpubChapterOutline({
  chapters,
  currentHref,
  collapsed,
  onToggle,
  onSelectChapter,
}: EpubChapterOutlineProps) {
  return (
    <ReaderUnitOutline
      units={chapters}
      currentUnitId={currentHref}
      collapsed={collapsed}
      onToggle={onToggle}
      onSelectUnit={onSelectChapter}
    />
  )
}
