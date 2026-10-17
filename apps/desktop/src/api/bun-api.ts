import type { BunRuntimeStatus } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import type { Result } from '@yitom/contracts'

function api() {
  if (!window.electronAPI) {
    throw new Error('electronAPI 不可用')
  }
  return window.electronAPI
}

export function getBunRuntimeStatus(): Promise<Result<BunRuntimeStatus, AppError>> {
  return api().getBunRuntimeStatus()
}

export function installBunRuntime(): Promise<Result<void, AppError>> {
  return api().installBunRuntime()
}
