import type { PageViewport } from 'pdfjs-dist'
import type { TextContent, TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api'
import type {
  PdfTextPosition,
  PdfTextQuad,
  PdfTextQuote,
  PdfTextRect,
} from '@montree/contracts'

interface PdfPageTextGeometry {
  viewport: PageViewport
  items: TextItem[]
  styles: Record<string, TextStyle>
}

const pageTextGeometry = new WeakMap<HTMLElement, PdfPageTextGeometry>()

/** TextLayerBuilder 通过 highlighter hook 暴露 text item 与 DOM 的一一映射。 */
export class PdfTextLayerMappingSink {
  private textDivs: HTMLElement[] = []

  setTextMapping(textDivs: HTMLElement[]): void {
    this.textDivs = textDivs
  }

  enable(): void {
    this.textDivs.forEach((textDiv, itemIndex) => {
      textDiv.dataset.pdfTextItemIndex = String(itemIndex)
    })
  }

  disable(): void {
    this.textDivs = []
  }
}

export function registerPdfPageTextGeometry(
  pageElement: HTMLElement,
  viewport: PageViewport,
  textContent: TextContent,
): () => void {
  const items = textContent.items.filter((item): item is TextItem => 'str' in item)
  pageTextGeometry.set(pageElement, {
    viewport,
    items,
    styles: textContent.styles,
  })
  return () => pageTextGeometry.delete(pageElement)
}

export interface PdfSelectionSnapshot {
  text: string
  rect: DOMRect
  /** V1 降级数据：相对 textLayer（或 root）的归一化坐标。 */
  rects: PdfTextRect[]
  /** V2 语义位置，对应 getTextContent().items。 */
  begin?: PdfTextPosition
  end?: PdfTextPosition
  quote?: PdfTextQuote
  /** V2 PDF 页面坐标，不受缩放、旋转和 DPR 影响。 */
  quads?: PdfTextQuad[]
  page: number
  toolbarX: number
  toolbarY: number
}

export function normalizeClientRects(
  clientRects: DOMRectList | DOMRect[],
  layerRect: DOMRect,
): PdfTextRect[] {
  const rects: PdfTextRect[] = []
  const items = 'length' in clientRects ? Array.from(clientRects) : [clientRects]

  for (const rect of items) {
    if (rect.width <= 0 || rect.height <= 0) continue
    // 过滤异常碎块（偶发 0 宽高比的幽灵框）
    if (rect.width < 0.5 || rect.height < 0.5) continue
    rects.push({
      x: (rect.left - layerRect.left) / layerRect.width,
      y: (rect.top - layerRect.top) / layerRect.height,
      width: rect.width / layerRect.width,
      height: rect.height / layerRect.height,
    })
  }

  return rects
}

/**
 * 将同一视觉行的碎矩形齐高、并横向合并。
 * PDF text layer 中英混排时 getClientRects 高度不一致，直接画会呈锯齿。
 */
export function coalescePdfLineRects(
  rects: PdfTextRect[],
  yToleranceRatio = 0.55,
  xGap = 0.012,
): PdfTextRect[] {
  if (rects.length <= 1) return rects.map((rect) => ({ ...rect }))

  const sorted = [...rects].sort(
    (a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x,
  )
  const groups: PdfTextRect[][] = []

  for (const rect of sorted) {
    const mid = rect.y + rect.height / 2
    const group = groups.find((items) => {
      const sample = items[0]!
      const sampleMid = sample.y + sample.height / 2
      const tol = Math.max(sample.height, rect.height) * yToleranceRatio
      return Math.abs(sampleMid - mid) <= tol
    })
    if (group) group.push(rect)
    else groups.push([rect])
  }

  const result: PdfTextRect[] = []
  for (const group of groups) {
    const top = Math.min(...group.map((item) => item.y))
    const bottom = Math.max(...group.map((item) => item.y + item.height))
    const height = Math.max(bottom - top, 0)
    const byX = [...group].sort((a, b) => a.x - b.x)

    for (const rect of byX) {
      const prev = result[result.length - 1]
      const sameLine =
        prev &&
        Math.abs(prev.y - top) < 1e-6 &&
        Math.abs(prev.height - height) < 1e-6
      if (sameLine && rect.x <= prev.x + prev.width + xGap) {
        const right = Math.max(prev.x + prev.width, rect.x + rect.width)
        prev.x = Math.min(prev.x, rect.x)
        prev.width = right - prev.x
      } else {
        result.push({ x: rect.x, y: top, width: rect.width, height })
      }
    }
  }

  return result
}

export function unionClientRects(clientRects: DOMRect[]): DOMRect {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const rect of clientRects) {
    if (rect.width <= 0 || rect.height <= 0) continue
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }

  if (!Number.isFinite(left)) {
    return new DOMRect(0, 0, 0, 0)
  }

  return new DOMRect(left, top, right - left, bottom - top)
}

function readRangeClientRects(range: Range): DOMRect[] {
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5)
}

