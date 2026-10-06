// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  buildChapterSectionMap,
  buildMarkFlag,
  firstLineRectOfRange,
  flagSpotForRange,
  isExcerptDrawAllowed,
  resolveMarkRange,
  resolveMarkRangeDetailed,
  type CfiResolverView,
} from './epub-mark-overlay'
import { subscribeRailFocus } from '../rail-follow'

/**
 * EPUB 常驻标记统一几何层测试（happy-dom 真 DOM + stub 矩形）。
 * 锁定统一规则：CFI 优先 excerpt 兜底的单 Range 口径、absolute 文档内定位。
 * （happy-dom 无排版引擎：getClientRects 按 stub 矩形注入。）
 */

function docWithParagraphs(...texts: string[]): Document {
  const doc = document.implementation.createHTMLDocument('section')
  for (const text of texts) {
    const p = doc.createElement('p')
    p.textContent = text
    doc.body.appendChild(p)
  }
  return doc
}

function stubRects(range: Range, rects: Array<{ left: number; top: number; width: number; height: number }>) {
  vi.spyOn(range, 'getClientRects').mockReturnValue(rects as unknown as DOMRectList)
  vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(
    rects[0] as unknown as DOMRect,
  )
}

function viewWith(anchor: (doc: Document) => Range | null, index = 0): CfiResolverView {
  return { resolveCFI: () => ({ index, anchor }) }
}

describe('resolveMarkRange', () => {
  it('CFI 命中即用（即使 excerpt 首匹配在别处——终结 M1/M2 分叉）', () => {
    const doc = docWithParagraphs('目标摘录第一处', '中间文字', '目标摘录第二处')
    const cfiRange = doc.createRange()
    cfiRange.selectNodeContents(doc.body.children[2]!)
    const mark = {
      anchor: { format: 'epub', cfiRange: 'epubcfi(/6/10!/4/6)', cfi: 'epubcfi(/6/10!/4/6)' },
      excerpt: '目标摘录',
    }
    const resolved = resolveMarkRange(doc, 0, mark, viewWith(() => cfiRange))
    expect(resolved).toBe(cfiRange)
  })

  it('CFI 抛错/归属他节时落到 excerpt 兜底', () => {
    const doc = docWithParagraphs('兜底摘录正文')
    const mark = {
      anchor: { format: 'epub', cfiRange: 'epubcfi(/6/99)', cfi: 'epubcfi(/6/99)' },
      excerpt: '兜底摘录正文',
    }
    const throwing: CfiResolverView = {
      resolveCFI: () => {
        throw new Error('stale cfi')
      },
    }
    expect(resolveMarkRange(doc, 0, mark, throwing)).not.toBeNull()
    expect(resolveMarkRange(doc, 0, mark, viewWith(() => null, 7))).not.toBeNull()
  })

  it('无 CFI 无摘录返回 null；pdf 锚点不走 CFI', () => {
    const doc = docWithParagraphs('内容')
    expect(
      resolveMarkRange(doc, 0, { anchor: { format: 'epub' }, excerpt: '' }, viewWith(() => null)),
    ).toBeNull()
    const pdfMark = { anchor: { format: 'pdf' }, excerpt: '内容' }
    const resolveCFI = vi.fn()
    const range = resolveMarkRange(doc, 0, pdfMark, { resolveCFI } as unknown as CfiResolverView)
    expect(resolveCFI).not.toHaveBeenCalled()
    expect(range).not.toBeNull()
  })
})

describe('flagSpotForRange', () => {  it('圆点落首行左侧，含文档滚动偏移（absolute 文档内坐标）', () => {
    const doc = docWithParagraphs('一行文字内容')
    const range = doc.createRange()
    range.selectNodeContents(doc.body.children[0]!)
    stubRects(range, [{ left: 100, top: 50, width: 200, height: 20 }])
    doc.documentElement.scrollTop = 300
    const spot = flagSpotForRange(range, doc, 12)
    // left = 100 - 12 - 8；top = 50 + 10 - 6 + 300（滚动偏移）
    expect(spot).toEqual({ left: 80, top: 354, size: 12 })
  })

  it('无合法矩形返回 null（调用方不画）', () => {
    const doc = docWithParagraphs('文字')
    const range = doc.createRange()
    range.selectNodeContents(doc.body.children[0]!)
    stubRects(range, [{ left: 0, top: 0, width: 0, height: 0 }])
    expect(flagSpotForRange(range, doc)).toBeNull()
  })

  it('firstLineRectOfRange 取首行而非外接矩形', () => {
    const doc = docWithParagraphs('多行引用文字')
    const range = doc.createRange()
    range.selectNodeContents(doc.body.children[0]!)
    const first = { left: 10, top: 20, width: 300, height: 18 }
    const second = { left: 10, top: 40, width: 300, height: 18 }
    stubRects(range, [first, second])
    expect(firstLineRectOfRange(range)).toBe(first as unknown as DOMRect)
  })
})

