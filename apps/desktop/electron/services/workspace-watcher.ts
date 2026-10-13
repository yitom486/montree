import { watch, type FSWatcher } from 'fs'
import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '@montree/contracts'
import { LOCAL_WORKSPACE_ID } from '@montree/contracts'

/** 与 VS Code 类似：合并短时间内的多次 fs 事件后再通知渲染进程重扫 */
export const WORKSPACE_WATCH_DEBOUNCE_MS = 400

/** watch 订阅的身份（A1）：事件携带代际，旧工作区事件不得污染新状态。 */
export interface WorkspaceWatchIdentity {
  workspaceId?: string
  generation?: number
}

/** B3：合并窗口内最多携带的目录数（超则截断并标记，调用方回落全量重扫） */
export const WORKSPACE_WATCH_MAX_DIRS = 20

/**
 * B3：监听噪声目录（段精确匹配）：依赖/构建产物/Git 内部/应用缓存。
 * 点开头段沿用旧规则（隐藏文件/临时文件）一并忽略。
 */
const WATCH_NOISE_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.montree',
  'dist',
  'out',
  'release',
])

type WatchEntry = {
  rootPath: string
  workspaceId: string
  generation: number
  watcher: FSWatcher
  debounceTimer: ReturnType<typeof setTimeout> | null
  /** B3：合并窗口内变化涉及的相对目录（posix），按需刷新用 */
  pendingDirs: Set<string>
  pendingTruncated: boolean
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
    // B3：node_modules/构建产物/Git 内部/应用缓存噪声不触发重扫
    if (WATCH_NOISE_DIR_SEGMENTS.has(segment)) return true
  }
  return false
}

/**
 * B3：取变化文件所在的相对目录（posix，根直属文件记 `.`）。
 * filename 为 null（粗粒度事件）时返回 null，调用方回落全量重扫。
 */
export function watchEventDir(filename: string | Buffer | null): string | null {
  if (filename === null) return null
  const name = (typeof filename === 'string' ? filename : filename.toString('utf8')).replace(
    /\\/g,
    '/',
  )
  if (!name) return null
  const idx = name.lastIndexOf('/')
  if (idx <= 0) return '.'
  return name.slice(0, idx)
}

function clearWatchEntry(entry: WatchEntry): void {
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer)
    entry.debounceTimer = null
  }
  entry.watcher.close()
}

function notifyWorkspaceChanged(webContentsId: number, rootPath: string): void {
  const entry = watchesByWebContentsId.get(webContentsId)
  const target = BrowserWindow.getAllWindows().find(
    (win) => !win.isDestroyed() && win.webContents.id === webContentsId,
  )
  const dirs = entry && entry.pendingDirs.size > 0 ? [...entry.pendingDirs].sort() : undefined
  if (entry) {
    entry.pendingDirs.clear()
  }
  target?.webContents.send(IPC.WORKSPACE_CHANGED, {
    rootPath,
    workspaceId: entry?.workspaceId ?? LOCAL_WORKSPACE_ID,
    generation: entry?.generation ?? 0,
    // B3：按目录刷新（缺席/截断时调用方回落全量重扫）
    ...(dirs ? { dirs } : {}),
    ...(entry?.pendingTruncated ? { truncatedDirs: true } : {}),
  })
  if (entry) {
    entry.pendingTruncated = false
  }
}

function scheduleWorkspaceChanged(
  webContentsId: number,
  rootPath: string,
  filename: string | Buffer | null,
): void {
  const entry = watchesByWebContentsId.get(webContentsId)
  if (!entry) return

  // B3：合并窗口内收集变化目录（截断时标记，通知后清空）
  const dir = watchEventDir(filename)
  if (dir === null) {
    entry.pendingDirs.clear()
    entry.pendingTruncated = true
  } else if (!entry.pendingTruncated) {
    if (entry.pendingDirs.size >= WORKSPACE_WATCH_MAX_DIRS) {
      entry.pendingDirs.clear()
      entry.pendingTruncated = true
    } else {
      entry.pendingDirs.add(dir)
    }
  }

  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer)
  }

  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null
    notifyWorkspaceChanged(webContentsId, rootPath)
  }, WORKSPACE_WATCH_DEBOUNCE_MS)
}

function startWatch(
  webContentsId: number,
  rootPath: string,
  identity: WorkspaceWatchIdentity = {},
): void {
  stopWorkspaceWatch(webContentsId)

  let watcher: FSWatcher
  try {
    watcher = watch(rootPath, { recursive: true }, (_eventType, filename) => {
      if (shouldIgnoreWatchFilename(filename)) return
      scheduleWorkspaceChanged(webContentsId, rootPath, filename)
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
    workspaceId: identity.workspaceId ?? LOCAL_WORKSPACE_ID,
    generation: identity.generation ?? 0,
    watcher,
    debounceTimer: null,
    pendingDirs: new Set(),
    pendingTruncated: false,
  })
}

export function setWorkspaceWatch(
  webContents: WebContents,
  rootPath: string,
  identity: WorkspaceWatchIdentity = {},
): void {
  const id = webContents.id
  const existing = watchesByWebContentsId.get(id)
  if (
    existing?.rootPath === rootPath &&
    existing.workspaceId === (identity.workspaceId ?? existing.workspaceId) &&
    existing.generation === (identity.generation ?? existing.generation)
  ) {
    return
  }

  startWatch(id, rootPath, identity)

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
