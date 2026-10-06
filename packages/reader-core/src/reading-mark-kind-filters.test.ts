import { describe, expect, it } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import { markMatchesKindFilters } from '@montree/reader-core'

function mark(
  overrides: Partial<ReadingMark> & Pick<ReadingMark, 'id' | 'kind' | 'anchor'>,
): ReadingMark {
  return {
    filePath: '/b.epub',
    fileFingerprint: 'fp',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const epub = { format: 'epub' as const, cfi: 'c' }

describe('markMatchesKindFilters', () => {
  const highlight = mark({ id: 'h', kind: 'highlight', excerpt: 'a', anchor: epub })
  const highlightNote = mark({
    id: 'hn',
    kind: 'highlight',
    excerpt: 'a',
    note: '批',
    anchor: epub,
  })
  const note = mark({ id: 'n', kind: 'note', excerpt: 'a', note: '批', anchor: epub })
  const bookmark = mark({ id: 'b', kind: 'bookmark', anchor: epub })

  it('默认全选时全部可见', () => {
    const all = { highlights: true, notes: true, bookmarks: true }
    expect([highlight, highlightNote, note, bookmark].every((item) => markMatchesKindFilters(item, all))).toBe(
      true,
    )
  })

  it('只开重点：纯重点可见，纯批注与书签不可见，重点+批注可见', () => {
    const filters = { highlights: true, notes: false, bookmarks: false }
    expect(markMatchesKindFilters(highlight, filters)).toBe(true)
    expect(markMatchesKindFilters(highlightNote, filters)).toBe(true)
    expect(markMatchesKindFilters(note, filters)).toBe(false)
    expect(markMatchesKindFilters(bookmark, filters)).toBe(false)
  })

  it('只开批注：纯批注与重点+批注可见', () => {
    const filters = { highlights: false, notes: true, bookmarks: false }
    expect(markMatchesKindFilters(highlight, filters)).toBe(false)
    expect(markMatchesKindFilters(highlightNote, filters)).toBe(true)
    expect(markMatchesKindFilters(note, filters)).toBe(true)
    expect(markMatchesKindFilters(bookmark, filters)).toBe(false)
  })
})
