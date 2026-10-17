import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { IPC, ok, err, type AppError, type Result, type TypstConfig, type TypstExportPayload, type TypstOpenPayload, type TypstRequestPayload, type TypstSyncPayload } from '@yitom/contracts'
import { TypstService } from '../services/typst/typst-service'
import { getWindowWorkspaceDescriptor } from '../services/workspace-bindings'
import { resolveExportSavePath } from '../services/export-save-path'

let service: TypstService | null = null
const owners = new Set<number>()
function runtime(): TypstService {
  service ??= new TypstService({
    userData: app.getPath('userData'),
    bundledExecutable: path.join(app.isPackaged ? process.resourcesPath : path.join(process.cwd(), 'apps', 'desktop', 'resources'), 'typst', process.platform === 'win32' ? 'tinymist.exe' : 'tinymist'),
    emit: (owner, event) => {
      const window = BrowserWindow.getAllWindows().find(win => win.webContents.id === owner)
      if (window && !window.webContents.isDestroyed()) window.webContents.send(IPC.TYPST_EVENT, event)
    },
  })
  return service
}
async function scoped<T>(event: IpcMainInvokeEvent, action: (service: TypstService, owner: number) => Promise<T>, cleanup = false): Promise<Result<T, AppError>> {
  try {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame) return err({ code: 'FORBIDDEN', message: 'Typst 仅允许应用主窗口调用' })
    const descriptor = getWindowWorkspaceDescriptor(event.sender.id)
    if (!cleanup && descriptor && descriptor.kind !== 'local') return err({ code: 'NOT_SUPPORTED', message: '远端工作区尚未支持 Typst 本地编译' })
    if (!owners.has(event.sender.id)) {
      owners.add(event.sender.id)
      event.sender.once('destroyed', () => { runtime().disposeOwner(event.sender.id); owners.delete(event.sender.id) })
    }
    return ok(await action(runtime(), event.sender.id))
  } catch (error) {
    const code = (error as { code?: string })?.code
    const known = new Set(['INVALID_ARGUMENT', 'INVALID_STATE', 'FORBIDDEN', 'REVISION_CONFLICT', 'CONNECTION_ERROR', 'VERSION_MISMATCH', 'FILE_NOT_FOUND', 'LIMIT_EXCEEDED', 'PROTOCOL_ERROR', 'CANCELLED'])
    return err({ code: known.has(code ?? '') ? code as AppError['code'] : 'UNKNOWN', message: error instanceof Error ? error.message : 'Typst 操作失败' })
  }
}
export function registerTypstHandlers(): void {
  ipcMain.handle(IPC.TYPST_GET_CONFIG, (event, filePath?: string) => scoped(event, service => service.getConfig(filePath)))
  ipcMain.handle(IPC.TYPST_SAVE_CONFIG, (event, config: TypstConfig, filePath?: string) => scoped(event, service => service.saveConfig(config, filePath)))
  ipcMain.handle(IPC.TYPST_STATUS, event => scoped(event, service => service.status()))
  ipcMain.handle(IPC.TYPST_OPEN, (event, payload: TypstOpenPayload) => scoped(event, (service, owner) => service.open(owner, payload)))
  ipcMain.handle(IPC.TYPST_SYNC, (event, payload: TypstSyncPayload) => scoped(event, (service, owner) => service.sync(owner, payload)))
  ipcMain.handle(IPC.TYPST_REQUEST, (event, payload: TypstRequestPayload) => scoped(event, (service, owner) => service.request(owner, payload)))
  // Workspace switches must still release an old local session; service.close enforces its owner.
  ipcMain.handle(IPC.TYPST_CLOSE, (event, sessionId: string) => scoped(event, (service, owner) => service.close(owner, sessionId), true))
  ipcMain.handle(IPC.TYPST_EXPORT_PDF, (event, payload: TypstExportPayload) => scoped(event, async (service, owner) => {
    const target = await resolveExportSavePath({ title: '导出 Typst PDF', defaultPath: 'document.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (target.canceled || !target.filePath) throw Object.assign(new Error('已取消导出'), { code: 'CANCELLED' })
    if (path.extname(target.filePath).toLowerCase() !== '.pdf') throw Object.assign(new Error('导出目标必须为 PDF 文件'), { code: 'INVALID_ARGUMENT' })
    const bytes = await service.pdf(owner, payload.sessionId, payload.version)
    const temporary = path.join(path.dirname(target.filePath), `.${path.basename(target.filePath)}.${randomUUID()}.tmp`)
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, target.filePath) }
    finally { await rm(temporary, { force: true }).catch(() => {}) }
    return { filePath: target.filePath, version: payload.version }
  }))
}
export function disposeAllTypst(): void { service?.disposeAll() }
