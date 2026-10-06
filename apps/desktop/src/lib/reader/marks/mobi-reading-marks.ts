import type { PdfTextRect, ReadingAnchor, ReadingMark } from '@montree/contracts'
import { applyHighlightSurface } from '@montree/reader-core'
import { getMarkLayerMetrics, normalizeRectsInScrollDocument } from '@montree/reader-core'
import { normalizeWebDocNavUrl } from '@montree/reader-core'

const MARK_SELECTOR = '.mobi-mark-highlight, .mobi-mark-note, .mobi-mark-note-hit'

function anchorRects(anchor: ReadingAnchor): PdfTextRect[] | undefined {
  if (anchor.format === 'pdf' || anchor.format === 'mobi' || anchor.format === 'web') {
    return anchor.rects
  }
  return undefined
}

function pointInClientRect(x: number, y: number, rect: DOMRect, padding = 0): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  )
}

function findMarkElement(doc: Document, clientX: number, clientY: number): HTMLElement | null {
  const hit = doc.elementFromPoint(clientX, clientY)
  // 网页/MOBI 正文位于 iframe 时，不能用外层窗口的 HTMLElement 做 instanceof。
  // 跨 Window realm 会使真实元素被误判为非 HTMLElement。
  if (hit?.nodeType === 1) {
    const marked = (hit as HTMLElement).closest<HTMLElement>(
      '.mobi-mark-highlight[data-mark-id], .mobi-mark-note[data-mark-id], .mobi-mark-note-hit[data-mark-id]',
    )
    if (marked?.dataset.markId) return marked
  }

  const body = doc.body
  if (!body) return null

  for (const element of body.querySelectorAll<HTMLElement>(
    'span.mobi-mark-highlight[data-mark-id], span.mobi-mark-note[data-mark-id], .mobi-mark-highlight[data-mark-id], .mobi-mark-note-hit[data-mark-id]',
  )) {
    if (pointInClientRect(clientX, clientY, element.getBoundingClientRect(), 4)) {
      return element
    }
  }

  return null
}

