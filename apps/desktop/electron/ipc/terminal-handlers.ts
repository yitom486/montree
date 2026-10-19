import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ok, err, type Result, type AppError } from '@yitom/contracts'
import { TERMINAL_IPC, type TerminalCreate } from '../../contracts/terminal'
import { terminalProfiles } from '../services/terminal-service'
import { workspaceTerminals } from '../services/terminal-runtime'
import { getWindowWorkspaceDescriptor } from '../services/workspace-bindings'

const registered = new Set<number>()
async function scoped<T>(event: IpcMainInvokeEvent, action: (owner: string) => Promise<T> | T): Promise<Result<T, AppError>> {
  try {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return err({ code: 'FORBIDDEN', message: '终端仅允许应用主窗口调用' })
    const owner = `window-${event.sender.id}`
    if (!registered.has(event.sender.id)) {
      registered.add(event.sender.id)
      event.sender.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) workspaceTerminals.disposeOwner(owner) })
      event.sender.on('render-process-gone', () => workspaceTerminals.disposeOwner(owner))
      event.sender.once('destroyed', () => { workspaceTerminals.disposeOwner(owner); registered.delete(event.sender.id) })
    }
    return ok(await action(owner))
  } catch (error) {
    return err({ code: 'UNKNOWN', message: error instanceof Error ? error.message : '终端操作失败' })
  }
}
export function registerTerminalHandlers(): void {
  ipcMain.handle(TERMINAL_IPC.profiles, event => scoped(event, () => terminalProfiles(getWindowWorkspaceDescriptor(event.sender.id))))
  ipcMain.handle(TERMINAL_IPC.list, event => scoped(event, owner => workspaceTerminals.list(owner)))
  ipcMain.handle(TERMINAL_IPC.create, (event, params: TerminalCreate) => scoped(event, owner => {
    const workspace = getWindowWorkspaceDescriptor(event.sender.id)
    return workspaceTerminals.create(owner, workspace, params, () => !event.sender.isDestroyed()
      && getWindowWorkspaceDescriptor(event.sender.id)?.id === workspace?.id
      && getWindowWorkspaceDescriptor(event.sender.id)?.rootLabel === workspace?.rootLabel)
  }))
  ipcMain.handle(TERMINAL_IPC.write, (event, id: string, data: string) => scoped(event, owner => workspaceTerminals.write(owner, id, data)))
  ipcMain.handle(TERMINAL_IPC.resize, (event, id: string, cols: number, rows: number) => scoped(event, owner => workspaceTerminals.resize(owner, id, cols, rows)))
  ipcMain.handle(TERMINAL_IPC.read, (event, id: string, cursor?: number) => scoped(event, owner => workspaceTerminals.read(owner, id, cursor)))
  ipcMain.handle(TERMINAL_IPC.close, (event, id: string) => scoped(event, owner => workspaceTerminals.close(owner, id)))
}
