// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { findPdfMarksAtPoint, flagSpotForQuads, renderPdfMarkOverlays } from './pdf-reading-marks'
import type { PdfSelectionSnapshot } from '@montree/reader-core'
import type { ReadingMark } from '@montree/contracts'
import type { PageViewport } from 'pdfjs-dist'

const viewport = {
  width: 100,
  height: 100,
  convertToViewportPoint: (x: number, y: number) => [x, 100 - y],
} as PageViewport

function createLayer(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg')
}

function createMark(overrides: Partial<ReadingMark> & Pick<ReadingMark, 'kind' | 'anchor'>): ReadingMark {
  return {
    id: 'mark-1',
    filePath: 'D:\\books\\demo.pdf',
    fileFingerprint: 'fp',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('renderPdfMarkOverlays', () => {
  it('仅渲染当前页的高亮与批注 overlay', () => {
    const layer = createLayer()
    const marks: ReadingMark[] = [
      createMark({
        kind: 'highlight',
        anchor: {
          format: 'pdf',
          page: 2,
          rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
        },
      }),
      createMark({
        kind: 'note',
        anchor: {
          format: 'pdf',
          page: 1,
          rects: [{ x: 0.05, y: 0.1, width: 0.2, height: 0.03 }],
        },
      }),
      createMark({
        kind: 'bookmark',
        anchor: { format: 'pdf', page: 1 },
      }),
    ]

    renderPdfMarkOverlays(layer, marks, 1, 'dark', viewport)

    // 批注行内虚线 + 行首旗标各一，书签不画
    expect(layer.children).toHaveLength(2)
    expect(layer.firstElementChild?.getAttribute('class')).toBe('pdf-mark-note')
    expect(layer.firstElementChild?.getAttribute('data-theme')).toBe('dark')
  })

  it('批注用虚线细条，强制透明底', () => {
    const layer = createLayer()
    const mark = createMark({
      kind: 'note',
      note: '测试批注',
      color: 'yellow',
      anchor: {
        format: 'pdf',
        page: 1,
        rects: [{ x: 0, y: 0.1, width: 0.5, height: 0.05 }],
      },
    })

    renderPdfMarkOverlays(layer, [mark], 1, 'light', viewport)
    const overlay = layer.firstElementChild as SVGLineElement
    expect(overlay.getAttribute('class')).toBe('pdf-mark-note')
    expect(overlay.dataset.color).toBeUndefined()
    expect(overlay.getAttribute('stroke')).toBeTruthy()
    // 旧 rect 也会转换成沿底边的 SVG 虚线。
    expect(Number(overlay.getAttribute('y1'))).toBeGreaterThan(14)
  })

  it('高亮使用所选颜色的半透明底', () => {
    const layer = createLayer()
    const mark = createMark({
      kind: 'highlight',
      color: 'green',
      anchor: {
        format: 'pdf',
        page: 1,
        rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }],
      },
    })

    renderPdfMarkOverlays(layer, [mark], 1, 'light', viewport)
    const overlay = layer.firstElementChild as SVGPolygonElement
    expect(overlay.dataset.color).toBe('green')
    expect(overlay.dataset.markId).toBe('mark-1')
    expect(overlay.getAttribute('fill')).toContain('rgba')
  })

  it('重点附带批注时仍绘制底色，而不是退化为纯批注虚线', () => {
    const layer = createLayer()
    const mark = createMark({
      kind: 'highlight',
      note: '重点说明',
      color: 'blue',
      anchor: {
        format: 'pdf',
        page: 1,
        version: 2,
        quads: [{
          points: [
            { x: 10, y: 90 }, { x: 40, y: 90 }, { x: 40, y: 80 }, { x: 10, y: 80 },
          ],
        }],
      },
    })

    renderPdfMarkOverlays(layer, [mark], 1, 'dark', viewport)

    const overlay = layer.firstElementChild as SVGPolygonElement
    expect(overlay.tagName.toLowerCase()).toBe('polygon')
    expect(overlay.getAttribute('class')).toBe('pdf-mark-highlight')
    expect(overlay.dataset.color).toBe('blue')
  })

  it('按点击位置命中当前页高亮', () => {
    const page = document.createElement('div')
    page.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    const marks: ReadingMark[] = [
      createMark({
        kind: 'highlight',
        anchor: {
          format: 'pdf',
          page: 1,
          rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
        },
      }),
    ]
    expect(findPdfMarksAtPoint(marks, 1, 15, 15, page)).toHaveLength(1)
    expect(findPdfMarksAtPoint(marks, 1, 80, 80, page)).toHaveLength(0)
  })

  it('重复调用时先清空旧 overlay', () => {
    const layer = createLayer()
    const mark = createMark({
      kind: 'highlight',
      anchor: {
        format: 'pdf',
        page: 1,
        rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }],
      },
    })

    renderPdfMarkOverlays(layer, [mark], 1, 'light', viewport)
    // 行内高亮 + 行首旗标
    expect(layer.children).toHaveLength(2)

    renderPdfMarkOverlays(layer, [], 1, 'light', viewport)
    expect(layer.children).toHaveLength(0)
  })

  it('V2 PDF Quad 通过 viewport 转换后绘制', () => {
    const layer = createLayer()
    const mark = createMark({
      kind: 'highlight',
      anchor: {
        format: 'pdf',
        page: 1,
        version: 2,
        quads: [{
          points: [
            { x: 10, y: 90 },
            { x: 40, y: 90 },
            { x: 40, y: 80 },
            { x: 10, y: 80 },
          ],
        }],
      },
    })

    renderPdfMarkOverlays(layer, [mark], 1, 'light', viewport)
    expect(layer.firstElementChild?.getAttribute('points')).toBe('10,10 40,10 40,20 10,20')
  })

  it('缩放后按新 viewport 重新投影 V2 PDF Quad', () => {
    const layer = createLayer()
    const scaledViewport = {
      width: 200,
      height: 200,
      convertToViewportPoint: (x: number, y: number) => [x * 2, 200 - y * 2],
    } as PageViewport
    const mark = createMark({
      kind: 'highlight',
      anchor: {
        format: 'pdf',
        page: 1,
        version: 2,
        quads: [{
          points: [
            { x: 10, y: 90 }, { x: 40, y: 90 }, { x: 40, y: 80 }, { x: 10, y: 80 },
          ],
        }],
      },
    })

    renderPdfMarkOverlays(layer, [mark], 1, 'light', scaledViewport)

    expect(layer.getAttribute('viewBox')).toBe('0 0 200 200')
    expect(layer.firstElementChild?.getAttribute('points')).toBe('20,20 80,20 80,40 20,40')
  })

  it('临时选区使用独立图形且不会参与持久标记命中', () => {
    const layer = createLayer()
    const selection: PdfSelectionSnapshot = {
      page: 1,
      text: '临时选区',
      rect: new DOMRect(10, 10, 30, 10),
      rects: [],
      toolbarX: 25,
      toolbarY: 10,
      quads: [{
        points: [
          { x: 10, y: 90 }, { x: 40, y: 90 }, { x: 40, y: 80 }, { x: 10, y: 80 },
        ],
      }],
    }

    renderPdfMarkOverlays(layer, [], 1, 'light', viewport, selection)

    const overlay = layer.firstElementChild as SVGPolygonElement
    expect(overlay.getAttribute('class')).toBe('pdf-mark-transient-selection')
    expect(overlay.dataset.markId).toBeUndefined()

    renderPdfMarkOverlays(layer, [], 1, 'light', viewport, null)
    expect(layer.children).toHaveLength(0)
  })

  it('使用 SVG 的实际图形命中 V2 标记', () => {
    const page = document.createElement('div')
    page.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    const layer = createLayer()
    layer.classList.add('pdf-marks-layer')
    layer.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    page.append(layer)
    const mark = createMark({
      kind: 'highlight',
      anchor: {
        format: 'pdf',
        page: 1,
        version: 2,
        quads: [{
          points: [
            { x: 10, y: 90 }, { x: 40, y: 90 }, { x: 40, y: 80 }, { x: 10, y: 80 },
          ],
        }],
      },
    })
    renderPdfMarkOverlays(layer, [mark], 1, 'light', viewport)

    expect(findPdfMarksAtPoint([mark], 1, 20, 15, page)).toEqual([mark])
    expect(findPdfMarksAtPoint([mark], 1, 80, 80, page)).toEqual([])
  })

  it('M2 旗标：行首圆点带分类色与 markId，批注/高亮都有、书签没有', () => {
    const layer = createLayer()
    const marks: ReadingMark[] = [
      createMark({
        id: 'flag-hl',
        kind: 'highlight',
        category: 'concept',
        anchor: {
          format: 'pdf',
          page: 1,
          version: 2,
          quads: [{
            points: [
              { x: 10, y: 90 }, { x: 40, y: 90 }, { x: 40, y: 80 }, { x: 10, y: 80 },
            ],
          }],
        },
      }),
      createMark({
        id: 'flag-note',
        kind: 'note',
        category: 'method',
        anchor: {
          format: 'pdf',
          page: 1,
          rects: [{ x: 0.2, y: 0.3, width: 0.3, height: 0.04 }],
        },
      }),
      createMark({
        id: 'flag-bm',
        kind: 'bookmark',
        anchor: { format: 'pdf', page: 1 },
      }),
    ];

    renderPdfMarkOverlays(layer, marks, 1, 'light', viewport)

    const flags = [...layer.querySelectorAll('circle.pdf-mark-flag')]
    expect(flags.map((flag) => (flag as SVGCircleElement).dataset.markId).sort()).toEqual([
      'flag-hl',
      'flag-note',
    ])
    // 分类色：happy-dom 无主题变量时回落字面值（concept #7c6aed）
    expect(flags[0]?.getAttribute('fill')).toBe('#7c6aed')
    // 行首外侧：圆心 x 小于 quad 左缘
    expect(Number(flags[0]?.getAttribute('cx'))).toBeLessThan(10)
  })

  it('Q4 决议：深色主题旗标统一荧光黄', () => {
    const layer = createLayer()
    const mark = createMark({
      kind: 'highlight',
      category: 'concept',
      anchor: {
        format: 'pdf',
        page: 1,
        rects: [{ x: 0.2, y: 0.3, width: 0.3, height: 0.04 }],
      },
    })
    renderPdfMarkOverlays(layer, [mark], 1, 'dark', viewport)
    expect(layer.querySelector('circle.pdf-mark-flag')?.getAttribute('fill')).toBe('#fde047')
    renderPdfMarkOverlays(layer, [mark], 1, 'light', viewport)
    expect(layer.querySelector('circle.pdf-mark-flag')?.getAttribute('fill')).toBe('#7c6aed')
  })

  it('M2 旗标：点击圆点命中标记，单页上限 40', () => {
    const page = document.createElement('div')
    page.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    const layer = createLayer()
    layer.classList.add('pdf-marks-layer')
    layer.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    page.append(layer)
    const mark = createMark({
      kind: 'highlight',
      anchor: {
        format: 'pdf',
        page: 1,
        version: 2,
        quads: [{
          points: [
            { x: 10, y: 90 }, { x: 40, y: 90 }, { x: 40, y: 80 }, { x: 10, y: 80 },
          ],
        }],
      },
    })
    renderPdfMarkOverlays(layer, [mark], 1, 'light', viewport)
    const flag = layer.querySelector('circle.pdf-mark-flag') as SVGCircleElement
    const cx = Number(flag.getAttribute('cx'))
    const cy = Number(flag.getAttribute('cy'))
    expect(findPdfMarksAtPoint([mark], 1, cx, cy, page)).toEqual([mark])

    const many: ReadingMark[] = Array.from({ length: 45 }, (_, index) =>
      createMark({
        id: `cap-${index}`,
        kind: 'highlight',
        anchor: {
          format: 'pdf',
          page: 1,
          rects: [{ x: 0.1, y: 0.01 * index, width: 0.2, height: 0.005 }],
        },
      }),
    )
    renderPdfMarkOverlays(layer, many, 1, 'light', viewport)
    expect(layer.querySelectorAll('circle.pdf-mark-flag')).toHaveLength(40)
  })

  it('flagSpotForQuads 行首钳制在页内', () => {
    const spot = flagSpotForQuads(
      [{ points: [{ x: 1, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 1, y: 20 }] }],
      100,
    )
    expect(spot).not.toBeNull()
    expect(spot!.x).toBeGreaterThanOrEqual(spot!.r + 1)
    expect(spot!.y).toBe(15)
    expect(flagSpotForQuads([], 100)).toBeNull()
  })
})