function unwrapMarkElement(element: Element): void {
  const parent = element.parentNode
  if (!parent) {
    element.remove()
    return
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

export function clearMobiMarkOverlays(container: HTMLElement | null): void {
  if (!container) return

  container.querySelectorAll(MARK_SELECTOR).forEach((node) => {
    if (node.id === 'reader-mark-layer') {
      node.replaceChildren()
      return
    }
    // 不能用 instanceof HTMLSpanElement：iframe 内的 span 属于 iframe 自己的 Window。
    if (node.tagName === 'SPAN') {
      unwrapMarkElement(node)
      return
    }
    node.remove()
  })

  container.querySelector('#reader-mark-layer')?.replaceChildren()
}

function getMarkSearchText(mark: ReadingMark): string {
  if (mark.anchor.format !== 'mobi' && mark.anchor.format !== 'web') return ''
  return (mark.excerpt ?? mark.anchor.selectedText ?? '').trim()
}

import {
  excerptSearchCandidates,
  findTextRangeInRoot,
} from '@/lib/reader/marks/excerpt-text-match'

function wrapMarkRange(
  range: Range,
  className: string,
  markId: string,
  color: string | undefined,
  theme: 'dark' | 'light' | 'sepia',
): boolean {
  const span = (range.startContainer.ownerDocument ?? document).createElement('span')
  span.className = className
  span.dataset.markId = markId
  if (className === 'mobi-mark-highlight' || className === 'mobi-mark-note') {
    applyHighlightSurface(span, color, theme)
  }

  try {
    range.surroundContents(span)
    return true
  } catch {
    const extracted = range.extractContents()
    span.appendChild(extracted)
    range.insertNode(span)
    return true
  }
}

function applyMobiTextMark(
  root: HTMLElement,
  mark: ReadingMark,
  theme: 'dark' | 'light' | 'sepia',
): boolean {
  const searchText = getMarkSearchText(mark)
  if (!searchText) return false

  const range = findTextRangeInRoot(root, searchText)
  if (!range) return false

  const className = mark.kind === 'note' ? 'mobi-mark-note' : 'mobi-mark-highlight'
  return wrapMarkRange(range, className, mark.id, mark.color, theme)
}

function liveRectsFromMarkText(root: HTMLElement, mark: ReadingMark): PdfTextRect[] | undefined {
  const searchText = getMarkSearchText(mark)
  if (!searchText) return undefined

  const range = findTextRangeInRoot(root, searchText)
  if (!range) return undefined

  const doc = root.ownerDocument
  if (!doc) return undefined

  const clientRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  )
  if (clientRects.length === 0) return undefined

  return normalizeRectsInScrollDocument(clientRects, doc, root)
}

function ensureMarkLayer(body: HTMLElement): HTMLElement {
  let layer = body.querySelector('#reader-mark-layer') as HTMLElement | null
  if (!layer) {
    layer = body.ownerDocument.createElement('div')
    layer.id = 'reader-mark-layer'
    layer.setAttribute('aria-hidden', 'true')
    body.appendChild(layer)
  }
  const { width, height } = getMarkLayerMetrics(body)
  // 选区保存与 overlay 都以 body 的可滚动内容为坐标系。这里必须显式锁定
  // 尺寸，不能由站点自身的 html/body 高度规则或 100% 百分比接管。
  layer.style.setProperty('width', `${width}px`, 'important')
  layer.style.setProperty('height', `${height}px`, 'important')
  return layer
}

function appendRectOverlay(
  layer: HTMLElement,
  rect: { x: number; y: number; width: number; height: number },
  className: string,
  markId: string,
  interactive: boolean,
  color: string | undefined,
  theme: 'dark' | 'light' | 'sepia',
): void {
  const element = layer.ownerDocument.createElement('div')
  element.className = className
  element.dataset.markId = markId
  element.style.position = 'absolute'
  element.style.left = `${rect.x * 100}%`

  if (interactive) {
    element.classList.add('mobi-mark-note-hit')
    element.style.width = `${rect.width * 100}%`
    element.style.top = `${rect.y * 100}%`
    element.style.height = `${rect.height * 100}%`
  } else {
    element.style.top = `${rect.y * 100}%`
    element.style.width = `${rect.width * 100}%`
    element.style.height = `${rect.height * 100}%`
  }

  element.style.pointerEvents = interactive ? 'auto' : 'none'
  if (className.includes('mobi-mark-highlight') || className.includes('mobi-mark-note')) {
    applyHighlightSurface(element, color, theme)
  }
  layer.appendChild(element)
}

export function renderMobiMarkOverlays(
  container: HTMLElement | null,
  marks: ReadingMark[],
  chapterId: string,
  theme: 'dark' | 'light' | 'sepia' = 'light',
): void {
  renderIframeMarkOverlays(container, marks, (mark) => {
    if (mark.anchor.format !== 'mobi') return false
    return String(mark.anchor.chapterId) === String(chapterId)
  }, theme)
}

export function renderWebMarkOverlays(
  container: HTMLElement | null,
  marks: ReadingMark[],
  pageUrl: string,
  theme: 'dark' | 'light' | 'sepia' = 'light',
): void {
  const normalizedPageUrl = normalizeWebDocNavUrl(pageUrl)
  renderIframeMarkOverlays(container, marks, (mark) => {
    if (mark.anchor.format !== 'web') return false
    return mark.anchor.url === normalizedPageUrl
  }, theme)
}

function renderIframeMarkOverlays(
  container: HTMLElement | null,
  marks: ReadingMark[],
  matchesMark: (mark: ReadingMark) => boolean,
  theme: 'dark' | 'light' | 'sepia' = 'light',
): void {
  if (!container) return
  clearMobiMarkOverlays(container)

  const layer = ensureMarkLayer(container)

  for (const mark of marks) {
    if (!matchesMark(mark)) continue
    if (mark.kind === 'bookmark') continue

    const className = mark.kind === 'note' ? 'mobi-mark-note' : 'mobi-mark-highlight'
    const appliedByText = applyMobiTextMark(container, mark, theme)

    const rects = !appliedByText
      ? liveRectsFromMarkText(container, mark) ?? anchorRects(mark.anchor)
      : undefined

    if (rects && rects.length > 0) {
      for (const rect of rects) {
        appendRectOverlay(
          layer,
          rect,
          className,
          mark.id,
          Boolean(mark.note?.trim()) || mark.kind === 'note',
          mark.color,
          theme,
        )
      }
    }
  }
}

export function findMobiMarksAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): Array<{ markId: string; element: HTMLElement }> {
  const hits: Array<{ markId: string; element: HTMLElement }> = []
  const seen = new Set<string>()
  const primary = findMarkElement(doc, clientX, clientY)
  if (primary?.dataset.markId) {
    hits.push({ markId: primary.dataset.markId, element: primary })
    seen.add(primary.dataset.markId)
  }

  const body = doc.body
  if (!body) return hits
  for (const element of body.querySelectorAll<HTMLElement>('[data-mark-id]')) {
    const markId = element.dataset.markId
    if (!markId || seen.has(markId)) continue
    if (!pointInClientRect(clientX, clientY, element.getBoundingClientRect(), 4)) continue
    seen.add(markId)
    hits.push({ markId, element })
  }
  return hits
}

/** 批注对话框打开期间：用 rect 叠层顶替失焦后消失的原生选区 */
export const MOBI_PENDING_SELECTION_ID = '__montree-pending-selection__'

export function removeMobiPendingSelectionHighlight(container: HTMLElement | null): void {
  if (!container) return
  container
    .querySelectorAll(`[data-mark-id="${MOBI_PENDING_SELECTION_ID}"]`)
    .forEach((node) => node.remove())
}

export function applyMobiPendingSelectionHighlight(
  container: HTMLElement | null,
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  theme: 'dark' | 'light' | 'sepia',
): void {
  if (!container || rects.length === 0) return
  removeMobiPendingSelectionHighlight(container)
  const layer = ensureMarkLayer(container)
  for (const rect of rects) {
    appendRectOverlay(
      layer,
      rect,
      'mobi-mark-highlight mobi-mark-pending-selection',
      MOBI_PENDING_SELECTION_ID,
      false,
      'yellow',
      theme,
    )
  }
}

export function findMobiNoteMarkAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): { markId: string; element: HTMLElement } | null {
  // 带笔记的重点也是高亮 span；命中后由调用方检查 mark.note
  return findMobiMarksAtPoint(doc, clientX, clientY)[0] ?? null
}
