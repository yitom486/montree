// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { PdfOcrPageCache } from '@montree/contracts'
import type { OcrPageWord } from '@montree/contracts'
import { mountOcrTextLayer } from './pdf-ocr-text-layer'

const w = (text: string, x0: number, y0: number, x1: number, y1: number): OcrPageWord => ({
  text,
  bbox: { x0, y0, x1, y1 },
})

function cacheWith(words: OcrPageWord[]): PdfOcrPageCache {
  return {
    fileFingerprint: 'fp|1',
    page: 2,
    pageWidth: 541,
    pageHeight: 754,
    ocrScale: 2,
    words,
    createdAt: '2026-01-01',
  }
}

describe('mountOcrTextLayer', () => {
  it('V2：斜戳印不进透明层，正文 span 与 index 连续', () => {
    const body = [...'正文段落内容测试'].map((char, i) =>
      w(char, 0.1 + i * 0.03, 0.5, 0.125 + i * 0.03, 0.52),
    )
    const stamp = ['斜', '戳', '印'].map((char, i) =>
      w(char, 0.5 + i * 0.03, 0.6, 0.525 + i * 0.03, 0.72),
    )
    const host = document.createElement('div')
    const root = document.createElement('div')
    const dispose = mountOcrTextLayer(
      host,
      root,
      { width: 541, height: 754 } as unknown as Parameters<typeof mountOcrTextLayer>[2],
      cacheWith([...body, ...stamp]),
    )
    const spans = [...host.querySelectorAll('span')]
    expect(spans.map((span) => span.textContent).join('')).toBe('正文段落内容测试')
    // index 与过滤后几何同数组同顺序：0..n-1 连续
    expect(spans.map((span) => span.dataset.pdfTextItemIndex)).toEqual(
      spans.map((_, i) => String(i)),
    )
    expect(typeof dispose).toBe('function')
    dispose()
  })
})
