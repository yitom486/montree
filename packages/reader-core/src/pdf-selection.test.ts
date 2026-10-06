// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  PdfTextLayerMappingSink,
  coalescePdfTextQuads,
  coalescePdfLineRects,
  normalizeClientRects,
  readPdfSelection,
  registerPdfPageTextGeometry,
  unionClientRects,
} from '@montree/reader-core'
import type { PageViewport } from 'pdfjs-dist'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'

describe('normalizeClientRects', () => {
  it('将 client rect 转为相对 layer 坐标', () => {
    const layerRect = { left: 100, top: 200, width: 400, height: 800 } as DOMRect
    const clientRects = [{ left: 120, top: 220, width: 80, height: 20 }] as unknown as DOMRectList

    expect(normalizeClientRects(clientRects, layerRect)).toEqual([
      { x: 0.05, y: 0.025, width: 0.2, height: 0.025 },
    ])
  })
})

describe('coalescePdfLineRects', () => {
  it('同行中英混排碎块齐高并横向合并', () => {
    const coalesced = coalescePdfLineRects([
      { x: 0.1, y: 0.2, width: 0.05, height: 0.02 },
      { x: 0.16, y: 0.195, width: 0.08, height: 0.028 },
      { x: 0.25, y: 0.198, width: 0.1, height: 0.022 },
      { x: 0.1, y: 0.35, width: 0.2, height: 0.024 },
    ])

    expect(coalesced).toHaveLength(2)
    expect(coalesced[0]!.y).toBeCloseTo(0.195, 5)
    expect(coalesced[0]!.height).toBeCloseTo(0.028, 5)
    expect(coalesced[0]!.x).toBeCloseTo(0.1, 5)
    expect(coalesced[0]!.width).toBeCloseTo(0.25, 5)
    expect(coalesced[1]!.y).toBeCloseTo(0.35, 5)
  })
})

describe('unionClientRects', () => {
  it('合并多个 client rect', () => {
    const union = unionClientRects([
      new DOMRect(10, 10, 20, 12),
      new DOMRect(30, 10, 20, 12),
      new DOMRect(10, 30, 40, 12),
    ])
    expect(union.left).toBe(10)
    expect(union.top).toBe(10)
    expect(union.width).toBe(40)
    expect(union.height).toBe(32)
  })
})

describe('readPdfSelection', () => {
  it('读取原生选区且不清除高亮，rects 已齐高', () => {
    const page = document.createElement('div')
    const layer = document.createElement('div')
    layer.className = 'textLayer'
    layer.getBoundingClientRect = () => new DOMRect(0, 0, 200, 400)

    const span = document.createElement('span')
    span.textContent = '选中文字'
    layer.append(span)
    page.append(layer)
    document.body.append(page)

    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(span)
    selection.removeAllRanges()
    selection.addRange(range)

    range.getClientRects = () =>
      [
        new DOMRect(10, 20, 30, 12),
        new DOMRect(42, 18, 40, 16),
      ] as unknown as DOMRectList

    const snapshot = readPdfSelection(page, 3)
    expect(snapshot?.text).toBe('选中文字')
    expect(snapshot?.page).toBe(3)
    expect(snapshot?.rects).toHaveLength(1)
    expect(snapshot?.rects[0]!.height).toBeCloseTo(16 / 400, 5)
    expect(selection.rangeCount).toBe(1)

    selection.removeAllRanges()
    page.remove()
  })

  it('用 text item 位置和 transform 生成 V2 PDF Quad', () => {
    const page = document.createElement('div')
    page.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    const layer = document.createElement('div')
    layer.className = 'textLayer'
    layer.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    const span = document.createElement('span')
    span.textContent = 'abcd'
    layer.append(span)
    page.append(layer)
    document.body.append(page)

    const mapping = new PdfTextLayerMappingSink()
    mapping.setTextMapping([span])
    mapping.enable()
    const viewport = {
      width: 100,
      height: 100,
      convertToPdfPoint: (x: number, y: number) => [x, y],
    } as PageViewport
    const unregister = registerPdfPageTextGeometry(page, viewport, {
      items: [{
        str: 'abcd',
        dir: 'ltr',
        transform: [10, 0, 0, 10, 10, 50],
        width: 40,
        height: 10,
        fontName: 'f1',
        hasEOL: false,
      }],
      styles: {
        f1: { ascent: 0.8, descent: -0.2, vertical: false, fontFamily: 'sans-serif' },
      },
      lang: null,
    } as TextContent)

    const range = document.createRange()
    range.setStart(span.firstChild!, 1)
    range.setEnd(span.firstChild!, 3)
    range.getClientRects = () => [new DOMRect(20, 42, 20, 10)] as unknown as DOMRectList
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const snapshot = readPdfSelection(page, 1)
    expect(snapshot?.begin).toEqual({ itemIndex: 0, offset: 1 })
    expect(snapshot?.end).toEqual({ itemIndex: 0, offset: 3 })
    expect(snapshot?.quote?.exact).toBe('bc')
    expect(snapshot?.quads?.[0]?.points).toEqual([
      { x: 20, y: 58 },
      { x: 40, y: 58 },
      { x: 40, y: 48 },
      { x: 20, y: 48 },
    ])

    selection.removeAllRanges()
    unregister()
    page.remove()
  })
})

describe('coalescePdfTextQuads', () => {
  it('按 PDF 基线合并同行并统一高度', () => {
    const result = coalescePdfTextQuads([
      {
        points: [
          { x: 10, y: 60 }, { x: 20, y: 60 }, { x: 20, y: 48 }, { x: 10, y: 48 },
        ],
        baseline: [{ x: 10, y: 50 }, { x: 20, y: 50 }],
      },
      {
        points: [
          { x: 21, y: 58 }, { x: 35, y: 58 }, { x: 35, y: 47 }, { x: 21, y: 47 },
        ],
        baseline: [{ x: 21, y: 50 }, { x: 35, y: 50 }],
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.points).toEqual([
      { x: 10, y: 60 }, { x: 35, y: 60 }, { x: 35, y: 47 }, { x: 10, y: 47 },
    ])
  })
})
