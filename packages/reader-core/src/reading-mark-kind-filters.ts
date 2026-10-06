import type { ReadingMark } from '@montree/contracts'

export interface ReadingMarkKindFilters {
  highlights: boolean
  notes: boolean
  bookmarks: boolean
}

export const DEFAULT_READING_MARK_KIND_FILTERS: ReadingMarkKindFilters = {
  highlights: true,
  notes: true,
  bookmarks: true,
}

/** 重点+批注：重点或批注任一开启即显示 */
export function markMatchesKindFilters(
  mark: ReadingMark,
  filters: ReadingMarkKindFilters,
): boolean {
  if (mark.kind === 'bookmark') return filters.bookmarks
  if (mark.kind === 'note') return filters.notes
  if (mark.kind === 'highlight') {
    if (mark.note?.trim()) return filters.highlights || filters.notes
    return filters.highlights
  }
  return false
}
