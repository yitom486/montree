import { describe, expect, it } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import {
  resolveEpubChapter,
  resolveMobiChapter,
  resolvePdfChapter,
  tocFromEpubUnits,
  tocFromMobiUnits,
  tocFromPdfUnits,
  toCanonicalChapter,
  type ReadingNotesChapterRef,
} from '@montree/reader-core'
import { sortMarksByDocumentPosition } from './mark-document-order'

/**
 * 知识卡片统一文档序契约测试（全书 scope：先按章节、再按文中位置，章间有分隔）。
 *
 * 背景：右侧卡片轨（MarginaliaBar）与悬浮窗卡片流（FloatingAIHud）展示同一批卡片
 * 时顺序不一致——用户截图显示两者都退化成创建时间序，与正文纵序对不上。
 * 所有卡片展示入口必须呈现同一文档纵序，本文件用贴近真实写入形状的 fixture
 *（anchor 写法与 FoliateReaderViewer.handleSaveAnnotation / PdfViewer 写入一致，
 * AI 字段为手写 mock，不调用任何 AI）锁定该契约。
 *
 * 约定：创建时间故意与文档序完全相反（文档最靠前的卡片最后创建），
 * 输入数组再做一次乱序——只有真正按"章节 + 文中位置"排，测试才能通过。
 */

type ResolveChapter = (
  mark: ReadingMark,
  toc: ReadingNotesChapterRef[],
) => ReadingNotesChapterRef

interface BookWire {
  chapterOrder: string[]
  chapterKeyOf: (m: ReadingMark) => string | null
  chapterLabelOf: (m: ReadingMark) => string | null
}

/**
 * 接线复刻：
 * - chapterOrder：目录键序。契约要求它与 chapterKeyOf 返回值同 key 空间
 *  （固化 key 恒为 matchKey 形态，见 toCanonicalChapter 注释），故此处取
 *  toc.map(matchKey)。注意：生产现状 ReaderContentShell:118 取的是 toc.key
 * （带 index 前缀，如 `1:editor-note.xhtml`），与固化 key 恒不等——这是接线层
 *  的另一个待修问题（代码阶段修），本文件先按契约正确的键空间锁定排序行为。
 * - chapterKeyOf：固化优先、缺失回落运行时解析
 *  （MarginaliaBar:73 + ReaderContentShell:349 传给 MarginaliaBar 的 chapterOfMark）
 */
function wireBook(toc: ReadingNotesChapterRef[], resolveChapter: ResolveChapter): BookWire {
  const chapterOrder = toc.map((t) => t.matchKey)
  const chapterOf = (m: ReadingMark): { key: string; label: string } | null => {
    try {
      if (m.chapter) return { key: m.chapter.key, label: m.chapter.label }
      const ref = resolveChapter(m, toc)
      return { key: ref.matchKey, label: ref.label }
    } catch {
      return null
    }
  }
  return {
    chapterOrder,
    chapterKeyOf: (m) => chapterOf(m)?.key ?? null,
    chapterLabelOf: (m) => chapterOf(m)?.label ?? null,
  }
}

/** 章节连续段：同章卡片必须连成一组（MarginaliaBar 章首分隔线的前提）。 */
function chapterRuns(sorted: ReadingMark[], wire: BookWire): Array<{ key: string; ids: string[] }> {
  const runs: Array<{ key: string; ids: string[] }> = []
  for (const m of sorted) {
    const key = wire.chapterKeyOf(m) ?? '∅'
    const last = runs[runs.length - 1]
    if (last && last.key === key) last.ids.push(m.id)
    else runs.push({ key, ids: [m.id] })
  }
  return runs
}

let seq = 0
function baseMark(overrides: Partial<ReadingMark> & Pick<ReadingMark, 'id' | 'anchor'>): ReadingMark {
  seq += 1
  return {
    filePath: '/books/fixture.epub',
    fileFingerprint: 'fp-fixture',
    kind: 'highlight',
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
    ...overrides,
  }
}

