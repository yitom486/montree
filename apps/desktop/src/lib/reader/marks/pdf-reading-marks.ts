import type { PageViewport } from 'pdfjs-dist'
import type { PdfTextQuad, PdfTextRect, ReadingMark } from '@montree/contracts'
import {
  LIVE_SELECTION_BACKGROUND,
  highlightFill,
  highlightSwatch,
  normalizeHighlightColor,
  resolveMarkCategorySwatch,
} from '@montree/reader-core'
import { resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'
import {
  buildPdfSnapshotFromRange,
  coalescePdfLineRects,
  type PdfSelectionSnapshot,
} from '@montree/reader-core'

const SVG_NS = 'http://www.w3.org/2000/svg'

interface ViewportPoint {
  x: number
  y: number
}

function viewportPoint(viewport: PageViewport, x: number, y: number): ViewportPoint {
  const [viewportX, viewportY] = viewport.convertToViewportPoint(x, y)
  return { x: viewportX, y: viewportY }
}

function quadToViewport(quad: PdfTextQuad, viewport: PageViewport): {
  points: [ViewportPoint, ViewportPoint, ViewportPoint, ViewportPoint]
  baseline?: [ViewportPoint, ViewportPoint]
} {
  return {
    points: quad.points.map((item) => viewportPoint(viewport, item.x, item.y)) as [
      ViewportPoint,
      ViewportPoint,
      ViewportPoint,
      ViewportPoint,
    ],
    baseline: quad.baseline?.map((item) => viewportPoint(viewport, item.x, item.y)) as
      | [ViewportPoint, ViewportPoint]
      | undefined,
  }
}

function rectToViewportQuad(rect: PdfTextRect, viewport: PageViewport): {
  points: [ViewportPoint, ViewportPoint, ViewportPoint, ViewportPoint]
} {
  const left = rect.x * viewport.width
  const top = rect.y * viewport.height
  const right = (rect.x + rect.width) * viewport.width
  const bottom = (rect.y + rect.height) * viewport.height
  return {
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
  }
}

function appendPolygon(
  layer: SVGSVGElement,
  points: ViewportPoint[],
  options: { className: string; fill: string; markId?: string; color?: string; theme?: string },
): void {
  const polygon = document.createElementNS(SVG_NS, 'polygon')
  polygon.setAttribute('class', options.className)
  polygon.setAttribute('points', points.map(({ x, y }) => `${x},${y}`).join(' '))
  polygon.setAttribute('fill', options.fill)
  if (options.markId) polygon.dataset.markId = options.markId
  if (options.color) polygon.dataset.color = options.color
  if (options.theme) polygon.dataset.theme = options.theme
  layer.append(polygon)
}

function underlineEndpoints(
  quad: ReturnType<typeof quadToViewport> | ReturnType<typeof rectToViewportQuad>,
): [ViewportPoint, ViewportPoint] {
  const baseline = 'baseline' in quad ? quad.baseline : undefined
  const start = baseline?.[0] ?? quad.points[3]
  const end = baseline?.[1] ?? quad.points[2]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  // 视口 y 轴向下；让虚线略低于文字基线，避免穿过字形。
  const normalX = -dy / length
  const normalY = dx / length
  const direction = normalY < 0 ? -1 : 1
  const offset = 1.5
  return [
    { x: start.x + normalX * offset * direction, y: start.y + normalY * offset * direction },
    { x: end.x + normalX * offset * direction, y: end.y + normalY * offset * direction },
  ]
}

function appendUnderline(
  layer: SVGSVGElement,
  quad: ReturnType<typeof quadToViewport> | ReturnType<typeof rectToViewportQuad>,
  mark: ReadingMark,
  theme: 'dark' | 'light' | 'sepia',
): void {
  const [start, end] = underlineEndpoints(quad)
  const line = document.createElementNS(SVG_NS, 'line')
  line.setAttribute('class', 'pdf-mark-note')
  line.setAttribute('x1', String(start.x))
  line.setAttribute('y1', String(start.y))
  line.setAttribute('x2', String(end.x))
  line.setAttribute('y2', String(end.y))
  line.setAttribute('stroke', highlightSwatch(mark.color))
  line.dataset.markId = mark.id
  line.dataset.theme = theme
  layer.append(line)
}

function visualQuadsForMark(
  mark: ReadingMark,
  viewport: PageViewport,
  pageElement?: HTMLElement | null,
): Array<ReturnType<typeof quadToViewport> | ReturnType<typeof rectToViewportQuad>> {
  if (mark.anchor.format !== 'pdf') return []
  if (mark.anchor.quads?.length) {
    return mark.anchor.quads.map((quad) => quadToViewport(quad, viewport))
  }

  // V1-only：缩放后用 selectedText 在 DOM 重找，尽量升到 PDF 用户空间 quads
  const liveText =
    mark.anchor.selectedText?.trim() ||
    (typeof mark.excerpt === 'string' ? mark.excerpt.trim() : '')
  if (pageElement && liveText) {
    const range = findTextRangeInRoot(pageElement, liveText)
    if (range) {
      const snapshot = buildPdfSnapshotFromRange(
        pageElement,
        mark.anchor.page,
        range,
        liveText,
      )
      if (snapshot?.quads?.length) {
        return snapshot.quads.map((quad) => quadToViewport(quad, viewport))
      }
      if (snapshot?.rects.length) {
        return coalescePdfLineRects(snapshot.rects).map((rect) =>
          rectToViewportQuad(rect, viewport),
        )
      }
    }
  }

  return coalescePdfLineRects(mark.anchor.rects ?? []).map((rect) =>
    rectToViewportQuad(rect, viewport),
  )
}

function markFlagCategory(mark: ReadingMark): string {
  return mark.category ?? resolveCardMeta(mark).category
}

function cssVarReader(): (name: string) => string | undefined {
  const rootCS =
    typeof document !== 'undefined'
      ? document.defaultView?.getComputedStyle(document.documentElement)
      : undefined
  return (name: string) => rootCS?.getPropertyValue(name).trim() || undefined
}

/** M2 页边旗标：取首 quad 行首外侧的圆点位置（视口单位），与行内绘制同源。 */
export function flagSpotForQuads(
  quads: Array<ReturnType<typeof quadToViewport> | ReturnType<typeof rectToViewportQuad>>,
  viewportWidth: number,
): { x: number; y: number; r: number } | null {
  const first = quads[0]
  if (!first) return null
  const xs = first.points.map((point) => point.x)
  const ys = first.points.map((point) => point.y)
  const r = Math.min(7, Math.max(3, viewportWidth * 0.006))
  const y = (Math.min(...ys) + Math.max(...ys)) / 2
  const x = Math.max(r + 1, Math.min(...xs) - r * 2.4)
  return { x, y, r }
}

function appendFlag(
  layer: SVGSVGElement,
  spot: { x: number; y: number; r: number },
  mark: ReadingMark,
  fill: string,
): void {
  const flag = document.createElementNS(SVG_NS, 'circle')
  flag.setAttribute('class', 'pdf-mark-flag')
  flag.setAttribute('cx', String(spot.x))
  flag.setAttribute('cy', String(spot.y))
  flag.setAttribute('r', String(spot.r))
  flag.setAttribute('fill', fill)
  flag.setAttribute('stroke', '#ffffff')
  flag.setAttribute('stroke-width', '1')
  flag.dataset.markId = mark.id
  layer.append(flag)
}

export const PDF_MARK_FLAGS_PER_PAGE_CAP = 40

export function renderPdfMarkOverlays(
  layer: SVGSVGElement,
  marks: ReadingMark[],
  pageNum: number,
  theme: 'dark' | 'light' | 'sepia',
  viewport: PageViewport,
  transientSelection?: PdfSelectionSnapshot | null,
  pageElement?: HTMLElement | null,
): void {
  layer.replaceChildren()
  layer.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`)
  const getVar = cssVarReader()

  let flagsDrawn = 0
  for (const mark of marks) {
    if (mark.anchor.format !== 'pdf' || mark.anchor.page !== pageNum) continue
    if (mark.kind === 'bookmark') continue

    const quads = visualQuadsForMark(mark, viewport, pageElement)
    for (const quad of quads) {
      if (mark.kind === 'note') {
        appendUnderline(layer, quad, mark, theme)
      } else {
        const color = normalizeHighlightColor(mark.color)
        appendPolygon(layer, quad.points, {
          className: 'pdf-mark-highlight',
          fill: highlightFill(color, theme),
          markId: mark.id,
          color,
          theme,
        })
      }
    }
    if (flagsDrawn < PDF_MARK_FLAGS_PER_PAGE_CAP) {
      const spot = flagSpotForQuads(quads, viewport.width)
      if (spot) {
        appendFlag(
          layer,
          spot,
          mark,
          resolveMarkCategorySwatch(markFlagCategory(mark), getVar, theme),
        )
        flagsDrawn += 1
      }
    }
  }

  if (transientSelection?.page === pageNum) {
    const transientQuads = transientSelection.quads?.length
      ? transientSelection.quads.map((quad) => quadToViewport(quad, viewport))
      : transientSelection.rects.map((rect) => rectToViewportQuad(rect, viewport))
    for (const quad of transientQuads) {
      appendPolygon(layer, quad.points, {
        className: 'pdf-mark-transient-selection',
        fill: LIVE_SELECTION_BACKGROUND,
      })
    }
  }
}

function parsePoints(value: string): ViewportPoint[] {
  return value
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => ({ x: x!, y: y! }))
}

function pointInPolygon(point: ViewportPoint, polygon: ViewportPoint[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]!
    const previousPoint = polygon[previous]!
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || Number.EPSILON) +
          currentPoint.x
    if (crosses) inside = !inside
  }
  return inside
}

function distanceToSegment(point: ViewportPoint, start: ViewportPoint, end: ViewportPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const ratio = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  )
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy))
}

function findRenderedMarkIdsAtPoint(
  pageElement: HTMLElement,
  clientX: number,
  clientY: number,
): Set<string> | null {
  const layer = pageElement.querySelector<SVGSVGElement>('svg.pdf-marks-layer')
  if (!layer) return null
  const pageBox = layer.getBoundingClientRect()
  const fallbackBox = pageElement.getBoundingClientRect()
  const box = pageBox.width > 0 && pageBox.height > 0 ? pageBox : fallbackBox
  if (box.width <= 0 || box.height <= 0) return new Set()
  const viewBox = (layer.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
  const width = viewBox[2] || box.width
  const height = viewBox[3] || box.height
  const point = {
    x: ((clientX - box.left) / box.width) * width,
    y: ((clientY - box.top) / box.height) * height,
  }
  const ids = new Set<string>()
  for (const element of layer.querySelectorAll<SVGElement>('[data-mark-id]')) {
    const markId = element.dataset.markId
    if (!markId) continue
    if (element.tagName.toLowerCase() === 'polygon') {
      if (pointInPolygon(point, parsePoints(element.getAttribute('points') ?? ''))) ids.add(markId)
    } else if (element.tagName.toLowerCase() === 'line') {
      const start = { x: Number(element.getAttribute('x1')), y: Number(element.getAttribute('y1')) }
      const end = { x: Number(element.getAttribute('x2')), y: Number(element.getAttribute('y2')) }
      if (distanceToSegment(point, start, end) <= 5) ids.add(markId)
    } else if (element.tagName.toLowerCase() === 'circle') {
      const center = {
        x: Number(element.getAttribute('cx')),
        y: Number(element.getAttribute('cy')),
      }
      const radius = Number(element.getAttribute('r')) || 4
      if (Math.hypot(point.x - center.x, point.y - center.y) <= radius + 2) ids.add(markId)
    }
  }
  return ids
}

function pointInRect(x: number, y: number, rect: PdfTextRect, padY = 0): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y - padY &&
    y <= rect.y + rect.height + padY
  )
}

export function findPdfMarksAtPoint(
  marks: ReadingMark[],
  pageNum: number,
  clientX: number,
  clientY: number,
  pageElement: HTMLElement,
): ReadingMark[] {
  const renderedIds = findRenderedMarkIdsAtPoint(pageElement, clientX, clientY)
  if (renderedIds) {
    return marks.filter(
      (mark) =>
        mark.anchor.format === 'pdf' &&
        mark.anchor.page === pageNum &&
        renderedIds.has(mark.id),
    )
  }

  // 未挂载 SVG 的旧测试/降级路径。
  const box = pageElement.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return []
  const x = (clientX - box.left) / box.width
  const y = (clientY - box.top) / box.height
  return marks.filter((mark) => {
    if (mark.anchor.format !== 'pdf' || mark.anchor.page !== pageNum) return false
    if (mark.kind === 'bookmark' || !mark.anchor.rects?.length) return false
    const padY = mark.kind === 'note' ? 0.008 : 0
    return coalescePdfLineRects(mark.anchor.rects).some((rect) => pointInRect(x, y, rect, padY))
  })
}

/** 优先返回带批注文案的标记（hover 气泡）。 */
export function findPdfNoteMarkAtPoint(
  marks: ReadingMark[],
  pageNum: number,
  clientX: number,
  clientY: number,
  pageElement: HTMLElement,
): ReadingMark | null {
  const hits = findPdfMarksAtPoint(marks, pageNum, clientX, clientY, pageElement)
  return hits.find((mark) => Boolean(mark.note?.trim())) ?? null
}
