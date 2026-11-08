import type { PdfOcrPageCache, PdfTextRect } from '@yitom/contracts'
import { filterOcrHitLayerWords, ocrWordsToPlainText } from '@montree/ocr-core'
import { assertOcrCachePage } from '../pdf/pdf-page-text'

/** 使用点击翻译时的归一化选区；OCR 换层、缩放或翻页后仍取原来的区域。 */
export function textFromOcrSelection(
  cache: PdfOcrPageCache,
  selection: { page: number; rects: readonly PdfTextRect[] },
): string {
  assertOcrCachePage(cache, selection.page)
  const words = filterOcrHitLayerWords(cache.words).flatMap((word) => {
    const { x0, x1, y0, y1 } = word.bbox
    if (!(x1 > x0) || !(y1 > y0)) return []
    const chars = Array.from(word.text)
    const included = new Set<number>()
    for (const rect of selection.rects) {
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) continue
      if (!(rect.width > 0) || !(rect.height > 0)) continue
      const overlapY = Math.min(y1, rect.y + rect.height) - Math.max(y0, rect.y)
      if (overlapY < Math.min(y1 - y0, rect.height) * 0.5) continue
      const left = Math.max(x0, rect.x)
      const right = Math.min(x1, rect.x + rect.width)
      if (right <= left) continue
      // inspector 行框切词本身是近似几何；按字符中心截取，支持只划中一个词的一部分。
      const from = Math.round(((left - x0) / (x1 - x0)) * chars.length)
      const to = Math.round(((right - x0) / (x1 - x0)) * chars.length)
      for (let index = from; index < to; index += 1) included.add(index)
    }
    const text = chars.filter((_, index) => included.has(index)).join('')
    return text ? [{ ...word, text }] : []
  })
  const text = ocrWordsToPlainText(words).trim()
  if (!text) throw new Error('OCR 未能定位原选区文字，请重新划选后重试')
  return text
}