describe('buildMarkFlag', () => {
  it('absolute 定位 + markId + 背景色，点击直达卡片', () => {
    const doc = docWithParagraphs('旗标行文字内容')
    const range = doc.createRange()
    range.selectNodeContents(doc.body.children[0]!)
    stubRects(range, [{ left: 100, top: 50, width: 200, height: 20 }])

    const flag = buildMarkFlag(doc, 'mark-7', range, { background: 'rgb(1, 2, 3)' })
    expect(flag).not.toBeNull()
    expect(flag!.getAttribute('data-montree-flag')).toBe('mark-7')
    expect(flag!.style.position).toBe('absolute')
    expect(flag!.style.left).toBe('80px')
    expect(flag!.style.top).toBe('54px')
    expect(flag!.style.background).toContain('rgb(1, 2, 3)')

    const seen: string[] = []
    const off = subscribeRailFocus((id) => seen.push(id))
    try {
      flag!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(seen).toEqual(['mark-7'])
    } finally {
      off()
    }
  })

  it('无合法矩形返回 null', () => {
    const doc = docWithParagraphs('文字')
    const range = doc.createRange()
    range.selectNodeContents(doc.body.children[0]!)
    stubRects(range, [])
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    } as unknown as DOMRect)
    expect(buildMarkFlag(doc, 'm', range, { background: 'red' })).toBeNull()
  })
})

describe('resolveMarkRangeDetailed', () => {
  it('区分 cfi 与 excerpt 两种来源', () => {
    const doc = docWithParagraphs('兜底文本')
    const cfiRange = doc.createRange()
    cfiRange.selectNodeContents(doc.body.children[0]!)
    const mark = {
      anchor: { format: 'epub', cfiRange: 'epubcfi(/6/2)', cfi: 'epubcfi(/6/2)' },
      excerpt: '兜底文本',
    }
    expect(resolveMarkRangeDetailed(doc, 0, mark, viewWith(() => cfiRange))).toEqual({
      range: cfiRange,
      via: 'cfi',
    })
    expect(
      resolveMarkRangeDetailed(doc, 0, mark, viewWith(() => null)),
    ).toMatchObject({ via: 'excerpt' })
  })

  it('wrapper 与 detailed 一致', () => {
    const doc = docWithParagraphs('文本')
    const mark = { anchor: { format: 'epub', cfi: 'c' }, excerpt: '文本' }
    expect(resolveMarkRange(doc, 0, mark, viewWith(() => null))).not.toBeNull()
    expect(resolveMarkRange(doc, 9, { anchor: { format: 'epub' } }, null)).toBeNull()
  })
})

describe('章节门（excerpt 兜底绘制范围）', () => {
  const units = [
    { href: 'preface.xhtml' },
    { href: 'Editor-Note.xhtml' },
    { href: 'Editor-Note.xhtml#sec2' },
    { href: 'book1.xhtml' },
  ]

  it('buildChapterSectionMap：归一化合并同文件，跳过 null', () => {
    const map = buildChapterSectionMap(units, [0, 1, 1, null])
    expect(map.get('preface.xhtml')).toEqual(new Set([0]))
    // 大小写/#分片归一后合并
    expect(map.get('editor-note.xhtml')).toEqual(new Set([1]))
    expect(map.has('book1.xhtml')).toBe(false)
  })

  it('isExcerptDrawAllowed：本章放行、别章拦、无归属放行', () => {
    const map = buildChapterSectionMap(units, [0, 1, 1, 2])
    // 无固化章节的老卡：保可见
    expect(isExcerptDrawAllowed(null, 9, map)).toBe(true)
    expect(isExcerptDrawAllowed(undefined, 9, map)).toBe(true)
    // 有映射：只许自己章节的 section
    expect(isExcerptDrawAllowed('editor-note.xhtml', 1, map)).toBe(true)
    expect(isExcerptDrawAllowed('editor-note.xhtml', 0, map)).toBe(false)
    expect(isExcerptDrawAllowed('editor-note.xhtml', 2, map)).toBe(false)
    // 章节在目录中无映射（目录变了）：fail-open 保可见
    expect(isExcerptDrawAllowed('gone-chapter.xhtml', 0, map)).toBe(true)
    // 空目录：全放行
    expect(isExcerptDrawAllowed('editor-note.xhtml', 5, new Map())).toBe(true)
  })

  it('复现本章（0）全书（4）：别章卡的 excerpt 在本章文档零绘制', () => {
    // 原编者的话的卡（section 1），在前言文档（section 0）若走 excerpt 兜底必须被拦
    const map = buildChapterSectionMap(units, [0, 1, 1, 2])
    const otherChapterCard = {
      anchor: { format: 'epub', cfiRange: 'stale-cfi', cfi: 'stale-cfi' },
      excerpt: '前言里恰好也有的句子',
      chapter: { key: 'editor-note.xhtml' },
    }
    const doc = docWithParagraphs('前言里恰好也有的句子')
    // CFI 失效（旧书）→ 兜底 excerpt 能定位文本…
    const resolved = resolveMarkRangeDetailed(doc, 0, otherChapterCard, viewWith(() => null))
    expect(resolved?.via).toBe('excerpt')
    // …但章节门拦住，不画
    expect(isExcerptDrawAllowed(otherChapterCard.chapter.key, 0, map)).toBe(false)
    // 同章则画
    expect(isExcerptDrawAllowed(otherChapterCard.chapter.key, 1, map)).toBe(true)
  })
})
