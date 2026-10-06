import { describe, expect, it } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import { toCanonicalChapter, tocFromEpubUnits, tocFromPdfUnits } from '@montree/reader-core'
import {
  chapterKeyOfCard,
  chapterOrderFromNavUnits,
  sortCardsByDocumentPosition,
  type CardNavUnit,
} from './card-order-from-units'

/**
 * 悬浮窗卡片流数据通路测试：只给 marks + 导航 units，就能得到与卡片轨一致的文档序。
 * fixture 形状与 FoliateReaderViewer 写入 / reader-navigation-store 的 units 一致。
 */

const units: CardNavUnit[] = [
  { href: 'preface.xhtml', label: '前言', level: 0 },
  { href: 'editor-note.xhtml', label: '原编者的话', level: 0 },
  { href: 'editor-note.xhtml#sec2', label: '编者小节', level: 1 },
  { href: 'book1-ch1.xhtml', label: '论美国的民主1', level: 0 },
]

function epubCard(id: string, href: string, cfiRange: string, createdAt: number): ReadingMark {
  const anchor = { format: 'epub' as const, cfi: cfiRange, cfiRange, href, selectedText: id }
  return {
    id,
    filePath: '/books/fixture.epub',
    fileFingerprint: 'fp',
    kind: 'highlight',
    anchor,
    createdAt,
    updatedAt: createdAt,
    chapter: toCanonicalChapter(anchor, tocFromEpubUnits(units)) ?? undefined,
  }
}

describe('card-order-from-units', () => {
  it('目录键序去重保序，与固化 key 同空间', () => {
    // 'editor-note.xhtml#sec2' 归一化后与 'editor-note.xhtml' 同键，去重
    expect(chapterOrderFromNavUnits(units)).toEqual([
      'preface.xhtml',
      'editor-note.xhtml',
      'book1-ch1.xhtml',
    ])
  })

  it('marks + units 直出文档纵序（创建时间全反+输入乱序）', () => {
    const e1 = epubCard('e1', 'editor-note.xhtml', 'epubcfi(/6/10!/4/2)', 300)
    const e2 = epubCard('e2', 'editor-note.xhtml', 'epubcfi(/6/10!/4/4)', 200)
    const e3 = epubCard('e3', 'editor-note.xhtml', 'epubcfi(/6/10!/4/6)', 100)
    const p1 = epubCard('p1', 'preface.xhtml', 'epubcfi(/6/4!/4/2)', 400)
    const sorted = sortCardsByDocumentPosition([e3, p1, e2, e1], units)
    expect(sorted.map((m) => m.id)).toEqual(['p1', 'e1', 'e2', 'e3'])
  })

  it('无固化章节的老卡回落运行时解析，仍归入同组', () => {
    const legacy: ReadingMark = {
      id: 'legacy',
      filePath: '/books/fixture.epub',
      fileFingerprint: 'fp',
      kind: 'note',
      anchor: { format: 'epub', cfi: 'epubcfi(/6/4!/4/1)', href: 'preface.xhtml' },
      createdAt: 999,
      updatedAt: 999,
    }
    const p1 = epubCard('p1', 'preface.xhtml', 'epubcfi(/6/4!/4/2)', 100)
    const sorted = sortCardsByDocumentPosition([p1, legacy], units)
    expect(sorted.map((m) => m.id)).toEqual(['legacy', 'p1'])
  })

  it('老卡回落 key 与固化 key 同组（chapterKeyOfCard 口径）', () => {
    const toc = tocFromEpubUnits(units)
    const tocs = { epub: toc, pdf: tocFromPdfUnits([]) }
    const solidified = epubCard('s', 'preface.xhtml', 'epubcfi(/6/4!/4/2)', 1)
    const legacy: ReadingMark = {
      ...solidified,
      id: 'legacy',
      chapter: undefined,
    }
    expect(chapterKeyOfCard(legacy, tocs)).toBe(chapterKeyOfCard(solidified, tocs))
  })

  it('无 units 时原序返回副本，不炸', () => {
    const e1 = epubCard('e1', 'editor-note.xhtml', 'epubcfi(/6/10!/4/2)', 1)
    const sorted = sortCardsByDocumentPosition([e1], [])
    expect(sorted.map((m) => m.id)).toEqual(['e1'])
  })
})