function resolveSelectionLayer(rootElement: HTMLElement): HTMLElement {
  const textLayer = rootElement.querySelector('.textLayer')
  return textLayer instanceof HTMLElement ? textLayer : rootElement
}

function resolveBoundaryTextDiv(
  node: Node,
  offset: number,
  preferPrevious: boolean,
): HTMLElement | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  if (element instanceof HTMLElement) {
    const direct = element.closest<HTMLElement>('[data-pdf-text-item-index]')
    if (direct) return direct

    const childIndex = preferPrevious ? Math.max(0, offset - 1) : offset
    const child = element.childNodes.item(childIndex)
    if (child) {
      const childElement = child.nodeType === Node.TEXT_NODE ? child.parentElement : child
      if (childElement instanceof HTMLElement) {
        const nested = childElement.matches('[data-pdf-text-item-index]')
          ? childElement
          : childElement.querySelector<HTMLElement>('[data-pdf-text-item-index]')
        if (nested) return nested
      }
    }
  }
  return null
}

function offsetInsideTextDiv(textDiv: HTMLElement, node: Node, offset: number): number {
  if (node === textDiv) return Math.max(0, offset)
  try {
    const range = textDiv.ownerDocument.createRange()
    range.selectNodeContents(textDiv)
    range.setEnd(node, offset)
    return range.toString().length
  } catch {
    return 0
  }
}

function resolveTextPosition(
  node: Node,
  offset: number,
  geometry: PdfPageTextGeometry,
  preferPrevious: boolean,
): PdfTextPosition | null {
  const textDiv = resolveBoundaryTextDiv(node, offset, preferPrevious)
  if (!textDiv) return null
  const itemIndex = Number.parseInt(textDiv.dataset.pdfTextItemIndex ?? '', 10)
  const item = geometry.items[itemIndex]
  if (!Number.isInteger(itemIndex) || !item) return null
  return {
    itemIndex,
    offset: Math.min(Math.max(offsetInsideTextDiv(textDiv, node, offset), 0), item.str.length),
  }
}

function quoteForPositions(
  geometry: PdfPageTextGeometry,
  begin: PdfTextPosition,
  end: PdfTextPosition,
  exact: string,
): PdfTextQuote {
  const itemStarts: number[] = []
  let total = 0
  for (const item of geometry.items) {
    itemStarts.push(total)
    total += item.str.length
  }
  const pageText = geometry.items.map((item) => item.str).join('')
  const start = (itemStarts[begin.itemIndex] ?? 0) + begin.offset
  const finish = (itemStarts[end.itemIndex] ?? start) + end.offset
  return {
    exact,
    prefix: pageText.slice(Math.max(0, start - 32), start) || undefined,
    suffix: pageText.slice(finish, finish + 32) || undefined,
  }
}

function point(x: number, y: number): { x: number; y: number } {
  return { x, y }
}

