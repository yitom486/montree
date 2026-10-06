import { describe, expect, it } from 'vitest'
import type { ReadingMark } from '@montree/contracts'
import {
  buildAnkiCardsExport,
  buildAnkiExportFileName,
  formatFlashcardForAnkiHtml,
  sanitizeAnkiTag,
} from './export-anki-cards'
import {
  findCurrentChapterRef,
  tocFromEpubUnits,
  resolveEpubChapter,
} from '@montree/reader-core'

function createMark(overrides: Partial<ReadingMark> & Pick<ReadingMark, 'id' | 'kind' | 'anchor'>): ReadingMark {
  return {
    filePath: '/books/Vue-Design.epub',
    fileFingerprint: 'fp',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('export-anki-cards', () => {
  const toc = tocFromEpubUnits([
    { href: 'chap1.xhtml', label: '第1章 框架设计概览' },
    { href: 'chap2.xhtml', label: '第2章 响应系统' },
  ])

  describe('sanitizeAnkiTag', () => {
    it('removes spaces, colons and illegal chars', () => {
      expect(sanitizeAnkiTag('Vue.js 设计与实现：深入')).toBe('Vue.js_设计与实现_深入')
      expect(sanitizeAnkiTag('  tag:123  ')).toBe('tag_123')
    })
  })

  describe('buildAnkiCardsExport', () => {
    const marks: ReadingMark[] = [
      createMark({
        id: 'mark-note',
        kind: 'note',
        note: '什么是响应式系统的核心？',
        excerpt: '响应式系统的核心就是拦截对象属性的读写。',
        anchor: { format: 'epub', cfi: 'cfi-1', href: 'chap2.xhtml' },
      }),
      createMark({
        id: 'mark-hl',
        kind: 'highlight',
        excerpt: '虚拟 DOM 的本质是用 JS 对象来描述真实的 DOM 结构。',
        anchor: { format: 'epub', cfi: 'cfi-2', href: 'chap1.xhtml' },
      }),
      createMark({
        id: 'mark-bm',
        kind: 'bookmark',
        anchor: { format: 'epub', cfi: 'cfi-3', href: 'chap1.xhtml' },
      }),
    ]

    it('generates basic card for mark with note, and cloze card for pure highlight', () => {
      const res = buildAnkiCardsExport({
        marks,
        toc,
        scope: 'book',
        bookTitle: 'Vue.js设计与实现',
        resolveChapter: resolveEpubChapter,
        now: new Date(2026, 8, 3, 14, 0),
      })

      expect(res).not.toBeNull()
      expect(res?.cardCount).toBe(2) // bookmark excluded

      const [clozeCard, basicCard] = res!.cards
      // Sort key order: chap1 comes before chap2
      expect(clozeCard?.kind).toBe('cloze')
      expect(clozeCard?.front).toBe('{{c1::虚拟 DOM 的本质是用 JS 对象来描述真实的 DOM 结构。}}')
      expect(clozeCard?.front).not.toContain('<')
      expect(clozeCard?.back).toBe('')

      expect(basicCard?.kind).toBe('basic')
      expect(basicCard?.front).toBe('什么是响应式系统的核心？')
      expect(basicCard?.back).toBe('响应式系统的核心就是拦截对象属性的读写。')
      expect(basicCard?.front).not.toContain('<div')
      expect(basicCard?.back).not.toContain('<blockquote')

      // Anki TSV 才含 HTML
      expect(res?.content).toContain('#separator:tab')
      expect(res?.content).toContain('#html:true')
      expect(res?.content).toContain('#tags column:3')
      expect(res?.content).toContain('<div style="font-size:15px;font-weight:600;">什么是响应式系统的核心？</div>')
      expect(res?.content).toContain('<blockquote>响应式系统的核心就是拦截对象属性的读写。</blockquote>')
      expect(res?.content).toContain('[📖 原书]')
      expect(res?.content.split('\n')).toHaveLength(5) // header(3) + 2 cards
    })

    it('filters by current chapter when scope is chapter', () => {
      // 与复习菜单一致：currentChapter 来自 matchKey 定位（findCurrentChapterRef）
      const currentChapter = findCurrentChapterRef(toc, 'chap1.xhtml')
      expect(currentChapter).not.toBeNull()
      const res = buildAnkiCardsExport({
        marks,
        toc,
        scope: 'chapter',
        currentChapter,
        bookTitle: 'Vue.js设计与实现',
        resolveChapter: resolveEpubChapter,
      })

      expect(res).not.toBeNull()
      expect(res?.cardCount).toBe(1)
      expect(res?.cards[0]?.id).toBe('mark-hl')
    })

    it('returns null for chapter scope when current chapter cannot be resolved', () => {
      const res = buildAnkiCardsExport({
        marks,
        toc,
        scope: 'chapter',
        currentChapter: null,
        bookTitle: 'Vue.js设计与实现',
        resolveChapter: resolveEpubChapter,
      })
      expect(res).toBeNull()
    })

    it('returns null when no eligible marks in scope', () => {
      const res = buildAnkiCardsExport({
        marks: [
          createMark({
            id: 'bm-only',
            kind: 'bookmark',
            anchor: { format: 'epub', cfi: 'cfi-9', href: 'chap1.xhtml' },
          }),
        ],
        toc,
        scope: 'book',
        bookTitle: 'Vue',
        resolveChapter: resolveEpubChapter,
      })

      expect(res).toBeNull()
    })
  })

  describe('formatFlashcardForAnkiHtml', () => {
    it('wraps plain basic fields with Anki HTML and deep link', () => {
      const html = formatFlashcardForAnkiHtml({
        id: '1',
        kind: 'basic',
        front: '问题 <重点>',
        back: '答案 & 原文',
        tags: ['Montree'],
        sourceTitle: '书名',
        chapterName: '第一章',
        deepLinkUrl: 'montree://open?file=a.epub&anchor=1',
      })
      expect(html.front).toContain('问题 &lt;重点&gt;')
      expect(html.back).toContain('答案 &amp; 原文')
      expect(html.back).toContain('montree://open?file=a.epub&amp;anchor=1')
      expect(html.back).toContain('[📖 原书]')
    })

    it('escapes cloze inner text while keeping {{cN::}} markers', () => {
      const html = formatFlashcardForAnkiHtml({
        id: '2',
        kind: 'cloze',
        front: '{{c1::堆 <区>}}',
        back: '',
        tags: ['Montree'],
        sourceTitle: 'JVM',
        deepLinkUrl: 'montree://open?file=b.epub',
      })
      expect(html.front).toBe('{{c1::堆 &lt;区&gt;}}')
      expect(html.back).toContain('[📖 原书]')
    })
  })

  describe('buildAnkiExportFileName', () => {
    it('builds filenames for book and chapter scopes', () => {
      const now = new Date(2026, 8, 3, 14, 20)
      const bookFile = buildAnkiExportFileName('深入理解Java虚拟机', 'book', null, now)
      expect(bookFile).toBe('深入理解Java虚拟机-anki-20260903-1420.txt')

      const chapFile = buildAnkiExportFileName('深入理解Java虚拟机', 'chapter', '第1章 走近Java', now)
      expect(chapFile).toBe('深入理解Java虚拟机：第1章 走近Java-anki-20260903-1420.txt')
    })
  })
})
