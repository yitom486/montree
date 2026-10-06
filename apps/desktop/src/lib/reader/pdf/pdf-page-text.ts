import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pageHasNativeText } from '@montree/ocr-core'
import type { PdfOcrPageCache } from '@montree/contracts'

export async function readPdfPageNativeText(
  pdf: PDFDocumentProxy,
  page: number,
): Promise<string> {
  const content = await (await pdf.getPage(page)).getTextContent()
  return content.items.map((item) => ('str' in item ? item.str : '')).join('')
}

export function textFromOcrPageCache(cache: PdfOcrPageCache): string {
  return cache.words.map((word) => word.text).join('')
}

export function pdfPageNeedsOcr(nativeText: string): boolean {
  const charCount = nativeText.replace(/\s/g, '').length
  return !pageHasNativeText(charCount)
}

/** 校验 OCR 缓存与请求页码一致，防止错页复用 */
export function assertOcrCachePage(cache: PdfOcrPageCache, page: number): void {
  if (cache.page !== page) {
    throw new Error(`OCR 缓存页码不一致：请求第 ${page} 页，缓存为第 ${cache.page} 页`)
  }
}

/** Agent 读 PDF 时附带页码；仅在有正文时使用 */
export function formatPdfPageTextForAgent(
  page: number,
  numPages: number,
  text: string,
): string {
  const total = Math.max(numPages, page, 1)
  const header = `【PDF 第 ${page}/${total} 页】\n`
  const body = text.trim()
  if (!body) {
    throw new Error(`第 ${page} 页正文为空`)
  }
  return `${header}${body}`
}
