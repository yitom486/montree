import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { err, ok, type Result } from '@montree/contracts'
import { toAppError, type AppError } from '@montree/contracts'
import type { SyncConfig } from '@montree/contracts'

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  enabled: false,
  provider: 'jianguoyun',
  serverUrl: 'https://dav.jianguoyun.com/dav/',
  username: '',
  password: '',
  remoteDir: '/MontreeSync',
  syncOnStartup: true,
  ignoreTlsErrors: false,
}

function getConfigPath(): string {
  return join(app.getPath('userData'), 'sync-config.json')
}

export async function readSyncConfig(): Promise<Result<SyncConfig, AppError>> {
  try {
    const filePath = getConfigPath()
    const content = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<SyncConfig>
    return ok({
      ...DEFAULT_SYNC_CONFIG,
      ...parsed,
    })
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
      return ok({ ...DEFAULT_SYNC_CONFIG })
    }
    return err(toAppError(cause, '读取云同步配置失败'))
  }
}

export async function writeSyncConfig(config: SyncConfig): Promise<Result<void, AppError>> {
  try {
    const filePath = getConfigPath()
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
    return ok(undefined)
  } catch (cause) {
    return err(toAppError(cause, '保存云同步配置失败'))
  }
}
