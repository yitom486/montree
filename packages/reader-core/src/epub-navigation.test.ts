import { describe, expect, it } from 'vitest'
import {
  findEpubFlatIndex,
  flattenEpubToc,
  isTocLikeChapter,
  pickInitialChapter,
  resolveChapterNav,
} from '@montree/reader-core'

/** 复现《中国国家治理的制度逻辑》一类：一级仅「目录」，正文挂在二级 */
function buildGovernanceToc() {
  return flattenEpubToc([
    {
      label: '目录',
      href: 'text00001.html',
      subitems: [
        { label: '自序', href: 'text00001.html#toc_id_1' },
        { label: '第1章 导论：中国国家治理的制度逻辑', href: 'text00002.html' },
        { label: '第2章 中国政府组织结构', href: 'text00003.html' },
        { label: '第3章 委托代理关系', href: 'text00004.html' },
      ],
    },
  ])
}

/** 同一 HTML 内含多节（scrolled-doc 常见）：href 无 fragment */
function buildMonolithicChapterToc() {
  return flattenEpubToc([
    { label: '目录', href: 'nav.xhtml' },
    {
      label: '第1章 导论',
      href: 'chapter01.html',
      subitems: [
        { label: '自序', href: 'chapter01.html#preface' },
        { label: '问题提出', href: 'chapter01.html#intro' },
        { label: '讨论与小结', href: 'chapter01.html#summary' },
      ],
    },
    { label: '第2章 组织结构', href: 'chapter02.html' },
  ])
}

