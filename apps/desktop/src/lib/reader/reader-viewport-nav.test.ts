// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  isHeadingLabelMatch,
  findFlatIndexFromViewport,
  findHeadingElementByLabel,
  findBlockElementByLabel,
  findViewportEntryAnchor,
  normalizeLoadKey,
  scrollToViewportEntry,
  type ViewportNavEntry,
} from '@montree/reader-core'

import { mockScrollDocument } from '@/lib/reader/reader-viewport-test-helpers'
describe('isHeadingLabelMatch', () => {
  it('短标签「小结」不得模糊匹配「讨论与小结」', () => {
    expect(isHeadingLabelMatch('小结', '讨论与小结')).toBe(false)
    expect(isHeadingLabelMatch('小结', '小结')).toBe(true)
  })

  it('章标题允许包含匹配', () => {
    expect(
      isHeadingLabelMatch(
        '第三章 从铲除鳌拜到《尼布楚条约》谈判',
        '第三章 从铲除鳌拜到《尼布楚条约》谈判',
      ),
    ).toBe(true)
  })
})

describe('reader-viewport-nav（跨格式标题定位基元）', () => {
  it('热更新期间缺失 loadKey 时不抛出异常', () => {
    expect(normalizeLoadKey(undefined)).toBe('')
    expect(normalizeLoadKey(null)).toBe('')
  })

  describe('MOBI / AZW3 章节标题形态', () => {

    it('「小结」不得误匹配含小结字样的长标题', () => {
      const entries: ViewportNavEntry[] = [
        { flatIndex: 0, label: '第三章', loadKey: '3' },
        { flatIndex: 1, label: '小结', loadKey: '3' },
      ]

      const document = mockScrollDocument(
        `<h2>第三章 从铲除鳌拜到《尼布楚条约》谈判</h2><h3>本章小结</h3>`,
        [
          { selector: 'h2', top: 0, height: 48 },
          { selector: 'h3', top: 4000, height: 32 },
        ],
        0,
      )

      expect(findFlatIndexFromViewport(document, entries, '3')).toBe(0)
    })

    it('KF8 selector 可定位标题', () => {
      const document = mockScrollDocument(
        `<p id="sec2" class="calibre_2">二、四面其主：安史乱中的王伷</p><p class="calibre_2">正文</p>`,
        [{ id: 'sec2', top: 800, height: 40 }],
        0,
      )

      const entry: ViewportNavEntry = {
        flatIndex: 2,
        label: '二、四面其主：安史乱中的王伷',
        loadKey: 'chapter2',
        selector: '#sec2',
      }

      expect(findViewportEntryAnchor(document, entry)?.id).toBe('sec2')
      expect(scrollToViewportEntry(document, entry, { behavior: 'auto' })).toBe(true)
    })

    it('calibre 段落标题可按标签文本定位', () => {
      const document = mockScrollDocument(
        `<p class="calibre_5">一、赵晔：《忠义传》中的“贰臣”</p>`,
        [{ selector: 'p.calibre_5', top: 120, height: 36 }],
        0,
      )

      expect(
        findHeadingElementByLabel(document, '一、赵晔：《忠义传》中的“贰臣”')?.className,
      ).toContain('calibre_5')
    })

    it('三级目录项：普通段落文本也可作锚点', () => {
      const document = mockScrollDocument(
        `<p class="calibre_4">三、金土相克：安禄山起兵的政治宣传</p><p>正文段落</p>`,
        [{ selector: 'p.calibre_4', top: 2400, height: 36 }],
        0,
      )

      const entry: ViewportNavEntry = {
        flatIndex: 4,
        label: '三、金土相克：安禄山起兵的政治宣传',
        loadKey: '2',
      }

      expect(findBlockElementByLabel(document, entry.label)?.textContent).toContain('三、金土相克')
      expect(scrollToViewportEntry(document, entry, { behavior: 'auto' })).toBe(true)
    })

    it('iframe 文档中的标题不会被父窗口 HTMLElement 判断误杀', () => {
      const frameDocument = mockScrollDocument(
        '<p id="subsection" class="calibre_4">四、严复的死亡与哀荣</p>',
        [{ id: 'subsection', top: 800, height: 40 }],
        0,
      )
      const element = frameDocument.getElementById('subsection')
      expect(element).not.toBeNull()
      if (!element) return

      const frameHTMLElement = HTMLElement
      Object.defineProperty(element, 'ownerDocument', {
        configurable: true,
        value: { defaultView: { HTMLElement: frameHTMLElement } },
      })
      vi.stubGlobal('HTMLElement', class ParentHTMLElement {})

      const entry: ViewportNavEntry = {
        flatIndex: 8,
        label: '四、严复的死亡与哀荣',
        loadKey: '2',
        selector: '#subsection',
      }

      try {
        expect(element instanceof HTMLElement).toBe(false)
        expect(findViewportEntryAnchor(frameDocument, entry)?.id).toBe('subsection')
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
