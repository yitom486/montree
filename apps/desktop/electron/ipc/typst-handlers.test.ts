import { EventEmitter } from 'node:events'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@yitom/contracts'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  windows: new Map<number, unknown>(), descriptor: vi.fn(),
  status: vi.fn(async () => ({ available: true })), request: vi.fn(), pdf: vi.fn(), html: vi.fn(), close: vi.fn(),
  disposeOwner: vi.fn(), disposeAll: vi.fn(), savePath: vi.fn(),
  write: vi.fn(), rename: vi.fn(), rm: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), isPackaged: false },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: (sender: { id: number }) => mocks.windows.get(sender.id), getAllWindows: () => [...mocks.windows.values()] },
}))
vi.mock('../services/workspace-bindings', () => ({ getWindowWorkspaceDescriptor: mocks.descriptor }))
vi.mock('../services/export-save-path', () => ({ resolveExportSavePath: mocks.savePath }))
vi.mock('node:fs/promises', () => ({ writeFile: mocks.write, rename: mocks.rename, rm: mocks.rm }))
vi.mock('../services/typst/typst-service', () => ({ TypstService: class {
  status = mocks.status
  request = mocks.request
  pdf = mocks.pdf
  html = mocks.html
  close = mocks.close
  disposeOwner = mocks.disposeOwner
  disposeAll = mocks.disposeAll
} }))
import { registerTypstHandlers, TYPST_EXPORT_HTML_CHANNEL } from './typst-handlers'

