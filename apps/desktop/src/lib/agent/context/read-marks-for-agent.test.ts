import { describe, expect, it, vi } from 'vitest'
import type { ReadingMark } from '@yitom/contracts'
import { collectHighlightPassages, isHighlightPassage, listMarksForAgent } from './read-marks-for-agent'
import { registerReaderMarks } from './reader-marks-registry'

const mocks = vi.hoisted(() => ({ activeDocument: vi.fn(), list: vi.fn() }))
vi.mock('./collect-turn-context', () => ({ collectActiveDocument: mocks.activeDocument }))
vi.mock('@/api/reading-marks-api', () => ({ readingMarksApi: { list: mocks.list } }))

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
  it('Markdown 卡片查询要求当前路径已注册标记 provider，避免读取另一个文档', async () => {
    mocks.activeDocument.mockReturnValue({ path: '/notes.md', kind: 'markdown', name: 'notes.md' })
    mocks.list.mockResolvedValue({ ok: true, value: [mark({ id: 'md', filePath: '/notes.md', kind: 'note', excerpt: 'Markdown 摘录', note: '批注', anchor: { format: 'web', url: 'montree-markdown:///document?path=%2Fnotes.md' } })] })
    const dispose = registerReaderMarks({ filePath: '/notes.md', createBookmark: vi.fn(), createNoteFromSelection: vi.fn(), createMarkAt: vi.fn() })
    try {
      const result = await listMarksForAgent()
      expect(result).toMatchObject({ documentPath: '/notes.md', count: 1, marks: [{ id: 'md', note: '批注' }] })
      mocks.activeDocument.mockReturnValue({ path: '/other.md', kind: 'markdown', name: 'other.md' })
      await expect(listMarksForAgent()).rejects.toThrow('卡片模块尚未就绪')
      expect(mocks.list).toHaveBeenCalledTimes(1)
    } finally { dispose() }
  })

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