describe('EPUB 整书（仿《论美国的民主》三章结构）：全书先章节后位置', () => {
  const toc = tocFromEpubUnits([
    { href: 'preface.xhtml', label: '前言' },
    { href: 'editor-note.xhtml', label: '原编者的话' },
    { href: 'book1-ch1.xhtml', label: '论美国的民主1' },
  ])
  const wire = wireBook(toc, resolveEpubChapter)

  // 写入形状与 FoliateReaderViewer.handleSaveAnnotation 完全一致：
  // { format, cfi: cfiRange, cfiRange, href: sectionId, selectedText } + 固化 chapter
  const epubCard = (
    id: string,
    href: string,
    cfiRange: string,
    createdAt: number,
    ai: Partial<ReadingMark>,
  ): ReadingMark => {
    const anchor = {
      format: 'epub' as const,
      cfi: cfiRange,
      cfiRange,
      href,
      selectedText: ai.excerpt,
    }
    return baseMark({
      id,
      anchor,
      createdAt,
      updatedAt: createdAt,
      chapter: toCanonicalChapter(anchor, toc) ?? undefined,
      ...ai,
    })
  }

  // 文档纵序：P0 → P1 → E1 → E2 → E3 → B1 → B2；创建时间故意全反
  const P0 = epubCard('epub-preface-legacy', 'preface.xhtml', 'epubcfi(/6/4!/4/1)', 700, {
    kind: 'note',
    category: 'concept',
    title: '成书背景',
    excerpt: '本书两部分先后于 1835 年和 1840 年出版。',
    note: '概念要义（mock）：成书分两阶段， causious 先行。',
    aiSummary: 'AI 研读洞见（mock）：出版史是理解结构的第一把钥匙。',
  })
  // 老数据：无固化 chapter，走运行时解析回落（与固化卡同组才算对）
  delete (P0 as Partial<ReadingMark>).chapter
  const P1 = epubCard('epub-preface-1', 'preface.xhtml', 'epubcfi(/6/4!/4/2)', 600, {
    category: 'quote',
    title: '译者的话',
    excerpt: '托克维尔的洞察力是本书最显著的特点。',
    note: '概念要义（mock）：洞察力即对反应的预判。',
    aiSummary: 'AI 研读洞见（mock）：预判读者反应是一种写作自觉。',
  })
  const E1 = epubCard('epub-note-1', 'editor-note.xhtml', 'epubcfi(/6/10!/4/2)', 500, {
    category: 'quote',
    title: '关于我所看到的一切',
    excerpt: '关于我所看到的一切，我谈论了很多也想到了很多。',
    note: '概念要义（mock）：实地考察先于理论判断。',
    aiSummary: 'AI 研读洞见（mock）：田野是本书方法论的起点。',
    color: '#a78bfa',
  })
  const E2 = epubCard('epub-note-2', 'editor-note.xhtml', 'epubcfi(/6/10!/4/4)', 400, {
    category: 'concept',
    title: '《论美国的民主》的时事性',
    excerpt: '关于《论美国的民主》，它的时事性是经常被讨论的问题。',
    note: '概念要义（mock）：时事性即经典仍被理解和研究。',
    aiSummary: 'AI 研读洞见（mock）：时事性是经典性的另一种说法。',
    color: '#facc15',
  })
  const E3 = epubCard('epub-note-3', 'editor-note.xhtml', 'epubcfi(/6/10!/4/6)', 300, {
    category: 'concept',
    title: '托克维尔的预判',
    excerpt: '鉴于洞察力是托克维尔的一个特点，他设想了人们的反应。',
    note: '概念要义（mock）：有人会认为他不喜欢民主。',
    aiSummary: 'AI 研读洞见（mock）：预判批评本身就是论证的一环。',
  })
  const B1 = epubCard('epub-book1-1', 'book1-ch1.xhtml', 'epubcfi(/6/12!/4/2)', 200, {
    category: 'method',
    title: '比较的方法',
    excerpt: '他将美国与法国对比，内容远比在法国所学多得多。',
    note: '概念要义（mock）：比较视野带来增量知识。',
    aiSummary: 'AI 研读洞见（mock）：比较是本书的核心方法。',
  })
  const B2 = epubCard('epub-book1-2', 'book1-ch1.xhtml', 'epubcfi(/6/12!/4/4)', 100, {
    category: 'concept',
    title: '多数人的暴政',
    excerpt: '多数人的意见可能形成新的暴政形式。',
    note: '概念要义（mock）：民主的病理学面向。',
    aiSummary: 'AI 研读洞见（mock）：警惕多数即本书的暗线。',
  })

  // 入库/同步乱序到达（悬浮窗卡片流当前就按这个裸顺序渲染）
  const arrivalOrder = [E2, B2, P0, E1, B1, P1, E3]
  const docOrder = ['epub-preface-legacy', 'epub-preface-1', 'epub-note-1', 'epub-note-2', 'epub-note-3', 'epub-book1-1', 'epub-book1-2']

  it('全书：纵序与正文一致，不受创建/到达顺序影响', () => {
    const sorted = sortMarksByDocumentPosition(arrivalOrder, wire.chapterOrder, wire.chapterKeyOf)
    expect(sorted.map((m) => m.id)).toEqual(docOrder)
  })

  it('全书：同章卡片连成组，章间分隔点与标签正确', () => {
    const sorted = sortMarksByDocumentPosition(arrivalOrder, wire.chapterOrder, wire.chapterKeyOf)
    expect(chapterRuns(sorted, wire).map((r) => r.ids)).toEqual([
      ['epub-preface-legacy', 'epub-preface-1'],
      ['epub-note-1', 'epub-note-2', 'epub-note-3'],
      ['epub-book1-1', 'epub-book1-2'],
    ])
    // 分隔线位置 = 每组首卡（MarginaliaBar showChapterDivider 规则的前提）
    const dividerAt = [0, 2, 5]
    expect(dividerAt.map((i) => wire.chapterLabelOf(sorted[i]!))).toEqual([
      '前言',
      '原编者的话',
      '论美国的民主1',
    ])
  })

  it('本章 scope（原编者的话）：章内按文中位置', () => {
    const currentKey = wire.chapterKeyOf(E1)
    const inChapter = arrivalOrder.filter((m) => wire.chapterKeyOf(m) === currentKey)
    const sorted = sortMarksByDocumentPosition(inChapter, wire.chapterOrder, wire.chapterKeyOf)
    expect(sorted.map((m) => m.id)).toEqual(['epub-note-1', 'epub-note-2', 'epub-note-3'])
  })
})

