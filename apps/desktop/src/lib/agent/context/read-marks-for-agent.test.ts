import { describe, expect, it } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import { collectHighlightPassages, isHighlightPassage } from './read-marks-for-agent'

function mark(overrides: Partial<ReadingMark> & Pick<ReadingMark, 'id' | 'kind' | 'anchor'>): ReadingMark {
  return {
    filePath: '/book.pdf',
    fileFingerprint: 'fp',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('collectHighlightPassages', () => {
  it('排除书签与无摘录标记，按页码排序', () => {
    const bookmark = mark({
      id: 'b',
      kind: 'bookmark',
      label: '第三章',
      anchor: { format: 'pdf', page: 3 },
    })
    const emptyHighlight = mark({
      id: 'empty',
      kind: 'highlight',
      anchor: { format: 'pdf', page: 1 },
    })
    const later = mark({
      id: 'h2',
      kind: 'highlight',
      excerpt: '后页句子',
      color: 'green',
      createdAt: 20,
      anchor: { format: 'pdf', page: 10 },
    })
    const earlier = mark({
      id: 'h1',
      kind: 'highlight',
      excerpt: '前页句子',
      color: 'yellow',
      createdAt: 10,
      anchor: { format: 'pdf', page: 2 },
    })
    const note = mark({
      id: 'n',
      kind: 'note',
      excerpt: '带批注的重点',
      note: '同意',
      color: 'pink',
      createdAt: 15,
      anchor: { format: 'pdf', page: 2, selectedText: '带批注的重点' },
    })

    expect(isHighlightPassage(bookmark)).toBe(false)
    expect(isHighlightPassage(emptyHighlight)).toBe(false)

    const collected = collectHighlightPassages([bookmark, emptyHighlight, later, earlier, note])
    expect(collected.map((item) => item.id)).toEqual(['h1', 'n', 'h2'])
    expect(collected[0]).toMatchObject({
      text: '前页句子',
      color: 'yellow',
      location: '第 2 页',
    })
    expect(collected[1]).toMatchObject({
      kind: 'note',
      text: '带批注的重点',
      note: '同意',
    })
  })

  it('无 excerpt 时回退到 selectedText', () => {
    const collected = collectHighlightPassages([
      mark({
        id: 'sel',
        kind: 'highlight',
        anchor: { format: 'epub', cfi: 'epubcfi(/6/4)', selectedText: '  选区原文  ' },
      }),
    ])
    expect(collected[0]?.text).toBe('选区原文')
  })
})
