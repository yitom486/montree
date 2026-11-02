import { describe, expect, it, vi } from 'vitest'
import {
  assertOcrCachePage,
  formatPdfPageTextForAgent,
  pdfPageNeedsOcr,
  pdfTextItemsHaveUnreadableChars,
  readPdfPageNativeText,
} from './pdf-page-text'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfOcrPageCache } from '@yitom/contracts'

describe('pdf-page-text', () => {
  it('pdfPageNeedsOcr 无嵌入文字时为 true', () => {
    expect(pdfPageNeedsOcr('')).toBe(true)
    expect(pdfPageNeedsOcr('ab')).toBe(true)
    expect(pdfPageNeedsOcr('这是一段足够长的嵌入文字内容')).toBe(false)
    expect(pdfPageNeedsOcr('This is \uE001\uE002\uE003\uE004 book')).toBe(true)
    expect(pdfPageNeedsOcr('\u0001is is the second edition')).toBe(true)
  })

  it('检测 PDF 文字层 U+FFFD（字体缺 ToUnicode）', () => {
    expect(pdfTextItemsHaveUnreadableChars([{ str: 'normal' }, { type: 'beginMarkedContent' }])).toBe(false)
    expect(pdfTextItemsHaveUnreadableChars([{ str: '�is is the second edition ��� book' }])).toBe(true)
    expect(pdfTextItemsHaveUnreadableChars([{ str: '\uE001is is the second edition' }])).toBe(true)
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
