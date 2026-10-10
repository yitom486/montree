import { BrowserWindow, type WebContents } from 'electron'
import type { RendererHealth } from './close-gate'
import type { WindowCloseController } from './window-close'

export interface WindowSession {
  window: BrowserWindow
  allowClose: boolean
  documentDirty: boolean
  rendererHealth: RendererHealth
  closeController: WindowCloseController
  /** 通过「新建窗口」创建时为 true，渲染进程不恢复工作区/上次文件 */
  isFresh: boolean
  windowScopeId?: string
}

const sessions = new Map<number, WindowSession>()

export function registerWindowSession(session: WindowSession): void {
  sessions.set(session.window.id, session)
}

export function unregisterWindowSession(window: BrowserWindow): void {
  sessions.delete(window.id)
}

export function getWindowSession(window: BrowserWindow | null | undefined): WindowSession | undefined {
  if (!window || window.isDestroyed()) return undefined
  return sessions.get(window.id)
}

export function getWindowSessionByWebContents(
  webContents: WebContents,
): WindowSession | undefined {
  const window = BrowserWindow.fromWebContents(webContents)
  return getWindowSession(window ?? null)
}
