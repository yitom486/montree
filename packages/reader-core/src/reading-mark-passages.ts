import type { ReadingAnchor, ReadingMark } from '@montree/contracts'
import { getReadingMarkKindLabel, getReadingMarkLabel } from './reading-mark-labels'
import { normalizeHighlightColor } from './reading-mark-colors'

function summarizeAnchor(anchor: ReadingAnchor): string {
  switch (anchor.format) {
    case 'pdf':
      return `第 ${anchor.page} 页`
    case 'epub':
      return anchor.href ?? anchor.cfi.slice(0, 48)
    case 'mobi':
      return `章节 ${anchor.chapterId}`
    case 'web':
      try {
        const url = new URL(anchor.url)
        return url.pathname.replace(/\/$/, '') || url.hostname
      } catch {
        return anchor.url
      }
  }
}

export function serializeMarkPassage(mark: ReadingMark) {
  return {
    id: mark.id,
    kind: mark.kind,
    kindLabel: getReadingMarkKindLabel(mark.kind),
    label: getReadingMarkLabel(mark),
    excerpt: mark.excerpt ?? mark.anchor.selectedText ?? null,
    note: mark.note ?? null,
    color: mark.kind === 'bookmark' ? null : normalizeHighlightColor(mark.color),
    location: summarizeAnchor(mark.anchor),
    updatedAt: mark.updatedAt,
  }
}

/** 划重点：高亮原文，以及带摘录的批注（批注也是划过的重点） */
export function isHighlightPassage(mark: ReadingMark): boolean {
  if (mark.kind === 'bookmark') return false
  const text = (mark.excerpt ?? mark.anchor.selectedText ?? '').trim()
  if (!text) return false
  return mark.kind === 'highlight' || mark.kind === 'note'
}

export function highlightSortKey(mark: ReadingMark): string {
  switch (mark.anchor.format) {
    case 'pdf':
      return `pdf:${String(mark.anchor.page).padStart(6, '0')}:${mark.createdAt}`
    case 'epub':
      // 同文件（同 href）内的先后靠 cfiRange 区分：只用 href 会让同章卡片退化成创建时间序
      return `epub:${mark.anchor.href ?? ''}:${mark.anchor.cfiRange ?? mark.anchor.cfi}:${mark.createdAt}`
    case 'mobi':
      // foliate 统一后端会写 cfi/cfiRange；老 MOBI 锚点无此字段时退回创建时间序
      return `mobi:${mark.anchor.chapterId}:${mark.anchor.cfiRange ?? mark.anchor.cfi ?? ''}:${mark.createdAt}`
    case 'web':
      return `web:${mark.anchor.url}:${mark.createdAt}`
  }
}

export function collectHighlightPassages(marks: ReadingMark[]) {
  return marks
    .filter(isHighlightPassage)
    .sort((a, b) => highlightSortKey(a).localeCompare(highlightSortKey(b), 'en'))
    .map((mark) => ({
      ...serializeMarkPassage(mark),
      text: (mark.excerpt ?? mark.anchor.selectedText ?? '').trim(),
    }))
}

export function passageExcerpt(mark: ReadingMark): string {
  return (mark.excerpt ?? mark.anchor.selectedText ?? '').trim()
}

export function passageNote(mark: ReadingMark): string {
  return (mark.note ?? '').trim()
}
