import { afterEach, describe, expect, it, vi } from 'vitest'
import { ok, err, type TypstEvent, type TypstSession } from '@yitom/contracts'
import { TypstSessionController, type TypstSessionPort, type TypstSessionState } from './typst-session'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const session: TypstSession = { sessionId: 'session-a', uri: 'file:///project/main.typ', filePath: '/project/main.typ', rootPath: '/project', capabilities: {}, previewUrl: 'http://127.0.0.1:12345/' }
function setup() {
  let eventListener: (event: TypstEvent) => void = () => {}
  const unsubscribe = vi.fn()
  const port = {
    open: vi.fn<TypstSessionPort['open']>(async () => ok(session)),
    sync: vi.fn<TypstSessionPort['sync']>(async () => ok(undefined)),
    request: vi.fn<TypstSessionPort['request']>(async () => ok({ contents: 'help' })),
    close: vi.fn<TypstSessionPort['close']>(async () => ok(undefined)),
    exportPdf: vi.fn<TypstSessionPort['exportPdf']>(async () => ok({ filePath: '/project/output.pdf', version: 1 })),
    exportHtml: vi.fn<TypstSessionPort['exportHtml']>(async () => ok({ filePath: '/project/output.html', version: 1 })),
    onEvent: vi.fn<TypstSessionPort['onEvent']>((listener) => { eventListener = listener; return unsubscribe }),
  }
  const states: TypstSessionState[] = []
  const controller = new TypstSessionController(port, { filePath: session.filePath, content: '= 原文' }, (state) => states.push(state))
  return { port, states, controller, unsubscribe, emit: (event: TypstEvent) => eventListener(event) }
}
afterEach(() => vi.useRealTimers())

