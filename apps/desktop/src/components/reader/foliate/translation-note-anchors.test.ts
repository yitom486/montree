// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ok, type ReadingMark } from '@yitom/contracts'
import type { ReaderSelectionActionsOptions } from '@/hooks/reader/useReaderSelectionActions'
import { useFoliateInteractions, type UseFoliateInteractionsOptions } from './useFoliateInteractions'

let actions: ReaderSelectionActionsOptions
vi.mock('@/hooks/reader/useReaderSelectionActions', () => ({
  useReaderSelectionActions: (options: ReaderSelectionActionsOptions) => { actions = options; return {} },
}))
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('translation note CFI capture', () => {
  it.each(['epub', 'mobi'] as const)('%s keeps original CFI and section after a new selection, preserving existing notes', async (kind) => {
    const host = document.createElement('div')
    const root = createRoot(host)
    let model!: ReturnType<typeof useFoliateInteractions>
    const existing = {
      id: 'manual', filePath: 'book', kind: 'note', excerpt: 'Original', note: '手写批注',
      anchor: { format: kind, cfi: 'first-cfi', cfiRange: 'first-cfi', chapterId: 'first' },
    } as ReadingMark
    const createMark = vi.fn(async () => ok({ ...existing, id: 'translation' }))
    const updateMark = vi.fn()
    const location = { current: { sectionIndex: 0, fraction: 0 } }
    const options = {
      filePath: 'book', fileFingerprint: 'book-fingerprint', kindRef: { current: kind },
      containerRef: { current: null }, viewRef: { current: null },
      adapterRef: { current: { sections: [{ id: 'first' }, { id: 'second' }] } },
      chaptersRef: { current: [] }, lastLocationRef: location,
      marks: [existing], marksRef: { current: [existing] }, createMark, updateMark, deleteMark: vi.fn(),
      showPendingAnnotateHighlight: vi.fn(), removePendingAnnotateHighlight: vi.fn(), syncVisualMarks: vi.fn(),
      getRenderedDocs: () => [], goToChapter: vi.fn(), nav: { current: null, flatIndex: 0 },
    } as unknown as UseFoliateInteractionsOptions
    function Harness() { model = useFoliateInteractions(options); return null }
    try {
      await act(async () => { root.render(createElement(Harness)) })
      await act(async () => { model.setSelectionSnapshot({ text: 'Original', cfiRange: 'first-cfi', rect: new DOMRect() }) })
      const writer = actions.captureTranslationNote!()!
      location.current.sectionIndex = 1
      await act(async () => { model.setSelectionSnapshot({ text: 'Original', cfiRange: 'second-cfi', rect: new DOMRect() }) })
      await act(async () => { await writer('翻译内容', 'Original') })
      expect(createMark).toHaveBeenCalledTimes(1)
      const payload = createMark.mock.calls[0] as unknown as [Record<string, unknown>]
      expect(payload[0]).toMatchObject({ note: '翻译内容', excerpt: 'Original', title: '翻译' })
      expect(payload[0].anchor).toMatchObject(kind === 'epub'
        ? { format: 'epub', cfiRange: 'first-cfi', href: 'first' }
        : { format: 'mobi', cfiRange: 'first-cfi', chapterId: 'first' })
      expect(updateMark).not.toHaveBeenCalled()
      expect(existing.note).toBe('手写批注')
      expect(model.selectionSnapshot?.cfiRange).toBe('second-cfi')
    } finally { await act(async () => { root.unmount() }); host.remove() }
  })
})