function buildTextItemQuad(
  item: TextItem,
  style: TextStyle | undefined,
  startOffset: number,
  endOffset: number,
): PdfTextQuad | null {
  if (!item.str || endOffset <= startOffset || style?.vertical) return null
  const [a, b, c, d, e, f] = item.transform.map(Number)
  if (![a, b, c, d, e, f, item.width].every(Number.isFinite)) return null

  const directionLength = Math.hypot(a, b)
  const verticalLength = Math.hypot(c, d)
  if (directionLength <= 0 || verticalLength <= 0 || item.width <= 0) return null

  const directionX = a / directionLength
  const directionY = b / directionLength
  const verticalX = c / verticalLength
  const verticalY = d / verticalLength
  const fontHeight = Math.abs(item.height) || verticalLength
  const ascent = Number.isFinite(style?.ascent) ? style!.ascent : 0.8
  const descent = Number.isFinite(style?.descent) ? style!.descent : -0.2
  const length = Math.max(item.str.length, 1)

  let startRatio = startOffset / length
  let endRatio = endOffset / length
  if (item.dir === 'rtl') {
    const visualStart = 1 - endRatio
    endRatio = 1 - startRatio
    startRatio = visualStart
  }

  const startX = e + directionX * item.width * startRatio
  const startY = f + directionY * item.width * startRatio
  const endX = e + directionX * item.width * endRatio
  const endY = f + directionY * item.width * endRatio
  const topX = verticalX * fontHeight * ascent
  const topY = verticalY * fontHeight * ascent
  const bottomX = verticalX * fontHeight * descent
  const bottomY = verticalY * fontHeight * descent

  return {
    points: [
      point(startX + topX, startY + topY),
      point(endX + topX, endY + topY),
      point(endX + bottomX, endY + bottomY),
      point(startX + bottomX, startY + bottomY),
    ],
    baseline: [point(startX, startY), point(endX, endY)],
  }
}

/** 常见横排 PDF 按基线归行，并在 PDF 坐标中统一同行高度。 */
export function coalescePdfTextQuads(quads: PdfTextQuad[]): PdfTextQuad[] {
  const horizontal: PdfTextQuad[] = []
  const other: PdfTextQuad[] = []
  for (const quad of quads) {
    const baseline = quad.baseline
    const height = Math.hypot(
      quad.points[0].x - quad.points[3].x,
      quad.points[0].y - quad.points[3].y,
    )
    if (baseline && Math.abs(baseline[1].y - baseline[0].y) <= Math.max(0.5, height * 0.15)) {
      horizontal.push(quad)
    } else {
      other.push(quad)
    }
  }

  const groups: PdfTextQuad[][] = []
  for (const quad of horizontal.sort((left, right) => right.baseline![0].y - left.baseline![0].y)) {
    const baselineY = (quad.baseline![0].y + quad.baseline![1].y) / 2
    const height = Math.abs(quad.points[0].y - quad.points[3].y)
    const group = groups.find((candidate) => {
      const sample = candidate[0]!
      const sampleY = (sample.baseline![0].y + sample.baseline![1].y) / 2
      const sampleHeight = Math.abs(sample.points[0].y - sample.points[3].y)
      return Math.abs(sampleY - baselineY) <= Math.max(0.75, Math.max(height, sampleHeight) * 0.35)
    })
    if (group) group.push(quad)
    else groups.push([quad])
  }

  const merged: PdfTextQuad[] = []
  for (const group of groups) {
    const top = Math.max(...group.flatMap((quad) => [quad.points[0].y, quad.points[1].y]))
    const bottom = Math.min(...group.flatMap((quad) => [quad.points[2].y, quad.points[3].y]))
    const baselineY = group.reduce(
      (sum, quad) => sum + (quad.baseline![0].y + quad.baseline![1].y) / 2,
      0,
    ) / group.length
    const height = Math.max(top - bottom, 1)
    const segments = group
      .map((quad) => ({
        left: Math.min(...quad.points.map((item) => item.x)),
        right: Math.max(...quad.points.map((item) => item.x)),
      }))
      .sort((left, right) => left.left - right.left)

    for (const segment of segments) {
      const previous = merged[merged.length - 1]
      const previousBaseline = previous?.baseline
      const previousRight = previous ? Math.max(...previous.points.map((item) => item.x)) : 0
      if (
        previous &&
        previousBaseline &&
        Math.abs(previousBaseline[0].y - baselineY) < 1e-6 &&
        segment.left <= previousRight + height * 0.55
      ) {
        previous.points[1].x = Math.max(previous.points[1].x, segment.right)
        previous.points[2].x = Math.max(previous.points[2].x, segment.right)
        previous.baseline![1].x = Math.max(previous.baseline![1].x, segment.right)
      } else {
        merged.push({
          points: [
            point(segment.left, top),
            point(segment.right, top),
            point(segment.right, bottom),
            point(segment.left, bottom),
          ],
          baseline: [point(segment.left, baselineY), point(segment.right, baselineY)],
        })
      }
    }
  }
  return [...merged, ...other]
}

