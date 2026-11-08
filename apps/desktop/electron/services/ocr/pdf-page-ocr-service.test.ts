import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recognizePdfPage } from './pdf-page-ocr-service'
import { processPdfWithOcr } from '@firecrawl/pdf-inspector'
import { writePdfOcrPageCache } from './ocr-page-cache'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(async () => Buffer.from('pdf')) }))
vi.mock('./inspector-ocr-runtime', () => ({
  ensureInspectorOcrRuntime: vi.fn(async () => ({ ok: true, value: { modelDir: 'models' } })),
}))
vi.mock('./ocr-page-cache', () => ({ writePdfOcrPageCache: vi.fn() }))
vi.mock('@firecrawl/pdf-inspector', () => ({
  OcrMode: { Force: 'Force' }, processPdfWithOcr: vi.fn(),
}))

describe('single-page OCR routing', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('forces image recognition on the requested page even when a native text layer exists', async () => {
    vi.mocked(processPdfWithOcr).mockResolvedValue({
      pages: [{ pageNumber: 3, spans: [
        { text: 'This SICP book', confidence: 0.95, x: 60, y: 600, width: 300, height: 20 },
      ] }],
    } as unknown as Awaited<ReturnType<typeof processPdfWithOcr>>)
    const result = await recognizePdfPage({
      filePath: 'book.pdf', fileFingerprint: 'book', page: 3, pageWidthPt: 600, pageHeightPt: 800,
    })
    expect(processPdfWithOcr).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      mode: 'Force', pageNumbers: [3], offline: true,
    }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.words.map((word) => word.text)).toEqual(['This', 'SICP', 'book'])
    expect(writePdfOcrPageCache).toHaveBeenCalledTimes(1)
  })

  it('does not save empty OCR results', async () => {
    vi.mocked(processPdfWithOcr).mockResolvedValue({ pages: [] } as unknown as Awaited<ReturnType<typeof processPdfWithOcr>>)
    const result = await recognizePdfPage({
      filePath: 'book.pdf', fileFingerprint: 'book', page: 3, pageWidthPt: 600, pageHeightPt: 800,
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'OCR_PAGE_EMPTY' } })
    expect(writePdfOcrPageCache).not.toHaveBeenCalled()
  })
})