describe('PDF 整书：先章节（页码大纲）后页码', () => {
  const toc = tocFromPdfUnits([
    { href: '1', label: '封面' },
    { href: '5', label: '第一章' },
    { href: '20', label: '第二章' },
  ])
  const wire = wireBook(toc, resolvePdfChapter)

  // 写入形状与 PdfViewer 写入一致：{ format: 'pdf', page } + 固化 chapter
  const pdfCard = (id: string, page: number, createdAt: number, excerpt: string): ReadingMark => {
    const anchor = { format: 'pdf' as const, page }
    return baseMark({
      id,
      filePath: '/books/fixture.pdf',
      anchor,
      excerpt,
      createdAt,
      updatedAt: createdAt,
      chapter: toCanonicalChapter(anchor, toc) ?? undefined,
    })
  }

  const cover = pdfCard('pdf-cover', 2, 400, '封面题字。')
  const ch1a = pdfCard('pdf-ch1-a', 6, 300, '第一章开头。')
  const ch1b = pdfCard('pdf-ch1-b', 7, 200, '第一章中段。')
  const ch2a = pdfCard('pdf-ch2-a', 21, 100, '第二章开头。')

  it('全书：封面 → 第一章（页内正序）→ 第二章', () => {
    const arrivalOrder = [ch1b, cover, ch2a, ch1a]
    const sorted = sortMarksByDocumentPosition(arrivalOrder, wire.chapterOrder, wire.chapterKeyOf)
    expect(sorted.map((m) => m.id)).toEqual(['pdf-cover', 'pdf-ch1-a', 'pdf-ch1-b', 'pdf-ch2-a'])
    expect(chapterRuns(sorted, wire).map((r) => r.ids)).toEqual([
      ['pdf-cover'],
      ['pdf-ch1-a', 'pdf-ch1-b'],
      ['pdf-ch2-a'],
    ])
  })
})

describe('MOBI 整书：先章节后 cfi 位置', () => {
  const toc = tocFromMobiUnits([
    { id: 'mobi-ch1', label: '前言' },
    { id: 'mobi-ch2', label: '正文' },
  ])
  const wire = wireBook(toc, resolveMobiChapter)

  // 写入形状与 FoliateReaderViewer mobi 分支一致：chapterId + cfi/cfiRange + 固化
  const mobiCard = (id: string, chapterId: string, cfiRange: string, createdAt: number): ReadingMark => {
    const anchor = { format: 'mobi' as const, chapterId, cfi: cfiRange, cfiRange }
    return baseMark({
      id,
      filePath: '/books/fixture.mobi',
      anchor,
      excerpt: `摘录 ${id}`,
      createdAt,
      updatedAt: createdAt,
      chapter: toCanonicalChapter(anchor, toc) ?? undefined,
    })
  }

  const pre = mobiCard('mobi-preface', 'mobi-ch1', 'epubcfi(/6/4!/4/2)', 300)
  const a = mobiCard('mobi-body-a', 'mobi-ch2', 'epubcfi(/6/6!/4/2)', 200)
  const b = mobiCard('mobi-body-b', 'mobi-ch2', 'epubcfi(/6/6!/4/4)', 100)

  it('全书：前言 → 正文（章内按 cfi，不按创建时间）', () => {
    const arrivalOrder = [b, pre, a]
    const sorted = sortMarksByDocumentPosition(arrivalOrder, wire.chapterOrder, wire.chapterKeyOf)
    expect(sorted.map((m) => m.id)).toEqual(['mobi-preface', 'mobi-body-a', 'mobi-body-b'])
  })
})
