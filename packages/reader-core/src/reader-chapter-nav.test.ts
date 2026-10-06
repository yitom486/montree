import { describe, expect, it } from 'vitest'
import {
  findNextDistinctLoadTarget,
  findPreviousDistinctLoadTarget,
  pickReaderNavLevel,
  resolveAdjacentFlatNav,
  resolveReaderChapterNav,
} from '@montree/reader-core'

describe('resolveAdjacentFlatNav', () => {
  const governanceToc = [
    { label: '目录', level: 0, id: '0' },
    { label: '自序', level: 1, id: '1' },
    { label: '第1章 导论', level: 1, id: '2' },
    { label: '第一单元', level: 1, id: '3' },
    { label: '第2章', level: 2, id: '3' },
    { label: '第3章', level: 2, id: '3' },
    { label: '组织背景', level: 2, id: '3' },
    { label: '第二单元', level: 1, id: '4' },
    { label: '第三单元', level: 1, id: '5' },
  ]

  const isToc = (chapter: { label: string }) => chapter.label === '目录'

  it('在第二单元时上一节为组织背景而非第一单元', () => {
    const nav = resolveAdjacentFlatNav(governanceToc, 7, { isTocLike: isToc })
    expect(nav.current?.label).toBe('第二单元')
    expect(nav.previous?.label).toBe('组织背景')
    expect(nav.next?.label).toBe('第三单元')
  })

  it('同 spine 内按最小目录逐步前进', () => {
    const nav = resolveAdjacentFlatNav(governanceToc, 4, { isTocLike: isToc })
    expect(nav.current?.label).toBe('第2章')
    expect(nav.next?.label).toBe('第3章')
    expect(nav.previous?.label).toBe('第一单元')
  })

  it('滚轮翻页跳过相同 load key 的条目', () => {
    const options = { isTocLike: isToc, getLoadTargetKey: (chapter: { id: string }) => chapter.id }
    const next = findNextDistinctLoadTarget(governanceToc, 4, options)
    expect(next?.item.label).toBe('第二单元')

    const prev = findPreviousDistinctLoadTarget(governanceToc, 7, options)
    expect(prev?.item.label).toBe('组织背景')
  })
})

describe('pickReaderNavLevel', () => {
  it('EPUB 目录下挂正文章节时使用二级目录导航', () => {
    const chapters = [
      { label: '目录', level: 0 },
      { label: '自序', level: 1 },
      { label: '第1章 导论', level: 1 },
      { label: '第2章 组织研究', level: 1 },
    ]
    expect(pickReaderNavLevel(chapters, (chapter) => chapter.label === '目录')).toBe(1)
  })

  it('MOBI 一级章节为主时使用 level 0', () => {
    const chapters = [
      { label: '目录', level: 0 },
      { label: '第一章', level: 0 },
      { label: '一、小引', level: 1 },
      { label: '第二章', level: 0 },
    ]
    expect(pickReaderNavLevel(chapters, (chapter) => chapter.label === '目录')).toBe(0)
  })
})

describe('resolveReaderChapterNav', () => {
  const chapters = [
    { label: '第一章', level: 0 },
    { label: '一、小引', level: 1 },
    { label: '第二章', level: 0 },
  ]

  it('从二级目录位置回溯到所属一级章节', () => {
    const nav = resolveReaderChapterNav(chapters, 1, 0)
    expect(nav.current?.label).toBe('第一章')
    expect(nav.next?.label).toBe('第二章')
    expect(nav.nextIndex).toBe(2)
    expect(nav.previous).toBeNull()
    expect(nav.previousIndex).toBe(-1)
  })
})
