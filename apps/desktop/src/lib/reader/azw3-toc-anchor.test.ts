// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  findBlockElementByLabel,
  findHeadingElementByLabel,
  findViewportEntryAnchor,
  isHeadingLabelMatch,
  scrollToViewportEntry,
  type ViewportNavEntry,
} from '@montree/reader-core'
import { mockRelativeOffsetTop, mockScrollDocument } from '@/lib/reader/reader-viewport-test-helpers'

describe('isHeadingLabelMatch wrapper guard', () => {
  it('短标签「小结」不得模糊匹配「讨论与小结」', () => {
    expect(isHeadingLabelMatch('小结', '讨论与小结')).toBe(false)
    expect(isHeadingLabelMatch('小结', '小结')).toBe(true)
  })

  it('拒绝「外层容器 textContent 包含小节标题」式假匹配', () => {
    const wrapper =
      '第一章 五星会聚与安禄山起兵的政治宣传 一、小引 二、四星聚与玄宗朝的佛道之争 三、金土相克'
    expect(isHeadingLabelMatch('二、四星聚与玄宗朝的佛道之争', wrapper)).toBe(false)
    expect(isHeadingLabelMatch('二、四星聚与玄宗朝的佛道之争', '二、四星聚与玄宗朝的佛道之争')).toBe(
      true,
    )
  })
})

describe('KF8/AZW3 calibre 外层容器回归', () => {
  it('点三级 TOC 时锚定小节 p，而非整章 div.calibre', () => {
    const document = mockScrollDocument(
      `
        <div class="calibre">
          <p class="calibre_1">第一章 五星会聚与安禄山起兵的政治宣传</p>
          <p class="calibre_2">一、小引</p>
          <p>导言正文……</p>
          <p class="calibre_2" id="sec2">二、四星聚与玄宗朝的佛道之争</p>
          <p>本节正文……</p>
        </div>
      `,
      [
        { selector: 'div.calibre', top: 0, height: 5000 },
        { selector: 'p.calibre_1', top: 0, height: 48 },
        { selector: '#sec2', top: 2400, height: 40 },
      ],
      0,
    )

    const label = '二、四星聚与玄宗朝的佛道之争'
    const hit = findHeadingElementByLabel(document, label)
    expect(hit?.id).toBe('sec2')
    expect(hit?.tagName).toBe('P')

    const entry: ViewportNavEntry = {
      flatIndex: 3,
      label,
      loadKey: '2',
      selector: '[aid="missing"]',
    }
    // selector 失效时自动回退标签匹配，仍应滚到小节而非章首
    expect(findBlockElementByLabel(document, label)?.id).toBe('sec2')
    expect(scrollToViewportEntry(document, entry, { behavior: 'auto' })).toBe(true)
  })

  it('parser selector 指向脚注时，优先使用真正的三级标题', () => {
    const document = mockScrollDocument(
      `
        <div class="calibre">
          <h2 id="section-3">三、金土相代：安禄山起兵的政治宣传</h2>
          <p>本节正文……<a id="fn59" aid="wrong-target">[59]</a></p>
        </div>
      `,
      [
        { selector: '#section-3', top: 2200, height: 40 },
        { selector: '#fn59', top: 3600, height: 20 },
      ],
      0,
    )
    const entry: ViewportNavEntry = {
      flatIndex: 7,
      label: '三、金土相代：安禄山起兵的政治宣传',
      loadKey: '5',
      selector: '[aid="wrong-target"]',
    }

    expect(findViewportEntryAnchor(document, entry)?.id).toBe('section-3')
    expect(scrollToViewportEntry(document, entry, { behavior: 'auto' })).toBe(true)
  })

  it('aid selector 优先命中', () => {
    const document = mockScrollDocument(
      `<div class="calibre"><p aid="frag2" class="calibre_2">二、四星聚与玄宗朝的佛道之争</p></div>`,
      [{ selector: 'p[aid="frag2"]', top: 1800, height: 40 }],
      0,
    )
    const entry: ViewportNavEntry = {
      flatIndex: 3,
      label: '二、四星聚与玄宗朝的佛道之争',
      loadKey: '2',
      selector: '[aid="frag2"]',
    }
    expect(scrollToViewportEntry(document, entry, { behavior: 'auto' })).toBe(true)
  })
})
