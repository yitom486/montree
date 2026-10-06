import { app } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AcpProviderConfig,
  AcpProviderSavePayload,
  AcpProviderStatus,
  AppError,
} from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'

export interface StoredAcpProvider extends AcpProviderConfig {
  apiKey: string
}

function providerFilePath(dir: string): string {
  return join(dir, 'agent', 'provider.json')
}

function providerHomePath(dir: string): string {
  return join(dir, 'agent', 'codex-home')
}

function toStatus(stored: StoredAcpProvider | null): AcpProviderStatus {
  if (!stored) return { configured: false, hasApiKey: false }
  return {
    configured: true,
    name: stored.name,
    baseUrl: stored.baseUrl,
    model: stored.model,
    wireApi: stored.wireApi,
    hasApiKey: Boolean(stored.apiKey),
  }
}

function validate(payload: AcpProviderSavePayload): string | null {
  const base = payload.baseUrl.trim()
  if (!/^https?:\/\/.+/.test(base)) return 'Base URL 必须是 http(s) 地址'
  if (!payload.model.trim()) return '模型 id 不能为空'
  if ((payload.name ?? '').trim().length > 40) return '名称过长（至多 40 字）'
  return null
}

/** 读取完整配置（含 Key），仅主进程内部使用；文件缺失/损坏返回 null */
export async function readStoredAcpProvider(
  dir = app.getPath('userData'),
): Promise<StoredAcpProvider | null> {
  const file = providerFilePath(dir)
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<StoredAcpProvider>
    if (
      typeof raw.baseUrl !== 'string' ||
      typeof raw.model !== 'string' ||
      typeof raw.apiKey !== 'string' ||
      !raw.apiKey.trim()
    ) {
      return null
    }
    return {
      name: typeof raw.name === 'string' ? raw.name : undefined,
      baseUrl: raw.baseUrl,
      model: raw.model,
      apiKey: raw.apiKey,
      wireApi: raw.wireApi === 'responses' ? 'responses' : 'chat',
    }
  } catch {
    return null
  }
}

/** 供 UI 的脱敏状态（Key 不回传） */
export async function getAcpProviderStatus(
  dir = app.getPath('userData'),
): Promise<AcpProviderStatus> {
  return toStatus(await readStoredAcpProvider(dir))
}

export async function saveAcpProvider(
  payload: AcpProviderSavePayload,
  dir = app.getPath('userData'),
): Promise<Result<AcpProviderStatus, AppError>> {
  const invalid = validate(payload)
  if (invalid) return err({ code: 'INVALID_ARGUMENT', message: invalid })
  const file = providerFilePath(dir)
  const apiKey =
    payload.apiKey.trim() || (await readStoredAcpProvider(dir))?.apiKey || ''
  if (!apiKey) return err({ code: 'INVALID_ARGUMENT', message: 'API Key 不能为空' })
  await mkdir(join(dir, 'agent'), { recursive: true })
  const stored: StoredAcpProvider = {
    name: payload.name?.trim() || undefined,
    baseUrl: payload.baseUrl.trim(),
    model: payload.model.trim(),
    apiKey,
    wireApi: payload.wireApi === 'responses' ? 'responses' : 'chat',
  }
  await writeFile(file, JSON.stringify(stored, null, 2), 'utf8')
  return ok(toStatus(stored))
}

export async function clearAcpProvider(
  dir = app.getPath('userData'),
): Promise<Result<void, AppError>> {
  await rm(providerFilePath(dir), { force: true })
  return ok(undefined)
}

/** 隔离 CODEX_HOME 目录（spawn 前落 config.toml） */
export function getAcpProviderCodexHome(dir = app.getPath('userData')): string {
  return providerHomePath(dir)
}