describe('epub-navigation', () => {
  const chapters = flattenEpubToc([
    { label: '目录', href: 'nav.xhtml' },
    { label: '第一章', href: 'ch1.xhtml' },
    { label: '第二章', href: 'ch2.xhtml' },
  ])

  it('展平目录并跳过目录页作为起始章', () => {
    expect(chapters).toHaveLength(3)
    expect(isTocLikeChapter(chapters[0]!)).toBe(true)
    expect(pickInitialChapter(chapters)?.label).toBe('第一章')
  })

  it('解析当前章节与前后章', () => {
    const nav = resolveChapterNav(chapters, 'ch2.xhtml')
    expect(nav.current?.label).toBe('第二章')
    expect(nav.previous?.label).toBe('第一章')
    expect(nav.next).toBeNull()
  })

  it('位于二级小节时底栏仍显示所属章节', () => {
    const nested = flattenEpubToc([
      { label: '第一章', href: 'ch1.xhtml', subitems: [{ label: '一、小引', href: 'ch1.xhtml#intro' }] },
      { label: '第二章', href: 'ch2.xhtml' },
    ])
    const nav = resolveChapterNav(nested, 'ch1.xhtml#intro')
    expect(nav.current?.label).toBe('第一章')
    expect(nav.previous).toBeNull()
    expect(nav.next?.label).toBe('第二章')
    expect(nav.flatIndex).toBeGreaterThanOrEqual(0)
  })

  describe('同 HTML 多目录项（scrolled-doc 回归）', () => {
    const monolithic = buildMonolithicChapterToc()

    it('1% 进度时匹配自序而非讨论与小结', () => {
      const index = findEpubFlatIndex(monolithic, {
        href: 'chapter01.html',
        percentage: 0.01,
      })
      expect(monolithic[index]?.label).toBe('自序')
    })

    it('90% 进度时匹配讨论与小结', () => {
      const index = findEpubFlatIndex(monolithic, {
        href: 'chapter01.html',
        percentage: 0.9,
      })
      expect(monolithic[index]?.label).toBe('讨论与小结')
    })

    it('底部导航与正文开头同步（渲染单位为整章）', () => {
      const nav = resolveChapterNav(monolithic, {
        href: 'chapter01.html',
        percentage: 0.01,
      })
      expect(nav.current?.label).toBe('第1章 导论')
      expect(nav.next?.label).toBe('第2章 组织结构')
      expect(nav.previous).toBeNull()
    })
  })

  describe('目录下挂自序/章（用户书回归）', () => {
    const nested = buildGovernanceToc()

    it('带 toc_ 前缀的 fragment 不会把自序误判为目录页', () => {
      expect(isTocLikeChapter(nested[1]!)).toBe(false)
      expect(isTocLikeChapter(nested[0]!)).toBe(true)
    })

    it('初始打开落在自序而非目录', () => {
      expect(pickInitialChapter(nested)?.label).toBe('自序')
    })

    it('无 fragment 的同文件 href 默认匹配首个正文章节', () => {
      expect(findEpubFlatIndex(nested, { href: 'text00001.html' })).toBe(1)
      expect(nested[1]?.label).toBe('自序')
    })

    it('阅读自序时底部导航显示自序，下一章为第1章', () => {
      const nav = resolveChapterNav(nested, { href: 'text00001.html', percentage: 0.01 })
      expect(nav.current?.label).toBe('自序')
      expect(nav.next?.label).toBe('第1章 导论：中国国家治理的制度逻辑')
      expect(nav.previous).toBeNull()
    })

    it('带 fragment 的自序位置同样识别为自序', () => {
      const nav = resolveChapterNav(nested, 'text00001.html#toc_id_1')
      expect(nav.current?.label).toBe('自序')
      expect(nav.next?.label).toContain('第1章')
    })

    it('在第1章时上一章为自序、下一章为第2章', () => {
      const nav = resolveChapterNav(nested, 'text00002.html')
      expect(nav.current?.label).toContain('第1章')
      expect(nav.previous?.label).toBe('自序')
      expect(nav.next?.label).toContain('第2章')
    })
  })

  describe('嵌套 TOC（康熙红票类）', () => {
    const kangxi = flattenEpubToc([
      {
        label: '第一部分 进入清朝权贵圈的西洋人',
        href: 'part1.html',
        subitems: [
          {
            label: '第一章 佟家的奴才',
            href: 'ch1.html',
            subitems: [
              { label: '战场上的俘虏', href: 'ch1.html#prisoners' },
              { label: '康熙母亲的娘家', href: 'ch1.html#family' },
            ],
          },
          { label: '第二章', href: 'ch2.html' },
        ],
      },
    ])

    it('三级小节位置：底栏当前为二级章、下一章为第二章', () => {
      const prisonersIndex = kangxi.findIndex((c) => c.label === '战场上的俘虏')
      const nav = resolveChapterNav(kangxi, undefined, prisonersIndex)
      expect(nav.current?.label).toContain('第一章')
      expect(nav.next?.label).toBe('第二章')
      expect(nav.previous?.label).toContain('第一部分')
      expect(nav.nextIndex).toBeGreaterThan(nav.currentIndex)
    })
  })

  describe('目录层级与正文渲染单元不一致', () => {
    const shortStories = flattenEpubToc([
      {
        label: '醒世恒言',
        href: 'xing/index.xhtml',
        subitems: [
          { label: '第一卷', href: 'xing/001.xhtml' },
          { label: '第二卷', href: 'xing/002.xhtml' },
        ],
      },
      {
        label: '初刻拍案惊奇',
        href: 'chu/index.xhtml',
        subitems: [{ label: '第一卷', href: 'chu/001.xhtml' }],
      },
    ])

    it('底栏按下一个实际加载的正文文件导航，而不是跳到下一个同级目录', () => {
      const firstStoryIndex = shortStories.findIndex(
        (chapter) => chapter.href === 'xing/001.xhtml',
      )
      const nav = resolveChapterNav(shortStories, undefined, firstStoryIndex)

      expect(nav.current?.label).toBe('第一卷')
      expect(nav.next?.label).toBe('第二卷')
      expect(nav.nextIndex).toBe(
        shortStories.findIndex((chapter) => chapter.href === 'xing/002.xhtml'),
      )
      expect(nav.flatIndex).toBe(firstStoryIndex)
    })
  })
})
