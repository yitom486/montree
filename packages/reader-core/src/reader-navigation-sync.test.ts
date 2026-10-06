// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { flattenEpubToc, findEpubFlatIndex, resolveChapterNav } from '@montree/reader-core'
import {
  syncEpubNavigation,
  syncPdfNavigation,
} from '@montree/reader-core'
import type { ReaderUnit } from '@montree/reader-core'

function buildGovernanceMonolithicToc() {
  return flattenEpubToc([
    { label: '目录', href: 'nav.xhtml' },
    {
      label: '第一单元',
      href: 'text00002.html',
      subitems: [
        { label: '第2章 国家治理逻辑', href: 'text00002.html#chapter2' },
        { label: '讨论与小结', href: 'text00002.html#summary' },
      ],
    },
    { label: '第3章 控制权理论', href: 'text00003.html' },
    { label: '第4章 治理模式', href: 'text00004.html' },
  ])
}

describe('reader-navigation-sync', () => {
  describe('EPUB hint 同步', () => {
    const chapters = buildGovernanceMonolithicToc()

    it('全书百分比 hint 与章节定位一致', () => {
      const hintNav = syncEpubNavigation(chapters, {
        href: 'text00002.html',
        percentage: 0.9,
      })
      expect(hintNav.current?.label).toBe('第一单元')
      expect(chapters[hintNav.flatIndex]?.label).toBe('讨论与小结')
    })

    it('同 HTML 多节：不得仅用 spine href 取最后一条 TOC（旧 findLast 回归）', () => {
      const sameDocIndices = chapters
        .map((chapter, index) => ({ chapter, index }))
        .filter(({ chapter }) => chapter.href.startsWith('text00002.html'))
        .map(({ index }) => index)

      expect(sameDocIndices.length).toBeGreaterThan(1)
      const lastSameDoc = sameDocIndices[sameDocIndices.length - 1]!
      expect(chapters[lastSameDoc]?.label).toBe('讨论与小结')

      const spineOnlyNav = syncEpubNavigation(chapters, { href: 'text00002.html' })
      expect(spineOnlyNav.current?.label).not.toBe('讨论与小结')
      expect(findEpubFlatIndex(chapters, { href: 'text00002.html' })).not.toBe(lastSameDoc)
    })

    it('工具栏/底部/侧栏共用 flatIndex：hint 与 resolveChapterNav 一致', () => {
      const nav = resolveChapterNav(chapters, undefined, 4)
      const synced = syncEpubNavigation(chapters, { href: 'text00003.html' })

      expect(synced.flatIndex).toBe(4)
      expect(synced.current?.label).toBe(nav.current?.label)
      expect(synced.previous?.label).toBe(nav.previous?.label)
      expect(synced.next?.label).toBe(nav.next?.label)
    })
  })

  describe('三格式统一同步入口', () => {
    it('PDF 通过 syncPdfNavigation 按页码解析大纲', () => {
      const outline: ReaderUnit[] = [
        { label: '前言', href: '5', level: 0 },
        { label: '第1章', href: '12', level: 0 },
        { label: '第2章', href: '20', level: 0 },
      ]

      const nav = syncPdfNavigation(outline, 12)
      expect(nav.current?.label).toBe('第1章')
      expect(nav.next?.label).toBe('第2章')
    })
  })
})
