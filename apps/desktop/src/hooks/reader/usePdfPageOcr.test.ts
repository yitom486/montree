// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfOcrPageCache } from '@yitom/contracts'
import { recognizePdfOcrPage } from '@/api/ocr-api'
import { usePdfPageOcr } from './usePdfPageOcr'

vi.mock('@/api/ocr-api', () => ({ recognizePdfOcrPage: vi.fn() }))
vi.mock('@/stores/app-settings-store', () => ({
  useAppSettingsStore: (selector: (state: { pdfOcrScale: number }) => unknown) => selector({ pdfOcrScale: 2 }),
}))
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function cache(fileFingerprint: string, text = 'Recovered'): PdfOcrPageCache {
  return { fileFingerprint, page: 2, pageWidth: 600, pageHeight: 800, ocrScale: 2, createdAt: '',
    words: [{ text, bbox: { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.23 } }] }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('PDF OCR request lifecycle', () => {
  let host: HTMLDivElement
  let root: Root
  let model: ReturnType<typeof usePdfPageOcr>
  let options: Parameters<typeof usePdfPageOcr>[0]
  function Harness() { model = usePdfPageOcr(options); return null }
  const render = async () => { await act(async () => { root.render(createElement(Harness)) }) }
  beforeEach(async () => {
    vi.mocked(recognizePdfOcrPage).mockReset().mockResolvedValue({ ok: true, value: cache('book') })
    host = document.createElement('div')
    root = createRoot(host)
    options = {
      filePath: 'book.pdf', fileFingerprint: 'book', pageNum: 2,
      isScannedPdf: false, isMixedPdf: false,
      pdfDocRef: { current: { getPage: async () => ({ getTextContent: async () => ({ items: [{ str: '\uE001his SICP book' }] }) }) } as unknown as PDFDocumentProxy },
      getPageSizePt: async () => ({ width: 600, height: 800 }),
      importRunningRef: { current: false },
    }
    await render()
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

  it('recovers a broken text layer even if the document is classified as native', async () => {
    let text = ''
    await act(async () => { text = await model.readPageText(2) })
    expect(text).toBe('Recovered')
    expect(model.ocrPageCaches[2]?.fileFingerprint).toBe('book')
  })

  it('respects disabled automatic OCR and live full-book import state', async () => {
    await expect(model.readPageText(2, { allowAutoOcr: false })).rejects.toThrow('关闭 Agent 自动 OCR')
    options.importRunningRef!.current = true
    await expect(model.runPageOcr(2)).rejects.toThrow('全书识别进行中')
    expect(recognizePdfOcrPage).not.toHaveBeenCalled()
  })

  it('shares an in-flight page recognition between automatic OCR and translation', async () => {
    const task = deferred<Awaited<ReturnType<typeof recognizePdfOcrPage>>>()
    vi.mocked(recognizePdfOcrPage).mockReturnValue(task.promise)
    let first!: Promise<PdfOcrPageCache>
    let second!: Promise<PdfOcrPageCache>
    await act(async () => { first = model.runPageOcr(2); second = model.runPageOcr(2) })
    expect(recognizePdfOcrPage).toHaveBeenCalledTimes(1)
    await act(async () => {
      task.resolve({ ok: true, value: cache('book') })
      expect(await first).toBe(await second)
    })
  })

  it('cannot overwrite a new document or delete its in-flight task with a late old result', async () => {
    const oldTask = deferred<Awaited<ReturnType<typeof recognizePdfOcrPage>>>()
    const newTask = deferred<Awaited<ReturnType<typeof recognizePdfOcrPage>>>()
    vi.mocked(recognizePdfOcrPage).mockReturnValueOnce(oldTask.promise).mockReturnValueOnce(newTask.promise)
    let oldResult!: Promise<unknown>
    await act(async () => { oldResult = model.runPageOcr(2).catch((error: Error) => error.message) })
    options = { ...options, filePath: 'new.pdf', fileFingerprint: 'new' }
    await render()
    act(() => model.resetPageOcr())
    let newResult!: Promise<PdfOcrPageCache>
    await act(async () => { newResult = model.runPageOcr(2) })
    await act(async () => {
      oldTask.resolve({ ok: true, value: cache('book') })
      expect(await oldResult).toContain('文档已切换')
    })
    expect(model.ocrPageCaches[2]).toBeUndefined()
    expect(model.hasPendingPageOcr(2)).toBe(true)
    await act(async () => {
      newTask.resolve({ ok: true, value: cache('new', 'New book') })
      await newResult
    })
    expect(model.ocrPageCaches[2]?.fileFingerprint).toBe('new')
  })
})
