// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ok, err, type TypstEvent } from '@yitom/contracts'
import { typstApi } from '@/api/typst-api'
import { useTypstSession } from './useTypstSession'

vi.mock('@/api/typst-api', () => ({ typstApi: { open: vi.fn(), sync: vi.fn(), request: vi.fn(), close: vi.fn(), exportPdf: vi.fn(), onEvent: vi.fn(() => () => {}) } }))
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const nativeSession = { sessionId: 'first', uri: 'file:///project/main.typ', filePath: '/project/main.typ', rootPath: '/project', capabilities: {}, previewUrl: null }

describe('Typst React session ownership', () => {
  let root: Root, container: HTMLDivElement
  let current: ReturnType<typeof useTypstSession>
  let content: string
  let filePath: string
  let eventListener: ((event: TypstEvent) => void) | undefined
  function Harness() { current = useTypstSession(filePath, content, '/project', true); return null }
  beforeEach(() => {
    vi.clearAllMocks()
    content = '= draft'
    filePath = '/project/main.typ'
    vi.mocked(typstApi.onEvent).mockImplementation((listener) => { eventListener = listener; return () => { if (eventListener === listener) eventListener = undefined } })
    vi.mocked(typstApi.open).mockResolvedValue(ok(nativeSession))
    vi.mocked(typstApi.sync).mockResolvedValue(ok(undefined))
    vi.mocked(typstApi.close).mockResolvedValue(ok(undefined))
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  it('opens one session under StrictMode rather than racing duplicate native documents', async () => {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))))
    expect(typstApi.open).toHaveBeenCalledOnce()
    expect(current!.session?.sessionId).toBe('first')
  })
  it('waits for the previous native close before restarting the same document', async () => {
    await act(async () => root.render(createElement(Harness)))
    const closing = deferred<Awaited<ReturnType<typeof typstApi.close>>>()
    vi.mocked(typstApi.close).mockReturnValueOnce(closing.promise)
    await act(async () => current!.restart())
    expect(typstApi.open).toHaveBeenCalledOnce()
    expect(typstApi.close).toHaveBeenCalledWith('first')
    await act(async () => { closing.resolve(ok(undefined)); await Promise.resolve() })
    expect(typstApi.open).toHaveBeenCalledTimes(2)
  })
  it('waits for an abandoned pending open to be closed before reopening', async () => {
    const pendingOpen = deferred<Awaited<ReturnType<typeof typstApi.open>>>()
    vi.mocked(typstApi.open).mockReturnValueOnce(pendingOpen.promise)
    await act(async () => root.render(createElement(Harness)))
    await act(async () => root.render(null))
    await act(async () => root.render(createElement(Harness)))
    expect(typstApi.open).toHaveBeenCalledOnce()
    await act(async () => { pendingOpen.resolve(ok(nativeSession)); await Promise.resolve() })
    expect(typstApi.close).toHaveBeenCalledWith('first')
    expect(typstApi.open).toHaveBeenCalledTimes(2)
  })
  it('automatically reconnects once with the latest unsaved buffer, then waits for manual restart', async () => {
    vi.mocked(typstApi.open).mockResolvedValueOnce(ok(nativeSession)).mockResolvedValue(ok({ ...nativeSession, sessionId: 'second' }))
    await act(async () => root.render(createElement(Harness)))
    content = '= unsaved 中文😀'
    await act(async () => root.render(createElement(Harness)))
    await act(async () => eventListener?.({ sessionId: 'first', type: 'exit', message: 'unexpected crash' }))
    expect(typstApi.open).toHaveBeenCalledTimes(2)
    expect(vi.mocked(typstApi.open).mock.calls[1][0].content).toBe(content)
    expect(current!.phase).toBe('ready')
    await act(async () => eventListener?.({ sessionId: 'second', type: 'exit', message: 'second crash' }))
    expect(typstApi.open).toHaveBeenCalledTimes(2)
    expect(current!.phase).toBe('error')
    expect(current!.message).toContain('请手动重启服务')
    await act(async () => current!.restart())
    expect(typstApi.open).toHaveBeenCalledTimes(3)
  })
  it('does not loop when automatic recovery cannot open the runtime', async () => {
    vi.mocked(typstApi.open).mockResolvedValueOnce(ok(nativeSession)).mockResolvedValue(err({ code: 'FILE_NOT_FOUND', message: 'runtime missing' }))
    await act(async () => root.render(createElement(Harness)))
    await act(async () => eventListener?.({ sessionId: 'first', type: 'exit', message: 'unexpected crash' }))
    expect(typstApi.open).toHaveBeenCalledTimes(2)
    expect(current!.phase).toBe('error')
    expect(current!.message).toContain('runtime missing')
    expect(current!.message).toContain('请手动重启服务')
  })
  it('does not retry an initial missing executable automatically', async () => {
    vi.mocked(typstApi.open).mockResolvedValue(err({ code: 'FILE_NOT_FOUND', message: 'runtime missing' }))
    await act(async () => root.render(createElement(Harness)))
    expect(typstApi.open).toHaveBeenCalledOnce()
    expect(current!.phase).toBe('error')
  })
  it('drops the former workspace root after Save As moves the document elsewhere', async () => {
    await act(async () => root.render(createElement(Harness)))
    expect(vi.mocked(typstApi.open).mock.calls[0][0].rootPath).toBe('/project')
    filePath = '/other/另存为.typ'
    await act(async () => root.render(createElement(Harness)))
    expect(vi.mocked(typstApi.open).mock.calls[1][0]).toMatchObject({ filePath, content, rootPath: undefined })
    expect(typstApi.close).toHaveBeenCalledWith('first')
  })
})
