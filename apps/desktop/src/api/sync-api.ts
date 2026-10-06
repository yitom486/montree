import type {
  SyncConfig,
  SyncStatus,
  TestConnectionResult,
  SyncExecuteResult,
} from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'

function requireElectronAPI() {
  if (!window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE' as const,
      message: 'Electron API 不可用',
    })
  }
  return ok(window.electronAPI)
}

export const syncApi = {
  async getConfig(): Promise<Result<SyncConfig, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.getSyncConfig()
  },

  async saveConfig(config: SyncConfig): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.saveSyncConfig(config)
  },

  async testConnection(config?: SyncConfig): Promise<Result<TestConnectionResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.testSyncConnection(config)
  },

  async runSyncNow(): Promise<Result<SyncExecuteResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.runSyncNow()
  },

  async getStatus(): Promise<Result<SyncStatus, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.getSyncStatus()
  },

  async saveLocalProgress(progressJson: string): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.saveLocalProgress(progressJson)
  },

  onStatusChanged(callback: (status: SyncStatus) => void): () => void {
    if (!window.electronAPI?.onSyncStatusChanged) return () => {}
    return window.electronAPI.onSyncStatusChanged(callback)
  },

  onApplyRemoteProgress(callback: (progressJson: string) => void): () => void {
    if (!window.electronAPI?.onApplyRemoteProgress) return () => {}
    return window.electronAPI.onApplyRemoteProgress(callback)
  },
}