let nextId = 9000
class Sender extends EventEmitter {
  id = ++nextId
  mainFrame = {}
  isDestroyed() { return false }
  send() {}
}
function window() {
  const sender = new Sender()
  mocks.windows.set(sender.id, { webContents: sender })
  return sender
}
function invoke(sender: Sender, channel: string, payload?: unknown, frame: unknown = sender.mainFrame) {
  return mocks.handlers.get(channel)!({ sender, senderFrame: frame }, payload)
}
beforeAll(registerTypstHandlers)
afterEach(() => {
  for (const value of mocks.windows.values()) (value as { webContents: Sender }).webContents.emit('destroyed')
  mocks.windows.clear()
  mocks.descriptor.mockReset()
  mocks.request.mockReset(); mocks.pdf.mockReset(); mocks.html.mockReset(); mocks.savePath.mockReset()
  mocks.close.mockReset()
  mocks.write.mockReset(); mocks.rename.mockReset(); mocks.rm.mockReset()
  mocks.disposeOwner.mockClear(); mocks.status.mockClear()
})
describe('Typst IPC owner and frame boundaries', () => {
  it('rejects iframes and unregistered web contents before contacting the runtime', async () => {
    const sender = window()
    expect(await invoke(sender, IPC.TYPST_STATUS, undefined, {})).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(await invoke(new Sender(), IPC.TYPST_STATUS)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(mocks.status).not.toHaveBeenCalled()
    expect(await invoke(sender, IPC.TYPST_STATUS)).toMatchObject({ ok: true })
    expect(mocks.status).toHaveBeenCalledOnce()
  })
  it('rejects remote workspace calls even if the payload looks like a local path', async () => {
    const sender = window()
    mocks.descriptor.mockReturnValue({ kind: 'ssh', id: 'remote' })
    expect(await invoke(sender, IPC.TYPST_OPEN, { filePath: 'C:\\local.typ', content: 'local', version: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_SUPPORTED' } })
    expect(await invoke(sender, IPC.TYPST_STATUS)).toMatchObject({ ok: false, error: { code: 'NOT_SUPPORTED' } })
    expect(mocks.status).not.toHaveBeenCalled()
  })
  it('uses the trusted sender identity for cross-window requests and releases only that owner', async () => {
    const a = window(), b = window()
    const payload = { sessionId: 'a-session', method: 'textDocument/hover', params: {}, owner: a.id }
    mocks.request.mockImplementation(async (owner: number) => {
      if (owner !== a.id) throw Object.assign(new Error('foreign session'), { code: 'FORBIDDEN' })
      return { contents: 'owned' }
    })
    expect(await invoke(a, IPC.TYPST_REQUEST, payload)).toMatchObject({ ok: true, value: { contents: 'owned' } })
    expect(await invoke(b, IPC.TYPST_REQUEST, payload)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(mocks.request).toHaveBeenLastCalledWith(b.id, payload)
    a.emit('destroyed')
    expect(mocks.disposeOwner).toHaveBeenCalledWith(a.id)
    expect(mocks.disposeOwner).not.toHaveBeenCalledWith(b.id)
  })
  it('allows owned cleanup after switching to a remote workspace while rejecting foreign cleanup', async () => {
    const a = window(), b = window()
    mocks.descriptor.mockReturnValue({ kind: 'ssh', id: 'remote' })
    mocks.close.mockImplementation(async (owner: number, sessionId: string) => {
      if (owner !== a.id || sessionId !== 'old-local-session') throw Object.assign(new Error('foreign session'), { code: 'FORBIDDEN' })
    })
    expect(await invoke(a, IPC.TYPST_CLOSE, 'old-local-session')).toEqual({ ok: true, value: undefined })
    expect(mocks.close).toHaveBeenLastCalledWith(a.id, 'old-local-session')
    expect(await invoke(b, IPC.TYPST_CLOSE, 'old-local-session')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(mocks.close).toHaveBeenLastCalledWith(b.id, 'old-local-session')
    expect(await invoke(a, IPC.TYPST_STATUS)).toMatchObject({ ok: false, error: { code: 'NOT_SUPPORTED' } })
    expect(await invoke(a, IPC.TYPST_CLOSE, 'old-local-session', {})).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })
  it('returns CANCELLED without compilation or filesystem writes when export is cancelled', async () => {
    mocks.savePath.mockResolvedValue({ canceled: true })
    expect(await invoke(window(), IPC.TYPST_EXPORT_PDF, { sessionId: 'owned', version: 1 })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(mocks.pdf).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(mocks.rm).not.toHaveBeenCalled()
  })
  it('does not write an export when the runtime rejects a stale revision', async () => {
    mocks.savePath.mockResolvedValue({ canceled: false, filePath: 'document.pdf' })
    mocks.pdf.mockRejectedValue(Object.assign(new Error('revision changed'), { code: 'REVISION_CONFLICT' }))
    expect(await invoke(window(), IPC.TYPST_EXPORT_PDF, { sessionId: 'owned', version: 1 })).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } })
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.rename).not.toHaveBeenCalled()
  })
  it('exports HTML through the dedicated channel and writes the file atomically', async () => {
    mocks.savePath.mockResolvedValue({ canceled: false, filePath: 'document.html' })
    mocks.html.mockResolvedValue(Buffer.from('<!DOCTYPE html><html></html>'))
    mocks.rm.mockResolvedValue(undefined)
    const result = await invoke(window(), TYPST_EXPORT_HTML_CHANNEL, { sessionId: 'owned', version: 1 })
    expect(result).toMatchObject({ ok: true, value: { filePath: 'document.html', version: 1 } })
    expect(mocks.html).toHaveBeenCalledOnce()
    expect(mocks.pdf).not.toHaveBeenCalled()
    expect(mocks.write).toHaveBeenCalledOnce()
    expect(mocks.rename).toHaveBeenCalledOnce()
    expect(mocks.rm).toHaveBeenCalled()
  })
  it('rejects non-HTML export targets without compilation', async () => {
    mocks.savePath.mockResolvedValue({ canceled: false, filePath: 'document.pdf' })
    expect(await invoke(window(), TYPST_EXPORT_HTML_CHANNEL, { sessionId: 'owned', version: 1 })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect(mocks.html).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('returns CANCELLED without compilation when HTML export is cancelled', async () => {
    mocks.savePath.mockResolvedValue({ canceled: true })
    expect(await invoke(window(), TYPST_EXPORT_HTML_CHANNEL, { sessionId: 'owned', version: 1 })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(mocks.html).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })
})