function quadsFromTextItems(
  geometry: PdfPageTextGeometry,
  begin: PdfTextPosition,
  end: PdfTextPosition,
): PdfTextQuad[] | null {
  const quads: PdfTextQuad[] = []
  for (let itemIndex = begin.itemIndex; itemIndex <= end.itemIndex; itemIndex += 1) {
    const item = geometry.items[itemIndex]
    if (!item) return null
    const startOffset = itemIndex === begin.itemIndex ? begin.offset : 0
    const endOffset = itemIndex === end.itemIndex ? end.offset : item.str.length
    if (endOffset <= startOffset) continue
    const quad = buildTextItemQuad(item, geometry.styles[item.fontName], startOffset, endOffset)
    if (!quad) return null
    quads.push(quad)
  }
  return quads.length > 0 ? coalescePdfTextQuads(quads) : null
}

function quadsFromClientRects(
  clientRects: DOMRect[],
  geometry: PdfPageTextGeometry,
  pageRect: DOMRect,
): PdfTextQuad[] {
  return clientRects.map((rect) => {
    const left = rect.left - pageRect.left
    const right = rect.right - pageRect.left
    const top = rect.top - pageRect.top
    const bottom = rect.bottom - pageRect.top
    const [topLeftX, topLeftY] = geometry.viewport.convertToPdfPoint(left, top)
    const [topRightX, topRightY] = geometry.viewport.convertToPdfPoint(right, top)
    const [bottomRightX, bottomRightY] = geometry.viewport.convertToPdfPoint(right, bottom)
    const [bottomLeftX, bottomLeftY] = geometry.viewport.convertToPdfPoint(left, bottom)
    return {
      points: [
        point(topLeftX, topLeftY),
        point(topRightX, topRightY),
        point(bottomRightX, bottomRightY),
        point(bottomLeftX, bottomLeftY),
      ],
    }
  })
}

/** 将 Range 的 client rects 规范为齐高的页面相对矩形 */
export function rectsFromPdfRange(range: Range, layerElement: HTMLElement): PdfTextRect[] {
  const clientRects = readRangeClientRects(range)
  if (clientRects.length === 0) return []
  const layerRect = layerElement.getBoundingClientRect()
  if (layerRect.width <= 0 || layerRect.height <= 0) return []
  return coalescePdfLineRects(normalizeClientRects(clientRects, layerRect))
}

/** 读取当前原生 Selection；V2 优先从 text item transform 生成 PDF 坐标 Quad。 */
export function buildPdfSnapshotFromRange(
  rootElement: HTMLElement,
  pageNum: number,
  range: Range,
  text?: string,
): PdfSelectionSnapshot | null {
  if (!rootElement.contains(range.commonAncestorContainer)) return null

  const rawText = text ?? range.toString()
  const resolvedText = rawText.trim()
  if (!resolvedText) return null

  const clientRects = readRangeClientRects(range)
  if (clientRects.length === 0) return null

  const layerElement = resolveSelectionLayer(rootElement)
  const rects = rectsFromPdfRange(range, layerElement)
  if (rects.length === 0) return null

  const rect = unionClientRects(clientRects)
  const geometry = pageTextGeometry.get(rootElement)
  const begin = geometry
    ? resolveTextPosition(range.startContainer, range.startOffset, geometry, false)
    : null
  const end = geometry
    ? resolveTextPosition(range.endContainer, range.endOffset, geometry, true)
    : null
  const quads = geometry
    ? begin && end
      ? quadsFromTextItems(geometry, begin, end) ??
        quadsFromClientRects(clientRects, geometry, rootElement.getBoundingClientRect())
      : quadsFromClientRects(clientRects, geometry, rootElement.getBoundingClientRect())
    : undefined
  const quote = geometry && begin && end
    ? quoteForPositions(geometry, begin, end, rawText)
    : undefined

  return {
    text: resolvedText,
    rect,
    rects,
    begin: begin ?? undefined,
    end: end ?? undefined,
    quote,
    quads,
    page: pageNum,
    toolbarX: rect.left + rect.width / 2,
    toolbarY: rect.top,
  }
}

export function readPdfSelection(
  rootElement: HTMLElement,
  pageNum: number,
): PdfSelectionSnapshot | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  return buildPdfSnapshotFromRange(rootElement, pageNum, range)
}

export function getSelectionToolbarPosition(snapshot: PdfSelectionSnapshot): {
  x: number
  y: number
} {
  return { x: snapshot.toolbarX, y: snapshot.toolbarY }
}

export { copyTextToClipboard } from './epub-selection'
