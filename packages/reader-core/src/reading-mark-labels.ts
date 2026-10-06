import type { ReadingMark } from '@montree/contracts'

export function getReadingMarkLabel(mark: ReadingMark): string {
  if (mark.label?.trim()) return mark.label.trim()
  if (mark.excerpt?.trim()) {
    const text = mark.excerpt.trim()
    return text.length > 48 ? `${text.slice(0, 48)}…` : text
  }
  if (mark.kind === 'bookmark') return '书签'
  if (mark.kind === 'note') return '批注'
  return '重点'
}

export function getReadingMarkKindLabel(kind: ReadingMark['kind']): string {
  switch (kind) {
    case 'bookmark':
      return '书签'
    case 'highlight':
      return '重点'
    case 'note':
      return '批注'
  }
}

/** 列表状态文案：重点 / 重点 + 批注 / 批注 / 书签 */
export function getReadingMarkStatusLabel(mark: ReadingMark): string {
  if (mark.kind === 'bookmark') return '书签'
  if (mark.kind === 'highlight') {
    return mark.note?.trim() ? '重点 + 批注' : '重点'
  }
  if (mark.kind === 'note') return '批注'
  return getReadingMarkKindLabel(mark.kind)
}

/** 在已有标记上写入批注时：重点保持重点，其余走批注 */
export function kindAfterAttachingNote(existingKind: ReadingMark['kind']): ReadingMark['kind'] {
  if (existingKind === 'highlight') return 'highlight'
  if (existingKind === 'bookmark') return 'note'
  return 'note'
}

/** 列表图标跟存储 kind 一致 */
export function getReadingMarkDisplayKind(mark: ReadingMark): ReadingMark['kind'] {
  return mark.kind
}

export function isReadingMarkForChapter(
  mark: ReadingMark,
  chapterId: string,
): boolean {
  return mark.anchor.format === 'mobi' && String(mark.anchor.chapterId) === String(chapterId)
}

export function filterVisualReadingMarks(
  marks: ReadingMark[],
  chapterId: string,
): ReadingMark[] {
  return marks.filter((mark) => {
    if (!isReadingMarkForChapter(mark, chapterId)) return false
    if (mark.kind === 'bookmark') return false
    if (mark.anchor.format !== 'mobi') return false
    const text = (mark.excerpt ?? mark.anchor.selectedText ?? '').trim()
    return Boolean(text || mark.anchor.rects?.length)
  })
}
