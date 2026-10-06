import { describe, expect, it, vi } from 'vitest'
import {
  assertOcrCachePage,
  formatPdfPageTextForAgent,
  pdfPageNeedsOcr,
  readPdfPageNativeText,
} from './pdf-page-text'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfOcrPageCache } from '@montree/contracts'

describe('pdf-page-text', () => {
  it('pdfPageNeedsOcr 无嵌入文字时为 true', () => {
    expect(pdfPageNeedsOcr('')).toBe(true)
    expect(pdfPageNeedsOcr('ab')).toBe(true)
    expect(pdfPageNeedsOcr('这是一段足够长的嵌入文字内容')).toBe(false)
  })

  it('readPdfPageNativeText 拼接 text items', async () => {
    const pdf = {
      getPage: vi.fn(async () => ({
        getTextContent: async () => ({
          items: [{ str: 'hello' }, { str: ' world' }],
        }),
      })),
    } as unknown as PDFDocumentProxy
    await expect(readPdfPageNativeText(pdf, 1)).resolves.toBe('hello world')
  })

  it('formatPdfPageTextForAgent 附带页码头', () => {
    expect(formatPdfPageTextForAgent(7, 340, '王道训练营')).toBe('【PDF 第 7/340 页】\n王道训练营')
    expect(() => formatPdfPageTextForAgent(7, 340, '')).toThrow('第 7 页正文为空')
  })

  it('assertOcrCachePage 拒绝错页缓存', () => {
    const cache = { page: 8, words: [{ text: 'x' }] } as PdfOcrPageCache
    expect(() => assertOcrCachePage(cache, 7)).toThrow('页码不一致')
  })
})
