import { mkdir } from 'node:fs/promises'
import { BrowserWindow, app } from 'electron'
import { IPC } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import { toAppError, type AppError } from '@montree/contracts'
import type {
  SyncConfig,
  SyncStatus,
  SyncExecuteResult,
  TestConnectionResult,
  SyncStats,
} from '@montree/contracts'
import { WebDavStorageAdapter } from './webdav-adapter'
import { readSyncConfig } from './sync-config-service'
import { readMarksStore, writeMarksStore } from '../reading-marks-service'
import { mergeReadingMarks, type SyncMarksPayload } from '@montree/annotations'
import { readLocalProgress, writeLocalProgress } from './reading-progress-sync'
import { mergeReadingProgress, type ReadingProgressSnapshot } from './mergers/progress-merger'
import { readQuizJsonlForSync, writeQuizJsonlForSync } from '../quiz-service'
import { mergeQuizSessions } from './mergers/quiz-merger'

class SyncManager {
  private status: SyncStatus = {
    phase: 'idle',
  }
  private isSyncing = false

  getStatus(): SyncStatus {
    return this.status
  }

  private broadcastStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SYNC_STATUS_CHANGED, this.status)
      }
    }
  }

  private broadcastRemoteProgress(snapshot: ReadingProgressSnapshot): void {
    const json = JSON.stringify(snapshot)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SYNC_APPLY_REMOTE_PROGRESS, json)
      }
    }
  }

  async testConnection(customConfig?: SyncConfig): Promise<Result<TestConnectionResult, AppError>> {
    let config = customConfig
    if (!config) {
      const configRes = await readSyncConfig()
      if (!configRes.ok) return configRes
      config = configRes.value
    }

    if (!config.serverUrl?.trim() || !config.username?.trim() || !config.password?.trim()) {
      return err({
        code: 'INVALID_ARGUMENT',
        message: '请先完整填写服务器地址、用户名与应用密码',
      })
    }

    const adapter = new WebDavStorageAdapter({
      serverUrl: config.serverUrl,
      username: config.username,
      password: config.password,
      ignoreTlsErrors: config.ignoreTlsErrors,
    })

    const testRes = await adapter.testConnection()
    if (!testRes.ok) return testRes

    const ensureRes = await adapter.ensureDir(config.remoteDir || '/MontreeSync')
    if (!ensureRes.ok) return ensureRes

    return ok({
      ok: true,
      latencyMs: testRes.value.latencyMs,
      remoteDir: config.remoteDir || '/MontreeSync',
      message: '连接与目录权限校验成功',
    })
  }

  async runSyncNow(): Promise<Result<SyncExecuteResult, AppError>> {
    if (this.isSyncing) {
      return err({ code: 'INVALID_STATE', message: '当前已有同步任务正在进行中' })
    }

    const configRes = await readSyncConfig()
    if (!configRes.ok) return configRes
    const config = configRes.value

    if (!config.enabled) {
      return err({ code: 'INVALID_STATE', message: '云同步功能未开启，请先在设置中启用' })
    }

    if (!config.serverUrl?.trim() || !config.username?.trim() || !config.password?.trim()) {
      return err({ code: 'INVALID_ARGUMENT', message: '云同步配置未完善，缺少服务器或账号密码' })
    }

    this.isSyncing = true
    this.broadcastStatus({ phase: 'syncing', message: '正在同步云端数据…', error: undefined })

    const remoteDir = (config.remoteDir || '/MontreeSync').replace(/^\/+|\/+$/g, '')
    const stats: SyncStats = {
      marksAdded: 0,
      marksUpdated: 0,
      progressUpdated: 0,
      quizAdded: 0,
    }

    try {
      const adapter = new WebDavStorageAdapter({
        serverUrl: config.serverUrl,
        username: config.username,
        password: config.password,
        ignoreTlsErrors: config.ignoreTlsErrors,
      })

      // 1. 确保云端主目录
      const dirRes = await adapter.ensureDir(remoteDir)
      if (!dirRes.ok) throw new Error(dirRes.error.message)

      // 2. 同步书签与划线批注 (reading-marks.json)
      const remoteMarksPath = `${remoteDir}/reading-marks.json`
      const localMarks = await readMarksStore()

      let remoteMarks: SyncMarksPayload = { marks: [] }
      const remoteMarksRes = await adapter.downloadFile(remoteMarksPath)
      if (remoteMarksRes.ok) {
        try {
          remoteMarks = JSON.parse(remoteMarksRes.value) as SyncMarksPayload
        } catch {}
      }

      const marksMerge = mergeReadingMarks(localMarks, remoteMarks)
      stats.marksAdded = marksMerge.addedCount
      stats.marksUpdated = marksMerge.updatedCount

      // 保存本地与远端
      await writeMarksStore(marksMerge.merged)
      const uploadMarksRes = await adapter.uploadFile(
        remoteMarksPath,
        JSON.stringify(marksMerge.merged, null, 2),
      )
      if (!uploadMarksRes.ok) throw new Error(uploadMarksRes.error.message)

      // 3. 同步阅读进度 (reading-progress.json)
      const remoteProgressPath = `${remoteDir}/reading-progress.json`
      const localProgress = await readLocalProgress()

      let remoteProgress: ReadingProgressSnapshot = {}
      const remoteProgressRes = await adapter.downloadFile(remoteProgressPath)
      if (remoteProgressRes.ok) {
        try {
          remoteProgress = JSON.parse(remoteProgressRes.value) as ReadingProgressSnapshot
        } catch {}
      }

      const progressMerge = mergeReadingProgress(localProgress, remoteProgress)
      stats.progressUpdated = progressMerge.updatedCount

      await writeLocalProgress(progressMerge.merged)
      const uploadProgressRes = await adapter.uploadFile(
        remoteProgressPath,
        JSON.stringify(progressMerge.merged, null, 2),
      )
      if (!uploadProgressRes.ok) throw new Error(uploadProgressRes.error.message)

      // 广播给渲染进程热载入最新进度
      this.broadcastRemoteProgress(progressMerge.merged)

      // 4. 同步 AI 测验档案 (quiz-records.jsonl；本地后端可能是 montree.db，传输格式不变)
      const remoteQuizPath = `${remoteDir}/quiz-records.jsonl`
      let localQuizJsonl = ''
      try {
        localQuizJsonl = await readQuizJsonlForSync()
      } catch {}

      let remoteQuizJsonl = ''
      const remoteQuizRes = await adapter.downloadFile(remoteQuizPath)
      if (remoteQuizRes.ok) {
        remoteQuizJsonl = remoteQuizRes.value
      }

      const quizMerge = mergeQuizSessions(localQuizJsonl, remoteQuizJsonl)
      stats.quizAdded = quizMerge.addedCount

      await mkdir(app.getPath('userData'), { recursive: true })
      await writeQuizJsonlForSync(quizMerge.mergedJsonl)
      const uploadQuizRes = await adapter.uploadFile(remoteQuizPath, quizMerge.mergedJsonl)
      if (!uploadQuizRes.ok) throw new Error(uploadQuizRes.error.message)

      const timestamp = Date.now()
      this.broadcastStatus({
        phase: 'success',
        lastSyncTime: timestamp,
        message: `同步成功 (更新划线 ${stats.marksAdded + stats.marksUpdated}，进度 ${stats.progressUpdated}，测验 ${stats.quizAdded})`,
        stats,
      })

      return ok({
        success: true,
        timestamp,
        stats,
      })
    } catch (cause) {
      const errObj = toAppError(cause, '云端同步执行失败')
      this.broadcastStatus({
        phase: 'error',
        error: errObj.message,
        message: '同步出错',
      })
      return err(errObj)
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * 应用启动时自动触发同步
   */
  initAutoSync(): void {
    void (async () => {
      // 启动缓冲 3 秒，等待渲染主窗口就绪
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const configRes = await readSyncConfig()
      if (configRes.ok && configRes.value.enabled && configRes.value.syncOnStartup) {
        await this.runSyncNow()
      }
    })()
  }
}

export const syncManager = new SyncManager()
