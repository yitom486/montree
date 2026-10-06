import { watch, type FSWatcher } from 'fs'
import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '@montree/contracts'

/** 与 VS Code 类似：合并短时间内的多次 fs 事件后再通知渲染进程重扫 */
export const WORKSPACE_WATCH_DEBOUNCE_MS = 400

type WatchEntry = {
  rootPath: string
  watcher: FSWatcher
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const watchesByWebContentsId = new Map<number, WatchEntry>()
const destroyHandlersRegistered = new Set<number>()

export function shouldIgnoreWatchFilename(filename: string | Buffer | null): boolean {
  if (filename === null) return false
  const name = typeof filename === 'string' ? filename : filename.toString('utf8')
  if (!name) return false

  const segments = name.split(/[/\\]/)
  for (const segment of segments) {
    if (!segment) continue
    if (segment.startsWith('.') || segment.startsWith('~')) return true
    if (segment.endsWith('.tmp')) return true
  }
  return false
}

function clearWatchEntry(entry: WatchEntry): void {
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer)
    entry.debounceTimer = null
  }
  entry.watcher.close()
}

function notifyWorkspaceChanged(webContentsId: number, rootPath: string): void {
  const target = BrowserWindow.getAllWindows().find(
    (win) => !win.isDestroyed() && win.webContents.id === webContentsId,
  )
  target?.webContents.send(IPC.WORKSPACE_CHANGED, { rootPath })
}

function scheduleWorkspaceChanged(webContentsId: number, rootPath: string): void {
  const entry = watchesByWebContentsId.get(webContentsId)
  if (!entry) return

  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer)
  }

  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null
    notifyWorkspaceChanged(webContentsId, rootPath)
  }, WORKSPACE_WATCH_DEBOUNCE_MS)
}

function startWatch(webContentsId: number, rootPath: string): void {
  stopWorkspaceWatch(webContentsId)

  let watcher: FSWatcher
  try {
    watcher = watch(rootPath, { recursive: true }, (_eventType, filename) => {
      if (shouldIgnoreWatchFilename(filename)) return
      scheduleWorkspaceChanged(webContentsId, rootPath)
    })
  } catch (error) {
    console.error('[workspace-watcher] 无法监听目录', rootPath, error)
    return
  }

  watcher.on('error', (error) => {
    console.error('[workspace-watcher] 监听错误', rootPath, error)
  })

  watchesByWebContentsId.set(webContentsId, {
    rootPath,
    watcher,
    debounceTimer: null,
  })
}

export function setWorkspaceWatch(webContents: WebContents, rootPath: string): void {
  const id = webContents.id
  const existing = watchesByWebContentsId.get(id)
  if (existing?.rootPath === rootPath) return

  startWatch(id, rootPath)

  if (!destroyHandlersRegistered.has(id)) {
    destroyHandlersRegistered.add(id)
    webContents.once('destroyed', () => {
      destroyHandlersRegistered.delete(id)
      stopWorkspaceWatch(id)
    })
  }
}

export function stopWorkspaceWatch(webContentsId: number): void {
  const entry = watchesByWebContentsId.get(webContentsId)
  if (!entry) return
  clearWatchEntry(entry)
  watchesByWebContentsId.delete(webContentsId)
}

export function disposeAllWorkspaceWatches(): void {
  for (const id of [...watchesByWebContentsId.keys()]) {
    stopWorkspaceWatch(id)
  }
}
