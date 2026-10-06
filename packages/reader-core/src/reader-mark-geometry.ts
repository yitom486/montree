import type { PdfTextRect } from '@montree/contracts'

import {
  applyHighlightSurface,
  highlightFill,
  liveSelectionCss,
} from './reading-mark-colors'

export function getReaderScrollRoot(doc: Document): HTMLElement {
  const scrolling = doc.scrollingElement
  if (scrolling instanceof HTMLElement) return scrolling
  return doc.documentElement
}

/** 与 #reader-mark-layer 高度计算保持一致 */
export function getMarkLayerMetrics(contentRoot: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(contentRoot.clientWidth, contentRoot.scrollWidth, contentRoot.offsetWidth),
    height: Math.max(contentRoot.clientHeight, contentRoot.scrollHeight, contentRoot.offsetHeight),
  }
}

/** 将选区坐标转为相对 contentRoot 滚动内容的 0–1 比例（MOBI / 在线文档 iframe 内使用） */
export function normalizeRectsInScrollDocument(
  clientRects: DOMRectList | DOMRect[],
  _doc: Document,
  contentRoot: HTMLElement,
): PdfTextRect[] {
  const items = 'length' in clientRects ? Array.from(clientRects) : [clientRects]
  const contentRect = contentRoot.getBoundingClientRect()
  const { width, height } = getMarkLayerMetrics(contentRoot)

  if (width <= 0 || height <= 0) return []

  const rects: PdfTextRect[] = []
  for (const rect of items) {
    if (rect.width <= 0 || rect.height <= 0) continue
    rects.push({
      x: (rect.left - contentRect.left) / width,
      y: (rect.top - contentRect.top) / height,
      width: rect.width / width,
      height: rect.height / height,
    })
  }
  return rects
}

export function buildMobiMarkStylesCss(theme: 'dark' | 'light' | 'sepia'): string {
  const highlight = highlightFill('yellow', theme)
  const noteStroke = theme === 'dark' ? '#fbbf24' : '#d97706'

  return `
    ${liveSelectionCss()}
    body {
      position: relative !important;
    }
    #reader-mark-layer {
      position: absolute !important;
      inset: 0 auto auto 0 !important;
      pointer-events: none !important;
      z-index: 4 !important;
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
    }
    span.mobi-mark-highlight,
    #reader-mark-layer .mobi-mark-highlight {
      border-radius: 2px;
      background: ${highlight} !important;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      cursor: pointer;
    }
    span.mobi-mark-note {
      background: transparent !important;
      border-bottom: none !important;
      text-decoration-line: underline !important;
      text-decoration-style: dashed !important;
      text-decoration-color: ${noteStroke} !important;
      text-decoration-thickness: 2px !important;
      text-underline-offset: 3px !important;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      cursor: pointer;
      pointer-events: auto !important;
    }
    #reader-mark-layer .mobi-mark-note-hit {
      background: transparent !important;
      pointer-events: auto !important;
    }
    #reader-mark-layer .mobi-mark-note-hit::after {
      content: '' !important;
      position: absolute !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      height: 0 !important;
      border-bottom: 2px dashed ${noteStroke} !important;
      pointer-events: none !important;
    }
    #reader-mark-layer .mobi-mark-highlight {
      position: absolute !important;
      pointer-events: none !important;
    }
    #reader-mark-layer .mobi-mark-note {
      position: absolute !important;
      pointer-events: auto !important;
    }
  `
}

export function injectMobiMarkStyles(doc: Document, theme: 'dark' | 'light' | 'sepia'): void {
  const styleId = 'reader-mobi-mark-styles'
  let style = doc.getElementById(styleId) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = styleId
    doc.head.appendChild(style)
  }
  style.textContent = buildMobiMarkStylesCss(theme)
}
