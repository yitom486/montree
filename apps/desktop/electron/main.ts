import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { IPC } from '@montree/contracts'
import { createWindow } from './window/create-window'
import { extractExternalFilePaths, pendingExternalFiles } from './window/external-file'
import { installAppMenu } from './window/app-menu'
import { registerIpcHandlers } from './ipc/register-handlers'
import { initAppUpdater } from './services/app-updater'
import { disposeAllAcp } from './services/acp/acp-client'
import { closeAllBookDbs } from './services/book-db/open-book-db'
import { disposeAllWorkspaceWatches } from './services/workspace-watcher'
import { syncManager } from './services/sync/sync-manager'

// 注册应用自定义深度协议 montree:// 与历史 montree://
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('montree', process.execPath, [path.resolve(process.argv[1] ?? '')])
    app.setAsDefaultProtocolClient('montree', process.execPath, [path.resolve(process.argv[1] ?? '')])
  }
} else {
  app.setAsDefaultProtocolClient('montree')
  app.setAsDefaultProtocolClient('montree')
}

// 开发环境下隔离应用数据目录，避免与已安装的正式版互相冲突锁定或污染数据；若命令行显式传入了 --user-data-dir 则优先遵循
if (!app.isPackaged) {
  const customUserDataArg = process.argv.find((arg) => arg.startsWith('--user-data-dir='))
  if (customUserDataArg) {
    const customDir = customUserDataArg.slice('--user-data-dir='.length).trim()
    if (customDir) {
      app.setPath('userData', customDir)
    }
  } else {
    app.setPath('userData', path.join(app.getPath('appData'), 'montree-dev'))
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      const deepLink = commandLine.find((arg) => arg.startsWith('montree://') || arg.startsWith('montree://'))
      if (deepLink) {
        win.webContents.send(IPC.APP_GLOBAL_ACTION, `deep-link:${deepLink}`)
      }
      // 资源管理器“打开方式”的文件路径只入队，由渲染进程取走打开；
      // 此前这里直接丢弃，是外部双击永远落回主页的原因
      queueExternalFiles(commandLine)
    }
  })
}

/** 命令行文件参数入队；不存在或非普通文件一律忽略 */
function queueExternalFiles(commandLine: readonly string[]): void {
  for (const filePath of extractExternalFilePaths(commandLine, isRegularFile)) {
    pendingExternalFiles.push(filePath)
  }
}

function isRegularFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile()
  } catch {
    return false
  }
}

// macOS：Dock/访达 open-file（可能早于 whenReady，先入队）
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  pendingExternalFiles.push(filePath)
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.APP_GLOBAL_ACTION, `deep-link:${url}`)
  }
})

app.whenReady().then(() => {
  installAppMenu()
  registerIpcHandlers()
  initAppUpdater()
  createWindow()
  // 冷启动同样可能带文件参数（应用未运行时双击文件）
  queueExternalFiles(process.argv)
  syncManager.initAutoSync()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  closeAllBookDbs()
  disposeAllAcp()
})

app.on('window-all-closed', () => {
  disposeAllWorkspaceWatches()
  disposeAllAcp()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
