import { createRequire } from 'node:module'
import { BrowserWindow, app } from 'electron'
import { IPC } from '@montree/contracts'
import type { AppUpdateStatus } from '@montree/contracts'

const cjsRequire = createRequire(import.meta.url)

type AutoUpdaterInstance = import('electron-updater').AppUpdater

let autoUpdater: AutoUpdaterInstance | null = null
let lastStatus: AppUpdateStatus = { phase: 'idle' }

function resolveAutoUpdater(): AutoUpdaterInstance | null {
  if (!app.isPackaged) return null
  if (autoUpdater) return autoUpdater

  try {
    autoUpdater = cjsRequire('electron-updater').autoUpdater as AutoUpdaterInstance
    return autoUpdater
  } catch (cause) {
    console.warn('[app-updater] 加载 electron-updater 失败', cause)
    return null
  }
}

function broadcastStatus(status: AppUpdateStatus): void {
  lastStatus = status
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.APP_UPDATE_STATUS, status)
    }
  }
}

function devOnlyMessage(): AppUpdateStatus {
  return {
    phase: 'error',
    currentVersion: app.getVersion(),
    message: '开发模式不支持自动更新，请下载安装包或使用已打包版本',
  }
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return lastStatus
}

export async function checkAppUpdate(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    const status = devOnlyMessage()
    broadcastStatus(status)
    return status
  }

  const updater = resolveAutoUpdater()
  if (!updater) {
    const status: AppUpdateStatus = {
      phase: 'error',
      currentVersion: app.getVersion(),
      message: '更新模块不可用',
    }
    broadcastStatus(status)
    return status
  }

  broadcastStatus({
    phase: 'checking',
    currentVersion: app.getVersion(),
  })

  try {
    const result = await updater.checkForUpdates()
    if (!result?.updateInfo) {
      const status: AppUpdateStatus = {
        phase: 'not-available',
        currentVersion: app.getVersion(),
        message: '当前已是最新版本',
      }
      broadcastStatus(status)
      return status
    }
    return lastStatus
  } catch (cause) {
    const status: AppUpdateStatus = {
      phase: 'error',
      currentVersion: app.getVersion(),
      message: cause instanceof Error ? cause.message : '检查更新失败',
    }
    broadcastStatus(status)
    return status
  }
}

export async function downloadAppUpdate(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    const status = devOnlyMessage()
    broadcastStatus(status)
    return status
  }

  const updater = resolveAutoUpdater()
  if (!updater) {
    const status: AppUpdateStatus = {
      phase: 'error',
      message: '更新模块不可用',
    }
    broadcastStatus(status)
    return status
  }

  if (lastStatus.phase !== 'available' && lastStatus.phase !== 'downloading') {
    const status: AppUpdateStatus = {
      phase: 'error',
      message: '请先检查更新并确认有新版本',
    }
    broadcastStatus(status)
    return status
  }

  try {
    await updater.downloadUpdate()
    return lastStatus
  } catch (cause) {
    const status: AppUpdateStatus = {
      phase: 'error',
      currentVersion: app.getVersion(),
      message: cause instanceof Error ? cause.message : '下载更新失败',
    }
    broadcastStatus(status)
    return status
  }
}

export function installAppUpdate(): void {
  if (!app.isPackaged) return
  if (lastStatus.phase !== 'downloaded') return
  resolveAutoUpdater()?.quitAndInstall()
}

export function initAppUpdater(): void {
  if (!app.isPackaged) return

  const updater = resolveAutoUpdater()
  if (!updater) return

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true

  updater.on('checking-for-update', () => {
    broadcastStatus({
      phase: 'checking',
      currentVersion: app.getVersion(),
    })
  })

  updater.on('update-available', (info) => {
    broadcastStatus({
      phase: 'available',
      currentVersion: app.getVersion(),
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map((item) => item.note).filter(Boolean).join('\n\n')
            : undefined,
      message: `发现新版本 v${info.version}`,
    })
  })

  updater.on('update-not-available', () => {
    broadcastStatus({
      phase: 'not-available',
      currentVersion: app.getVersion(),
      message: '当前已是最新版本',
    })
  })

  updater.on('download-progress', (progress) => {
    broadcastStatus({
      phase: 'downloading',
      currentVersion: app.getVersion(),
      version: lastStatus.version,
      percent: Math.round(progress.percent),
      message: `正在下载更新… ${Math.round(progress.percent)}%`,
    })
  })

  updater.on('update-downloaded', (info) => {
    broadcastStatus({
      phase: 'downloaded',
      currentVersion: app.getVersion(),
      version: info.version,
      message: `v${info.version} 已下载，重启后即可安装`,
    })
  })

  updater.on('error', (error) => {
    broadcastStatus({
      phase: 'error',
      currentVersion: app.getVersion(),
      message: error.message || '更新失败',
    })
  })

  setTimeout(() => {
    void checkAppUpdate().catch(() => {
      // 错误已由 error 事件广播
    })
  }, 5_000)
}
