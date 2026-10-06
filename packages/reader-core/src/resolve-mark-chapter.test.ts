import { describe, expect, it } from 'vitest'
import type { ReadingAnchor, ReadingMark } from '@montree/contracts'
import { normalizeLoadKey } from './reader-viewport-nav'
import {
  resolveMarkChapter,
  toCanonicalChapter,
  tocFromEpubUnits,
  tocFromMobiUnits,
  tocFromPdfUnits,
  tocFromWebUnits,
} from './export-reading-notes'

function mark(
  overrides: Partial<ReadingMark> & Pick<ReadingMark, 'id' | 'kind' | 'anchor'>,
): ReadingMark {
  return {
    filePath: '/book',
    fileFingerprint: 'fp',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const epubToc = tocFromEpubUnits([
  { href: 'Text/ch0.xhtml', label: '原编者的话' },
  { href: 'Text/ch1.xhtml', label: '第一章 北美的外貌' },
])

describe('resolveMarkChapter（单入口）', () => {
  it('epub 按 CFI/href 命中并返回目录项', () => {
    const hit = resolveMarkChapter(
      { format: 'epub', cfi: 'epubcfi(/6/2)', href: 'Text/ch1.xhtml' },
      epubToc,
    )
    expect(hit?.label).toBe('第一章 北美的外貌')
    expect(hit?.matchKey).toBe('text/ch1.xhtml')
  })

  it('同文件多目录项时取层级最深（小节优先，既有语义）', () => {
    const toc = tocFromEpubUnits([
      { href: 'Text/ch1.xhtml', label: '第一章', level: 0 },
      { href: 'Text/ch1.xhtml#s2', label: '第一节', level: 1 },
    ])
    const hit = resolveMarkChapter(
      { format: 'epub', cfi: 'epubcfi(/6/2)', href: 'Text/ch1.xhtml' },
      toc,
    )
    expect(hit?.label).toBe('第一节')
  })

  it('mobi 按 chapterId 命中', () => {
    const toc = tocFromMobiUnits([
      { id: 'ch-a', label: '开篇' },
      { id: 'ch-b', label: '中篇' },
    ])
    const hit = resolveMarkChapter({ format: 'mobi', chapterId: 'ch-b' }, toc)
    expect(hit?.label).toBe('中篇')
  })

  it('mobi id 与目录 href 同源时按 spine base 命中（与导航同步同构）', () => {
    // 导航同步（syncChapterNav）用 isSameSpineBase 取首个匹配，解析必须同规则，
    // 否则归属判定与当前章节判定口径不一（MOBI 已知问题）
    const toc = tocFromEpubUnits([
      { href: 'OEBPS/part1.xhtml', label: '第一部分' },
      { href: 'OEBPS/part2.xhtml', label: '第二部分' },
    ])
    const hit = resolveMarkChapter({ format: 'mobi', chapterId: 'part2.xhtml' }, toc)
    expect(hit?.label).toBe('第二部分')
    const canon = toCanonicalChapter(
      { format: 'mobi', chapterId: 'part2.xhtml' } as ReadingAnchor,
      toc,
    )
    expect(canon?.key).toBe(normalizeLoadKey('OEBPS/part2.xhtml'))
  })

  it('pdf 按页命中', () => {
    const toc = tocFromPdfUnits([
      { href: '1', label: '封面' },
      { href: '10', label: '第一章' },
    ])
    const hit = resolveMarkChapter({ format: 'pdf', page: 12 }, toc)
    expect(hit?.label).toBe('第一章')
  })

  it('web 按 URL 命中', () => {
    const toc = tocFromWebUnits([
      { href: 'https://ex.com/a#b', label: '甲' },
      { href: 'https://ex.com/c', label: '乙' },
    ])
    const hit = resolveMarkChapter({ format: 'web', url: 'https://ex.com/a' }, toc)
    expect(hit?.label).toBe('甲')
  })

  it('纯未知返回 null（调用方标脏，不伪造章节）', () => {
    expect(resolveMarkChapter({ format: 'pdf', page: -1 }, [])).toBeNull()
    expect(resolveMarkChapter({ format: 'mobi', chapterId: '' }, [])).toBeNull()
  })

  it('epub 未命中目录时回退为文件名条目（非 null，同文件可分组）', () => {
    const hit = resolveMarkChapter(
      { format: 'epub', cfi: 'x', href: 'no/such.xhtml' },
      epubToc,
    )
    expect(hit).toMatchObject({ key: 'no/such.xhtml', label: 'such.xhtml' })
  })
})

describe('toCanonicalChapter（写入固化，回归：key 口径）', () => {
  it('canonical key 与阅读器当前章节 key 同构（matchKey 形态，无 index 前缀）', () => {
    // 阅读器传入的当前章节 key 形态：
    const currentKey = normalizeLoadKey('Text/ch1.xhtml')
    const canon = toCanonicalChapter(
      { format: 'epub', cfi: 'epubcfi(/6/2)', href: 'Text/ch1.xhtml' } as ReadingAnchor,
      epubToc,
    )
    expect(canon).not.toBeNull()
    // 核心回归：曾经 `3:text/x` vs `text/x` 恒不等导致本章过滤全灭
    expect(canon!.key).toBe(currentKey)
    expect(canon!.label).toBe('第一章 北美的外貌')
    expect(canon!.index).toBe(1)
  })

  it('toc key 带 index 前缀，不可直接比较（把坑写进测试）', () => {
    expect(epubToc[1]?.key).toBe('1:text/ch1.xhtml')
    expect(epubToc[1]?.key).not.toBe(normalizeLoadKey('Text/ch1.xhtml'))
    expect(epubToc[1]?.matchKey).toBe(normalizeLoadKey('Text/ch1.xhtml'))
  })

  it('纯未知返回 null（不写 chapter 字段）', () => {
    expect(toCanonicalChapter({ format: 'pdf', page: -1 } as ReadingAnchor, [])).toBeNull()
  })

  it('mark() 辅助：完整 mark 也可解析', () => {
    const m = mark({
      id: 'm1',
      kind: 'highlight',
      anchor: { format: 'epub', cfi: 'c', href: 'Text/ch0.xhtml' },
    })
    expect(toCanonicalChapter(m.anchor, epubToc)?.label).toBe('原编者的话')
  })
})
