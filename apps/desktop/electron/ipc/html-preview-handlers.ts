import { BrowserWindow, ipcMain, protocol, type IpcMainInvokeEvent } from 'electron'
import { err, ok, type AppError, type Result } from '@yitom/contracts'
import { HTML_PREVIEW_IPC, HTML_PREVIEW_SCHEME } from '../../contracts/html-preview'
import { getWindowWorkspaceDescriptor } from '../services/workspace-bindings'
import {
  handleHtmlPreviewRequest,
  registerHtmlPreview,
  releaseHtmlPreview,
  releaseHtmlPreviewsFor,
  updateHtmlPreview,
} from '../services/html-preview/html-preview-protocol'

/** 必须在 app ready 之前调用：standard + secure 让预览页拥有正常的源、存储与安全上下文。 */
export function registerHtmlPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: HTML_PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ])
}

const trackedOwners = new Set<number>()

function fromMainFrame(event: IpcMainInvokeEvent): boolean {
  return Boolean(BrowserWindow.fromWebContents(event.sender)) && event.senderFrame === event.sender.mainFrame
}

function forbidden<T>(): Result<T, AppError> {
  return err({ code: 'FORBIDDEN', message: '仅允许应用主窗口管理 HTML 预览' })
}

export function registerHtmlPreviewHandlers(): void {
  protocol.handle(HTML_PREVIEW_SCHEME, (request) => handleHtmlPreviewRequest(request))

  ipcMain.handle(HTML_PREVIEW_IPC.register, (event, filePath: unknown) => {
    if (!fromMainFrame(event)) return forbidden()
    if (typeof filePath !== 'string' || !filePath) return err({ code: 'INVALID_ARGUMENT', message: '缺少 HTML 文件路径' })
    const ownerId = event.sender.id
    if (!trackedOwners.has(ownerId)) {
      trackedOwners.add(ownerId)
      event.sender.once('destroyed', () => {
        trackedOwners.delete(ownerId)
        releaseHtmlPreviewsFor(ownerId)
      })
    }
    const workspace = getWindowWorkspaceDescriptor(ownerId)
    return ok(registerHtmlPreview({
      ownerId,
      filePath,
      workspaceRoot: workspace?.kind === 'local' ? workspace.rootLabel : null,
    }))
  })

  ipcMain.handle(HTML_PREVIEW_IPC.update, (event, token: unknown, html: unknown) => {
    if (!fromMainFrame(event)) return forbidden()
    if (typeof token !== 'string' || typeof html !== 'string') return err({ code: 'INVALID_ARGUMENT', message: 'HTML 预览参数无效' })
    return updateHtmlPreview(event.sender.id, token, html)
      ? ok(undefined)
      : err({ code: 'INVALID_STATE', message: 'HTML 预览已失效，请重新打开文件' })
  })

  ipcMain.handle(HTML_PREVIEW_IPC.release, (event, token: unknown) => {
    if (!fromMainFrame(event)) return forbidden()
    if (typeof token === 'string') releaseHtmlPreview(event.sender.id, token)
    return ok(undefined)
  })
}