describe('Typst session lifetime and unsaved buffer', () => {
  it('opens the current buffer and closes a session that finishes after unmount', async () => {
    const { port, controller, states, unsubscribe } = setup()
    const pending = deferred<Awaited<ReturnType<TypstSessionPort['open']>>>()
    port.open.mockReturnValue(pending.promise)
    const start = controller.start()
    controller.dispose()
    pending.resolve(ok(session)); await start
    expect(port.open).toHaveBeenCalledWith({ filePath: session.filePath, content: '= 原文', version: 1 })
    expect(port.close).toHaveBeenCalledWith('session-a')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(states).toEqual([])
  })
  it('syncs edits made while the native runtime was still starting', async () => {
    const { port, controller } = setup()
    const pending = deferred<Awaited<ReturnType<TypstSessionPort['open']>>>()
    port.open.mockReturnValue(pending.promise)
    const start = controller.start()
    controller.updateContent('= 未保存的中文😀')
    pending.resolve(ok(session)); await start
    expect(port.sync).toHaveBeenCalledWith({ sessionId: 'session-a', content: '= 未保存的中文😀', version: 2 })
    controller.dispose()
  })
  it('coalesces typing and flushes before a completion request without writing files', async () => {
    vi.useFakeTimers()
    const { controller, port } = setup()
    await controller.start()
    controller.updateContent('#te'); controller.updateContent('#text')
    expect(port.sync).not.toHaveBeenCalled()
    await controller.request('textDocument/completion', { textDocument: { uri: session.uri } })
    expect(port.sync).toHaveBeenCalledTimes(1)
    expect(port.sync.mock.calls[0][0]).toEqual({ sessionId: 'session-a', content: '#text', version: 3 })
    expect(port.request.mock.invocationCallOrder[0]).toBeGreaterThan(port.sync.mock.invocationCallOrder[0])
    expect(port.request.mock.calls[0][0].version).toBe(3)
    controller.dispose()
  })
  it('discards a completion response after another edit', async () => {
    const { controller, port } = setup()
    await controller.start()
    const pending = deferred<Awaited<ReturnType<TypstSessionPort['request']>>>()
    port.request.mockReturnValue(pending.promise)
    const response = controller.request('textDocument/completion', {})
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    controller.updateContent('= changed')
    pending.resolve(ok([{ label: 'stale' }]))
    expect(await response).toBeNull()
    controller.dispose()
  })
  it('ignores cross-session and stale diagnostics and clears errors on editing', async () => {
    const { controller, emit, states } = setup()
    await controller.start()
    const params = { uri: session.uri, diagnostics: [{ message: 'bad', severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] }
    emit({ sessionId: 'other', type: 'notification', method: 'textDocument/publishDiagnostics', params, version: 1 })
    expect(states.at(-1)?.diagnostics).toEqual([])
    emit({ sessionId: session.sessionId, type: 'notification', method: 'textDocument/publishDiagnostics', params, version: 1 })
    expect(states.at(-1)?.diagnostics).toHaveLength(1)
    controller.updateContent('= fixed')
    emit({ sessionId: session.sessionId, type: 'notification', method: 'textDocument/publishDiagnostics', params, version: 1 })
    expect(states.at(-1)?.diagnostics).toEqual([])
    controller.dispose()
  })
  it('keeps compilation diagnostics delivered before the open result', async () => {
    const { controller, emit, port, states } = setup()
    port.open.mockImplementation(async () => {
      emit({ sessionId: session.sessionId, type: 'notification', method: 'textDocument/publishDiagnostics', version: 1,
        params: { uri: session.uri, diagnostics: [{ message: 'early error' }] } })
      return ok(session)
    })
    await controller.start()
    expect(states.at(-1)?.diagnostics).toHaveLength(1)
    controller.dispose()
  })
  it('labels versionless diagnostics as provisional and ignores them while local edits await sync', async () => {
    const { controller, emit, states } = setup()
    await controller.start()
    const event: TypstEvent = { sessionId: session.sessionId, type: 'notification', method: 'textDocument/publishDiagnostics', version: null,
      params: { uri: session.uri, diagnostics: [{ message: 'unversioned' }] } }
    emit(event)
    expect(states.at(-1)?.diagnosticsUnversioned).toBe(true)
    controller.updateContent('= changed'); emit(event)
    expect(states.at(-1)?.diagnostics).toEqual([])
    controller.dispose()
  })
  it('treats versionless compile success as informational and clears it on editing', async () => {
    const { controller, emit, states } = setup()
    await controller.start()
    emit({ sessionId: session.sessionId, type: 'notification', method: 'tinymist/compileStatus', version: null,
      params: { path: '/main.typ', status: 'compileSuccess', pageCount: 1 } })
    expect(states.at(-1)?.compileStatus).toBe('compileSuccess')
    controller.updateContent('= changed')
    expect(states.at(-1)?.compileStatus).toBeNull()
    controller.dispose()
  })
  it('serializes in-flight sync before sending a newer buffer for hover', async () => {
    const { controller, port } = setup()
    await controller.start()
    const first = deferred<Awaited<ReturnType<TypstSessionPort['sync']>>>()
    port.sync.mockReturnValueOnce(first.promise)
    controller.updateContent('first')
    const flushing = controller.flush()
    await Promise.resolve()
    controller.updateContent('second')
    const response = controller.request('textDocument/hover', {})
    expect(port.request).not.toHaveBeenCalled()
    first.resolve(ok(undefined)); await flushing; await response
    expect(port.sync.mock.calls.map(([payload]) => payload.content)).toEqual(['first', 'second'])
    expect(port.request.mock.calls[0][0].version).toBe(3)
    controller.dispose()
  })
  it('flushes the current source before explicit export and treats dialog cancellation silently', async () => {
    const { controller, port } = setup()
    await controller.start(); controller.updateContent('= draft')
    port.exportPdf.mockResolvedValue(err({ code: 'CANCELLED', message: 'cancel' }))
    expect(await controller.exportPdf()).toBeNull()
    expect(port.exportPdf).toHaveBeenCalledWith({ sessionId: session.sessionId, version: 2 })
    expect(port.exportPdf.mock.invocationCallOrder[0]).toBeGreaterThan(port.sync.mock.invocationCallOrder[0])
    controller.dispose()
  })
  it('routes HTML export through the same flush-then-export path as PDF', async () => {
    const { controller, port } = setup()
    await controller.start(); controller.updateContent('= draft')
    expect(await controller.exportHtml()).toEqual({ filePath: '/project/output.html', version: 1 })
    expect(port.exportHtml).toHaveBeenCalledWith({ sessionId: session.sessionId, version: 2 })
    expect(port.exportHtml.mock.invocationCallOrder[0]).toBeGreaterThan(port.sync.mock.invocationCallOrder[0])
    controller.dispose()
  })
  it('stops issuing language requests after the runtime exits', async () => {
    const { controller, port, emit, states } = setup()
    await controller.start()
    emit({ type: 'exit', sessionId: session.sessionId, message: '进程已退出' })
    expect(states.at(-1)?.phase).toBe('error')
    expect(await controller.request('textDocument/hover', {})).toBeNull()
    expect(port.request).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('does not resurrect a runtime that exits while a sync is pending', async () => {
    const { controller, port, emit, states } = setup()
    await controller.start()
    const pending = deferred<Awaited<ReturnType<TypstSessionPort['sync']>>>()
    port.sync.mockReturnValue(pending.promise)
    controller.updateContent('= pending')
    const flushing = controller.flush(); await Promise.resolve()
    emit({ type: 'exit', sessionId: session.sessionId, message: 'crashed' })
    pending.resolve(ok(undefined)); await flushing
    expect(states.at(-1)?.phase).toBe('error')
    expect(await controller.request('textDocument/hover', {})).toBeNull()
    expect(port.request).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('discards pending language results after a process exit', async () => {
    const { controller, port, emit } = setup()
    await controller.start()
    const pending = deferred<Awaited<ReturnType<TypstSessionPort['request']>>>()
    port.request.mockReturnValue(pending.promise)
    const response = controller.request('textDocument/hover', {})
    await vi.waitFor(() => expect(port.request).toHaveBeenCalledOnce())
    emit({ type: 'exit', sessionId: session.sessionId, message: 'crashed' })
    pending.resolve(ok({ contents: 'stale' }))
    expect(await response).toBeNull()
    controller.dispose()
  })
})
