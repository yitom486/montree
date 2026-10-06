import type { PageViewport } from 'pdfjs-dist'
import type { PdfOcrPageCache } from '@montree/contracts'
import { filterOcrHitLayerWords, ocrPageCacheToTextContent } from '@montree/ocr-core'
import { registerPdfPageTextGeometry } from '@montree/reader-core'

export function mountOcrTextLayer(
  host: HTMLElement,
  pageRoot: HTMLElement,
  viewport: PageViewport,
  cache: PdfOcrPageCache,
): () => void {
  // V2：透明命中层只收接近水平的正文（斜戳印不进选区）。
  // 过滤一次同时喂 span 与 textContent：同数组同顺序，index 与几何天然一致。
  const hitWords = filterOcrHitLayerWords(cache.words)
  const layer = document.createElement('div')
  layer.className = 'textLayer'

  hitWords.forEach((word, index) => {
    const span = document.createElement('span')
    span.textContent = word.text
    span.dataset.pdfTextItemIndex = String(index)
    span.style.position = 'absolute'
    span.style.left = `${word.bbox.x0 * viewport.width}px`
    span.style.top = `${word.bbox.y0 * viewport.height}px`
    span.style.width = `${(word.bbox.x1 - word.bbox.x0) * viewport.width}px`
    span.style.height = `${(word.bbox.y1 - word.bbox.y0) * viewport.height}px`
    span.style.fontSize = `${Math.max(8, (word.bbox.y1 - word.bbox.y0) * viewport.height * 0.85)}px`
    span.style.lineHeight = '1'
    span.style.color = 'transparent'
    span.style.whiteSpace = 'pre'
    span.style.transformOrigin = '0% 0%'
    layer.appendChild(span)
  })

  host.replaceChildren(layer)
  const textContent = ocrPageCacheToTextContent({ ...cache, words: hitWords })
  return registerPdfPageTextGeometry(pageRoot, viewport, textContent)
}
