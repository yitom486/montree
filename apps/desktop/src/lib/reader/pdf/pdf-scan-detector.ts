import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pageHasNativeText } from '@montree/ocr-core'

const HEAD_SAMPLE_PAGES = 3
/** 除头部外再抽中间与尾部各 1 页：前 3 页全是文字但正文为扫描图的混合文档最常见 */
const MAX_SAMPLE_PAGES = 5

async function pageTextCharCount(pdf: PDFDocumentProxy, pageNumber: number): Promise<number> {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  return content.items.reduce((sum, item) => {
    const str = 'str' in item && typeof item.str === 'string' ? item.str : ''
    return sum + str.replace(/\s/g, '').length
  }, 0)
}

export interface PdfDocumentProfile {
  /** 抽样均值无有效文字层（纯扫描）：驱动扫描横幅与后台预识别 */
  isScanned: boolean
  /** 抽样页中有无文字页（混合文档）：单页自动 OCR 门禁同样放行，后台预识别仍只跟 isScanned */
  mixed: boolean
  /** 实际抽样的 1-indexed 页码 */
  sampledPages: number[]
  sampledCharCount: number
  /** 抽样中无文字层的 1-indexed 页码 */
  textlessPages: number[]
}

/** 选出抽样页：前 N 页 + 中间 + 末尾，去重且不超过总页数 */
export function resolvePdfProfileSamplePages(numPages: number): number[] {
  if (!Number.isFinite(numPages) || numPages < 1) return []
  const pages: number[] = []
  for (let page = 1; page <= Math.min(HEAD_SAMPLE_PAGES, numPages); page += 1) {
    pages.push(page)
  }
  if (numPages > MAX_SAMPLE_PAGES) {
    const middle = Math.floor((numPages + 1) / 2)
    const tail = numPages
    for (const page of [middle, tail]) {
      if (!pages.includes(page)) pages.push(page)
    }
  } else {
    for (let page = pages.length + 1; page <= numPages; page += 1) {
      pages.push(page)
    }
  }
  return pages
}

/** 根据抽样页文字层判断扫描 / 混合文档 */
export async function detectPdfDocumentProfile(
  pdf: PDFDocumentProxy,
): Promise<PdfDocumentProfile> {
  const sampledPages = resolvePdfProfileSamplePages(pdf.numPages)
  let sampledCharCount = 0
  const textlessPages: number[] = []

  for (const page of sampledPages) {
    const charCount = await pageTextCharCount(pdf, page)
    sampledCharCount += charCount
    if (!pageHasNativeText(charCount)) textlessPages.push(page)
  }

  const avgChars = sampledPages.length > 0 ? sampledCharCount / sampledPages.length : 0
  const mixed = textlessPages.length > 0 && textlessPages.length < sampledPages.length
  return {
    isScanned: !pageHasNativeText(avgChars),
    mixed,
    sampledPages,
    sampledCharCount,
    textlessPages,
  }
}
