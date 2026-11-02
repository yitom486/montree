import { describe, expect, it } from 'vitest'
import type { PdfOcrPageCache } from '@yitom/contracts'
import { textFromOcrSelection } from './pdf-ocr-selection'

const cache: PdfOcrPageCache = {
  fileFingerprint: 'book', page: 3, pageWidth: 600, pageHeight: 800, ocrScale: 2, createdAt: '',
  words: [
    { text: 'Other', bbox: { x0: 0.1, x1: 0.2, y0: 0.1, y1: 0.12 } },
    { text: 'This', bbox: { x0: 0.1, x1: 0.2, y0: 0.2, y1: 0.22 } },
    { text: 'SICP', bbox: { x0: 0.3, x1: 0.4, y0: 0.2, y1: 0.22 } },
    { text: 'book', bbox: { x0: 0.5, x1: 0.6, y0: 0.2, y1: 0.22 } },
    { text: 'Next', bbox: { x0: 0.1, x1: 0.2, y0: 0.3, y1: 0.32 } },
  ],
}

describe('OCR selection recovery', () => {
  it('reads only the selected region, without adjacent lines or duplicate words', () => {
    const rect = { x: 0.09, y: 0.195, width: 0.32, height: 0.03 }
    expect(textFromOcrSelection(cache, { page: 3, rects: [rect, rect] })).toBe('This SICP')
  })

  it('keeps multiline reading order', () => {
    expect(textFromOcrSelection(cache, { page: 3, rects: [
      { x: 0.49, y: 0.2, width: 0.12, height: 0.02 },
      { x: 0.09, y: 0.3, width: 0.12, height: 0.02 },
    ] })).toBe('book\nNext')
  })

  it('clips a partial word instead of translating the entire OCR word', () => {
    expect(textFromOcrSelection(cache, { page: 3, rects: [
      { x: 0.35, y: 0.2, width: 0.05, height: 0.02 },
    ] })).toBe('CP')
  })

  it('rejects missing geometry and wrong-page caches', () => {
    expect(() => textFromOcrSelection(cache, { page: 3, rects: [] })).toThrow('定位原选区')
    expect(() => textFromOcrSelection(cache, { page: 2, rects: [] })).toThrow('页码不一致')
    expect(() => textFromOcrSelection(cache, { page: 3, rects: [
      { x: NaN, y: 0.2, width: 0.8, height: 0.02 },
      { x: 0, y: 0.8, width: 1, height: 0.02 },
    ] })).toThrow('定位原选区')
  })
})
