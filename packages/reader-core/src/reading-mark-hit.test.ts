import { describe, expect, it } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import {
  findMarkForSelection,
  isClickNotDrag,
  rankVisualMarks,
} from '@montree/reader-core'

function mark(overrides: Partial<ReadingMark> & Pick<ReadingMark, 'id' | 'kind' | 'anchor'>): ReadingMark {
  return {
    filePath: '/book.epub',
    fileFingerprint: 'fp',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('rankVisualMarks', () => {
  it('重叠时优先批注，其次最近更新', () => {
    const highlight = mark({
      id: 'h',
      kind: 'highlight',
      updatedAt: 9,
      anchor: { format: 'epub', cfi: 'a' },
    })
    const note = mark({
      id: 'n',
      kind: 'note',
      updatedAt: 2,
      anchor: { format: 'epub', cfi: 'a' },
    })
    expect(rankVisualMarks([highlight, note]).map((item) => item.id)).toEqual(['n', 'h'])
  })
})

describe('isClickNotDrag', () => {
  it('移动超过阈值视为拖拽', () => {
    expect(isClickNotDrag({ x: 10, y: 10 }, { clientX: 12, clientY: 11 })).toBe(true)
    expect(isClickNotDrag({ x: 10, y: 10 }, { clientX: 40, clientY: 10 })).toBe(false)
    expect(isClickNotDrag(null, { clientX: 10, clientY: 10 })).toBe(false)
  })
})

describe('findMarkForSelection', () => {
  it('按相同摘录复用已有高亮，避免与批注叠两层', () => {
    const existing = mark({
      id: 'h1',
      kind: 'highlight',
      excerpt: '东坡',
      anchor: { format: 'epub', cfi: 'cfi', cfiRange: 'range', selectedText: '东坡' },
    })
    expect(
      findMarkForSelection([existing], {
        format: 'epub',
        text: '东坡',
        cfiRange: 'range',
      })?.id,
    ).toBe('h1')
  })
})
