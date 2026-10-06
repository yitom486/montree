import { describe, expect, it } from 'vitest'
import { sortMarksByDocumentPosition } from './mark-document-order'
import type { ReadingMark } from '@montree/contracts'

function mark(id: string, chapterId: string | null): ReadingMark {
  return {
    id,
    filePath: '/book.epub',
    fileFingerprint: 'fp',
    kind: 'note',
    anchor:
      chapterId === null
        ? { format: 'epub', cfi: 'epubcfi(/6/2)' }
        : { format: 'mobi', chapterId },
    createdAt: 1,
    updatedAt: 1,
  } as ReadingMark
}

const keyOf = (chapterIdByMark: Record<string, string | null>) => (m: ReadingMark) =>
  chapterIdByMark[m.id] ?? null

describe('sortMarksByDocumentPosition', () => {
  it('orders by toc chapter order, keeps in-chapter order, sinks unknown', () => {
    const marks = [mark('c', 'ch2'), mark('a', 'ch1'), mark('b', 'ch1'), mark('z', null)]
    const sorted = sortMarksByDocumentPosition(
      marks,
      ['ch1', 'ch2'],
      keyOf({ c: 'ch2', a: 'ch1', b: 'ch1', z: null }),
    )
    expect(sorted.map((m) => m.id)).toEqual(['a', 'b', 'c', 'z'])
  })

  it('同章内按文档位置（PDF 页码），不再按创建时间', () => {
    const pdf = (id: string, page: number, createdAt: number): ReadingMark => ({
      id,
      filePath: '/book.pdf',
      fileFingerprint: 'fp',
      kind: 'highlight',
      anchor: { format: 'pdf', page },
      createdAt,
      updatedAt: createdAt,
    }) as ReadingMark
    // 输入是创建时间倒序，输出应按页码正序
    const marks = [pdf('p10', 10, 3), pdf('p2', 2, 2), pdf('p1', 1, 1)]
    const sorted = sortMarksByDocumentPosition(marks, ['ch'], () => 'ch')
    expect(sorted.map((m) => m.id)).toEqual(['p1', 'p2', 'p10'])
  })

  it('同章同位按创建时间，同分保输入序', () => {
    const pdf = (id: string, createdAt: number): ReadingMark => ({
      id,
      filePath: '/book.pdf',
      fileFingerprint: 'fp',
      kind: 'highlight',
      anchor: { format: 'pdf', page: 5 },
      createdAt,
      updatedAt: createdAt,
    }) as ReadingMark
    const marks = [pdf('newer', 2), pdf('older', 1)]
    const sorted = sortMarksByDocumentPosition(marks, ['ch'], () => 'ch')
    expect(sorted.map((m) => m.id)).toEqual(['older', 'newer'])
  })

  it('EPUB 同章按 href/cfi 位置键排序', () => {
    const epub = (id: string, href: string, createdAt: number): ReadingMark => ({
      id,
      filePath: '/book.epub',
      fileFingerprint: 'fp',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'epubcfi(/6/2)', href },
      createdAt,
      updatedAt: createdAt,
    }) as ReadingMark
    // 输入创建时间倒序，输出应按 href 字典序
    const marks = [epub('later', 'ch1-b.xhtml', 2), epub('earlier', 'ch1-a.xhtml', 1)]
    const sorted = sortMarksByDocumentPosition(marks, ['ch1'], () => 'ch1')
    expect(sorted.map((m) => m.id)).toEqual(['earlier', 'later'])
  })

  it('EPUB 同文件按 cfi 先后排序，不再退化成创建时间', () => {
    const epub = (id: string, cfiRange: string, createdAt: number): ReadingMark => ({
      id,
      filePath: '/book.epub',
      fileFingerprint: 'fp',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: cfiRange, cfiRange, href: 'same-chapter.xhtml' },
      createdAt,
      updatedAt: createdAt,
    }) as ReadingMark
    // 输入是创建时间倒序：后创建的在文档更靠前，输出应按 cfi 位置正序
    const marks = [
      epub('doc-second', 'epubcfi(/6/14!/4/4)', 2),
      epub('doc-first', 'epubcfi(/6/14!/4/2)', 1),
      epub('doc-third', 'epubcfi(/6/14!/4/6)', 3),
    ]
    const sorted = sortMarksByDocumentPosition(marks, ['ch1'], () => 'ch1')
    expect(sorted.map((m) => m.id)).toEqual(['doc-first', 'doc-second', 'doc-third'])
  })

  it('MOBI 同章按 cfi 先后排序', () => {
    const mobi = (id: string, cfiRange: string, createdAt: number): ReadingMark => ({
      id,
      filePath: '/book.mobi',
      fileFingerprint: 'fp',
      kind: 'highlight',
      anchor: { format: 'mobi', chapterId: 'ch1', cfi: cfiRange, cfiRange },
      createdAt,
      updatedAt: createdAt,
    }) as ReadingMark
    const marks = [mobi('newer', 'epubcfi(/6/14!/4/4)', 2), mobi('older', 'epubcfi(/6/14!/4/2)', 1)]
    const sorted = sortMarksByDocumentPosition(marks, ['ch1'], () => 'ch1')
    expect(sorted.map((m) => m.id)).toEqual(['older', 'newer'])
  })

  it('MOBI 同章无细粒度位置，按创建时间排序', () => {
    const mobi = (id: string, createdAt: number): ReadingMark => ({
      id,
      filePath: '/book.mobi',
      fileFingerprint: 'fp',
      kind: 'highlight',
      anchor: { format: 'mobi', chapterId: 'ch1' },
      createdAt,
      updatedAt: createdAt,
    }) as ReadingMark
    const marks = [mobi('newer', 2), mobi('older', 1)]
    const sorted = sortMarksByDocumentPosition(marks, ['ch1'], () => 'ch1')
    expect(sorted.map((m) => m.id)).toEqual(['older', 'newer'])
  })

  it('未知章节键与无归属一同沉底', () => {
    const marks = [mark('unknown', 'chX'), mark('a', 'ch1'), mark('z', null)]
    const sorted = sortMarksByDocumentPosition(
      marks,
      ['ch1', 'ch2'],
      keyOf({ unknown: 'chX', a: 'ch1', z: null }),
    )
    expect(sorted.map((m) => m.id)[0]).toBe('a')
    expect(sorted.map((m) => m.id).slice(1).sort()).toEqual(['unknown', 'z'])
  })

  it('章优先于位置键：前章大页仍排前', () => {
    const pdf = (id: string, page: number): ReadingMark => ({
      id,
      filePath: '/book.pdf',
      fileFingerprint: 'fp',
      kind: 'highlight',
      anchor: { format: 'pdf', page },
      createdAt: 1,
      updatedAt: 1,
    }) as ReadingMark
    const marks = [pdf('ch2-p1', 1), pdf('ch1-p100', 100)]
    const sorted = sortMarksByDocumentPosition(
      marks,
      ['ch1', 'ch2'],
      keyOf({ 'ch2-p1': 'ch2', 'ch1-p100': 'ch1' }),
    )
    expect(sorted.map((m) => m.id)).toEqual(['ch1-p100', 'ch2-p1'])
  })

  it('全同键保输入序且不改原数组', () => {
    const pdf = (id: string): ReadingMark => ({
      id,
      filePath: '/book.pdf',
      fileFingerprint: 'fp',
      kind: 'highlight',
      anchor: { format: 'pdf', page: 5 },
      createdAt: 1,
      updatedAt: 1,
    }) as ReadingMark
    const marks = [pdf('first'), pdf('second'), pdf('third')]
    const snapshot = [...marks]
    const sorted = sortMarksByDocumentPosition(marks, ['ch'], () => 'ch')
    expect(sorted.map((m) => m.id)).toEqual(['first', 'second', 'third'])
    expect(marks).toEqual(snapshot)
  })

  it('returns copy in original order when no toc order', () => {
    const marks = [mark('b', 'ch2'), mark('a', 'ch1')]
    const sorted = sortMarksByDocumentPosition(marks, [], keyOf({}))
    expect(sorted.map((m) => m.id)).toEqual(['b', 'a'])
    expect(sorted).not.toBe(marks)
  })

  it('tolerates throwing resolvers', () => {
    const marks = [mark('a', 'ch1')]
    const sorted = sortMarksByDocumentPosition(marks, ['ch1'], () => {
      throw new Error('boom')
    })
    expect(sorted.map((m) => m.id)).toEqual(['a'])
  })
})
