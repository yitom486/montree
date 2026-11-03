// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReaderTranslation } from './useReaderTranslation'
import { sendTranslationPrompt } from '@/lib/agent/translation-session'

vi.mock('@/lib/agent/translation-session', async () => ({
  ...await import('@/lib/reader/text-quality'),
  sendTranslationPrompt: vi.fn(), TRANSLATION_MAX_INPUT_CHARS: 4000,
}))
vi.mock('@/stores/app-settings-store', () => ({
  useAppSettingsStore: { getState: () => ({ translationTargetLang: 'zh-CN', translationRuntimeId: 'test', translationModelByRuntime: {}, translationThoughtByRuntime: {} }) },
  translationTargetLabel: () => '简体中文',
}))
vi.mock('@/stores/acp-ui-store', () => ({
  useAcpUiStore: { getState: () => ({ selectedRuntimeId: 'test' }) },
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('translation OCR recovery', () => {
  let root: Root
  let host: HTMLDivElement
  let model: ReturnType<typeof useReaderTranslation>
  let options: Parameters<typeof useReaderTranslation>[0]
  function Harness() { model = useReaderTranslation(options); return null }
  const render = async () => { await act(async () => { root.render(createElement(Harness)) }) }
  const position = { x: 100, y: 150 }

  beforeEach(async () => {
    vi.mocked(sendTranslationPrompt).mockReset().mockResolvedValue({ status: 'ok', reply: '译文' })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    options = { getSourceText: () => 'Hello', dimTextSelection: vi.fn(), sourceKey: 'book' }
    await render()
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

  it('translates readable text without invoking OCR', async () => {
    options.recoverSourceText = vi.fn()
    await render()
    await act(async () => { await model.translate(position) })
    expect(options.recoverSourceText).not.toHaveBeenCalled()
    expect(sendTranslationPrompt).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello' }))
    expect(model.translation?.phase).toBe('done')
  })

  it('shows recognition progress then sends recovered selection only', async () => {
    const recovery = deferred<string>()
    options = { ...options, getSourceText: () => '\u0001is \uE001 book', recoverSourceText: () => recovery.promise }
    await render()
    let pending!: Promise<void>
    await act(async () => { pending = model.translate(position) })
    expect(model.translation?.phase).toBe('recognizing')
    expect(sendTranslationPrompt).not.toHaveBeenCalled()
    await act(async () => { recovery.resolve('This SICP book'); await pending })
    expect(sendTranslationPrompt).toHaveBeenCalledWith(expect.objectContaining({ text: 'This SICP book' }))
    expect(model.translation).toMatchObject({ phase: 'done', sourceText: 'This SICP book', text: '译文' })
  })

  it('does not start translation after dismissal during OCR', async () => {
    const recovery = deferred<string>()
    options = { ...options, getSourceText: () => '\uFFFD', recoverSourceText: () => recovery.promise }
    await render()
    let pending!: Promise<void>
    await act(async () => { pending = model.translate(position) })
    act(() => model.dismiss())
    await act(async () => { recovery.resolve('Old text'); await pending })
    expect(sendTranslationPrompt).not.toHaveBeenCalled()
    expect(model.translation).toBeNull()
  })

  it('discards old OCR results when a newer translation starts', async () => {
    const recovery = deferred<string>()
    options = { ...options, getSourceText: () => '\uFFFD', recoverSourceText: () => recovery.promise }
    await render()
    let pending!: Promise<void>
    await act(async () => { pending = model.translate(position) })
    options = { ...options, getSourceText: () => 'New selection' }
    await render()
    await act(async () => { await model.translate(position) })
    await act(async () => { recovery.resolve('Old text'); await pending })
    expect(sendTranslationPrompt).toHaveBeenCalledTimes(1)
    expect(model.translation?.sourceText).toBe('New selection')
  })

  it('keeps the original selection recovery on retry even after options change', async () => {
    const recover = vi.fn().mockRejectedValueOnce(new Error('OCR 暂不可用')).mockResolvedValue('Original selection')
    options = { ...options, getSourceText: () => '\uFFFD', recoverSourceText: recover }
    await render()
    await act(async () => { await model.translate(position) })
    expect(model.translation).toMatchObject({ phase: 'error', error: 'OCR 暂不可用' })
    options = { ...options, recoverSourceText: vi.fn().mockResolvedValue('Wrong selection') }
    await render()
    await act(async () => { await model.retry() })
    expect(sendTranslationPrompt).toHaveBeenCalledWith(expect.objectContaining({ text: 'Original selection' }))
    expect(recover).toHaveBeenCalledTimes(2)
  })

  it('invalidates OCR when switching documents', async () => {
    const recovery = deferred<string>()
    options = { ...options, getSourceText: () => '\uFFFD', recoverSourceText: () => recovery.promise }
    await render()
    let pending!: Promise<void>
    await act(async () => { pending = model.translate(position) })
    options = { ...options, sourceKey: 'another-book' }
    await render()
    await act(async () => { recovery.resolve('Old book'); await pending })
    expect(sendTranslationPrompt).not.toHaveBeenCalled()
    expect(model.translation).toBeNull()
  })

  it.each(['', '\uFFFD remains', 'a'.repeat(4001)])('never sends invalid recovered text (%#)', async (text) => {
    options = { ...options, getSourceText: () => '\uFFFD', recoverSourceText: async () => text }
    await render()
    await act(async () => { await model.translate(position) })
    expect(model.translation?.phase).toBe('error')
    expect(sendTranslationPrompt).not.toHaveBeenCalled()
  })

  it('shows translation while optional details are being completed', async () => {
    const result = deferred<Awaited<ReturnType<typeof sendTranslationPrompt>>>()
    vi.mocked(sendTranslationPrompt).mockImplementationOnce(async (request) => {
      request.onDelta?.('译文')
      request.onDetails?.({ sourceLanguage: '英语', phrases: [{ text: 'Hello', meaning: '问候' }], terms: [] })
      request.onDetailsStart?.()
      return result.promise
    })
    let pending!: Promise<void>
    await act(async () => { pending = model.translate(position) })
    expect(model.translation).toMatchObject({ phase: 'enriching', text: '译文', details: { sourceLanguage: '英语', phrases: [{ text: 'Hello', meaning: '问候' }] } })
    await act(async () => {
      result.resolve({ status: 'ok', reply: '译文', details: { sourceLanguage: '英语', phrases: [], terms: [] } })
      await pending
    })
    expect(model.translation).toMatchObject({ phase: 'done', details: { sourceLanguage: '英语' } })
  })

  it('saves against the captured selection, prevents duplicate saves and preserves the card', async () => {
    const save = deferred<unknown>()
    const originalWriter = vi.fn(() => save.promise)
    options.captureNoteWriter = () => originalWriter
    await render()
    await act(async () => { await model.translate(position) })
    options = { ...options, getSourceText: () => 'Another selection', captureNoteWriter: () => vi.fn() }
    await render()
    let pending!: Promise<void>
    await act(async () => { pending = model.saveNote(); await model.saveNote() })
    expect(originalWriter).toHaveBeenCalledTimes(1)
    expect(originalWriter).toHaveBeenCalledWith(expect.stringContaining('原文\nHello'), 'Hello')
    expect(model.translation?.saving).toBe(true)
    await act(async () => { save.resolve(undefined); await pending; await model.saveNote() })
    expect(originalWriter).toHaveBeenCalledTimes(1)
    expect(model.translation).toMatchObject({ phase: 'done', text: '译文', saved: true, saving: false })
  })

  it('retains translation on save failure and supports retry', async () => {
    const writer = vi.fn().mockRejectedValueOnce(new Error('磁盘不可写')).mockResolvedValueOnce(undefined)
    options.captureNoteWriter = () => writer
    await render()
    await act(async () => { await model.translate(position) })
    await act(async () => { await model.saveNote() })
    expect(model.translation).toMatchObject({ phase: 'done', text: '译文', saveError: '磁盘不可写', saving: false })
    await act(async () => { await model.saveNote() })
    expect(model.translation).toMatchObject({ saved: true, saveError: undefined })
  })
})
