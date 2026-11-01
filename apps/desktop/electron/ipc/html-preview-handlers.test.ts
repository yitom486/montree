import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { HTML_PREVIEW_IPC } from '../../contracts/html-preview'
import { registerHtmlPreviewHandlers } from './html-preview-handlers'
import { resetHtmlPreviewsForTest } from '../services/html-preview/html-preview-protocol'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), trusted: true }))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => mocks.trusted ? {} : null },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
}))
vi.mock('../services/workspace-bindings', () => ({ getWindowWorkspaceDescriptor: () => null }))
const mainFrame = {}
const sender = { id: 1, mainFrame, once: vi.fn() }
const event = { sender, senderFrame: mainFrame }
const invoke = (channel: string, args: unknown[], source = event) => mocks.handlers.get(channel)!(source, ...args)
beforeEach(() => {
  resetHtmlPreviewsForTest()
  mocks.trusted = true
  registerHtmlPreviewHandlers()
})
describe('HTML preview IPC authorization', () => {
  it('子 frame 和未知窗口不能登记或解析预览链接', async () => {
    const child = { ...event, senderFrame: {} }
    expect(invoke(HTML_PREVIEW_IPC.register, ['page.html'], child).error.code).toBe('FORBIDDEN')
    expect((await invoke(HTML_PREVIEW_IPC.resolveLink, ['token', 'https://example.com'], child)).error.code).toBe('FORBIDDEN')
    mocks.trusted = false
    expect(invoke(HTML_PREVIEW_IPC.register, ['page.html']).error.code).toBe('FORBIDDEN')
  })
  it('仅登记窗口能解析链接，释放后拒绝旧 token，拒绝无效参数', async () => {
    const { value: registration } = invoke(HTML_PREVIEW_IPC.register, [join(process.cwd(), 'page.html')])
    expect((await invoke(HTML_PREVIEW_IPC.resolveLink, [registration.token, 'https://example.com/'])).value).toEqual({ type: 'external', url: 'https://example.com/' })
    const other = { sender: { ...sender, id: 2 }, senderFrame: mainFrame }
    expect((await invoke(HTML_PREVIEW_IPC.resolveLink, [registration.token, 'https://example.com/'], other)).error.code).toBe('FORBIDDEN')
    invoke(HTML_PREVIEW_IPC.release, [registration.token])
    expect((await invoke(HTML_PREVIEW_IPC.resolveLink, [registration.token, 'https://example.com/'])).error.code).toBe('FORBIDDEN')
    expect((await invoke(HTML_PREVIEW_IPC.resolveLink, [null, {}])).error.code).toBe('INVALID_ARGUMENT')
  })
})
