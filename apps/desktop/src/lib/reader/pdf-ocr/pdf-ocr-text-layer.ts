import type { PageViewport } from 'pdfjs-dist'
import type { PdfOcrPageCache } from '@yitom/contracts'
import { filterOcrHitLayerWords, ocrPageCacheToTextContent } from '@montree/ocr-core'
import { registerPdfPageTextGeometry } from '@yitom/reader-core'

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
  // span 文本与几何 item.str 必须逐字一致（含词间分隔空格），选区偏移才能映射回引文
  const textContent = ocrPageCacheToTextContent({ ...cache, words: hitWords })

  hitWords.forEach((word, index) => {
    const item = textContent.items[index] as { str: string; width: number }
    const span = document.createElement('span')
    span.textContent = item.str
    span.dataset.pdfTextItemIndex = String(index)
    span.style.position = 'absolute'
    span.style.left = `${word.bbox.x0 * viewport.width}px`
    span.style.top = `${word.bbox.y0 * viewport.height}px`
    span.style.width = `${(item.width / cache.pageWidth) * viewport.width}px`
    span.style.height = `${(word.bbox.y1 - word.bbox.y0) * viewport.height}px`
    span.style.fontSize = `${Math.max(8, (word.bbox.y1 - word.bbox.y0) * viewport.height * 0.85)}px`
    span.style.lineHeight = '1'
    span.style.color = 'transparent'
    span.style.whiteSpace = 'pre'
    span.style.transformOrigin = '0% 0%'
    layer.appendChild(span)
  })

  host.replaceChildren(layer)
  return registerPdfPageTextGeometry(pageRoot, viewport, textContent)
}
