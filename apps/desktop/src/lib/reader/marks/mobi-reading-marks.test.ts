// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  clearMobiMarkOverlays,
  findMobiNoteMarkAtPoint,
  renderMobiMarkOverlays,
} from './mobi-reading-marks'
import type { ReadingMark } from '@montree/contracts'

function createMark(overrides: Partial<ReadingMark> & Pick<ReadingMark, 'kind' | 'anchor'>): ReadingMark {
  return {
    id: 'mark-1',
    filePath: 'D:\\books\\demo.mobi',
    fileFingerprint: 'fp',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('renderMobiMarkOverlays', () => {
  it('按选中文本包裹 span 显示重点（可含批注）', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>这是第一章的正文内容，用于测试批注。</p>'

    const marks: ReadingMark[] = [
      createMark({
        id: 'note-1',
        kind: 'note',
        excerpt: '第一章的正文',
        note: '备注',
        anchor: {
          format: 'mobi',
          chapterId: '1',
          selectedText: '第一章的正文',
        },
      }),
    ]

    renderMobiMarkOverlays(container, marks, '1')

    const note = container.querySelector('span.mobi-mark-note')
    expect(note).not.toBeNull()
    expect(note?.textContent).toBe('第一章的正文')
    expect(container.querySelector('#reader-mark-layer')).not.toBeNull()
  })

  it('仅渲染当前章节的标记', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>chapter body</p>'

    const marks: ReadingMark[] = [
      createMark({
        kind: 'note',
        excerpt: 'chapter body',
        anchor: {
          format: 'mobi',
          chapterId: 'ch-2',
          selectedText: 'chapter body',
        },
      }),
      createMark({
        id: 'note-2',
        kind: 'note',
        excerpt: 'chapter body',
        anchor: {
          format: 'mobi',
          chapterId: 'ch-1',
          selectedText: 'chapter body',
        },
      }),
    ]

    renderMobiMarkOverlays(container, marks, 'ch-1')

    expect(container.querySelectorAll('span.mobi-mark-note')).toHaveLength(1)
    expect(
      (container.querySelector('span.mobi-mark-note') as HTMLElement | null)?.dataset.markId,
    ).toBe('note-2')
  })

  it('文本锚定失败时按 rect 绘制可 hover 的 hit 区', () => {
    const container = document.createElement('div')
    container.style.height = '800px'
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 600 },
      scrollWidth: { configurable: true, value: 600 },
      offsetWidth: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 800 },
      offsetHeight: { configurable: true, value: 800 },
    })
    container.innerHTML = '<p>完全不同的正文，无法匹配选区文本。</p>'

    const marks: ReadingMark[] = [
      createMark({
        id: 'note-rect',
        kind: 'note',
        excerpt: 'missing text',
        note: '备注',
        anchor: {
          format: 'mobi',
          chapterId: '1',
          selectedText: 'missing text',
          rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.04 }],
        },
      }),
    ]

    renderMobiMarkOverlays(container, marks, '1')

    const hit = container.querySelector('.mobi-mark-note-hit') as HTMLElement | null
    expect(hit).not.toBeNull()
    expect(hit?.style.height).toBe('4%')
    expect(parseFloat(hit?.style.top ?? '')).toBeCloseTo(20, 5)
    expect(container.querySelector('span.mobi-mark-note')).toBeNull()

    const layer = container.querySelector('#reader-mark-layer') as HTMLElement
    expect(layer.style.getPropertyValue('height')).toBe('800px')
    expect(layer.style.getPropertyPriority('height')).toBe('important')
    expect(layer.style.getPropertyValue('width')).toBe('600px')
    expect(layer.style.getPropertyPriority('width')).toBe('important')
  })

  it('geometry 回退可命中 span 批注', () => {
    document.body.innerHTML =
      '<p><span class="mobi-mark-note" data-mark-id="note-1">批注文字</span></p>'
    const span = document.querySelector('span.mobi-mark-note') as HTMLElement
    span.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        right: 110,
        bottom: 40,
        width: 100,
        height: 20,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect
    document.elementFromPoint = () => null

    const hit = findMobiNoteMarkAtPoint(document, 50, 30)
    expect(hit?.markId).toBe('note-1')

    document.body.innerHTML = ''
  })

  it('重复调用时移除旧标记且保留章节 HTML', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>keep me</p>'

    const mark = createMark({
      kind: 'highlight',
      excerpt: 'keep me',
      anchor: {
        format: 'mobi',
        chapterId: 'ch-1',
        selectedText: 'keep me',
      },
    })

    renderMobiMarkOverlays(container, [mark], 'ch-1')
    expect(container.querySelector('span.mobi-mark-highlight')).not.toBeNull()
    expect((container.querySelector('span.mobi-mark-highlight') as HTMLElement).dataset.color).toBe(
      'yellow',
    )

    renderMobiMarkOverlays(container, [], 'ch-1')
    expect(container.querySelector('span.mobi-mark-highlight')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('keep me')
  })
})

describe('clearMobiMarkOverlays', () => {
  it('清理 iframe 文档的文本标记时只解包 span，不删除正文', () => {
    const iframeDocument = document.implementation.createHTMLDocument('iframe-content')
    const container = iframeDocument.body
    container.innerHTML = '<p>保留 <span class="mobi-mark-note" data-mark-id="note-1">这段文字</span></p>'

    clearMobiMarkOverlays(container)

    expect(container.querySelector('span.mobi-mark-note')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('保留 这段文字')
  })

  it('container 为 null 时不抛错', () => {
    expect(() => clearMobiMarkOverlays(null)).not.toThrow()
    expect(() => renderMobiMarkOverlays(null, [], 'ch-1')).not.toThrow()
  })
})
