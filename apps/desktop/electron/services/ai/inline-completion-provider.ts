import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { err, ok, type Result } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import type {
  InlineCompletionAuthMode,
  InlineCompletionProviderSavePayload,
  InlineCompletionProviderSource,
  InlineCompletionProviderStatus,
} from '../../../contracts/inline-completion-provider'
import { readStoredAcpProvider } from '../acp/runtimes/codex/codex-provider'
import {
  getValidChatGptCredential,
  usableChatGptModel,
  type ChatGptCredential,
} from './chatgpt-auth'

interface StoredInlineCompletionProvider {
  authMode?: InlineCompletionAuthMode
  name?: string
  baseUrl: string
  model: string
  apiKey: string
}

export interface ResolvedInlineCompletionProvider {
  config: StoredInlineCompletionProvider
  source: InlineCompletionProviderSource
  authMode: InlineCompletionAuthMode
  credential?: ChatGptCredential | null
}

function providerFilePath(dir: string): string {
  return join(dir, 'ai', 'inline-completion-provider.json')
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

function validate(payload: InlineCompletionProviderSavePayload): string | null {
  const base = payload.baseUrl?.trim() ?? ''
  if (!/^https?:\/\/.+/.test(base)) return 'Base URL 必须是 http(s) 地址'
  if (!payload.model?.trim()) return '模型 id 不能为空'
  if ((payload.name ?? '').trim().length > 40) return '名称过长（至多 40 字）'
  return null
}

function toStatus(
  resolved: ResolvedInlineCompletionProvider | null,
): InlineCompletionProviderStatus {
  if (!resolved) return { configured: false, hasApiKey: false }
  if (resolved.authMode === 'chatgpt') {
    return {
      configured: Boolean(resolved.credential),
      source: resolved.source,
      authMode: 'chatgpt',
      name: resolved.config.name,
      model: resolved.config.model,
      hasApiKey: false,
      loginRequired: !resolved.credential,
      chatgptAccountId: resolved.credential?.accountId,
    }
  }
  return {
    configured: true,
    source: resolved.source,
    authMode: 'api-key',
    name: resolved.config.name,
    baseUrl: resolved.config.baseUrl,
    model: resolved.config.model,
    hasApiKey: Boolean(resolved.config.apiKey),
  }
}

/** 专用配置损坏或缺失时返回 null；旧 agent/provider.json 由 resolve 统一回退。 */
async function readStoredProvider(
  dir: string,
): Promise<StoredInlineCompletionProvider | null> {
  const file = providerFilePath(dir)
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<StoredInlineCompletionProvider>
    const authMode: InlineCompletionAuthMode = raw.authMode === 'chatgpt' ? 'chatgpt' : 'api-key'
    if (typeof raw.model !== 'string') return null
    if (authMode === 'chatgpt') {
      return {
        authMode,
        name: typeof raw.name === 'string' ? raw.name : undefined,
        baseUrl: '',
        model: usableChatGptModel(raw.model),
        apiKey: '',
      }
    }
    if (typeof raw.baseUrl !== 'string' || typeof raw.apiKey !== 'string') return null
    if (!raw.apiKey.trim() && !isLocalBaseUrl(raw.baseUrl)) return null
    return {
      authMode,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      baseUrl: raw.baseUrl,
      model: raw.model,
      apiKey: raw.apiKey,
    }
  } catch {
    return null
  }
}

/** 专用配置优先；未配置时回退到旧 Agent 自定义供应商，保证旧用户不丢补全。 */
export async function resolveInlineCompletionProvider(
  dir = app.getPath('userData'),
): Promise<ResolvedInlineCompletionProvider | null> {
  const dedicated = await readStoredProvider(dir)
  if (dedicated) {
    if (dedicated.authMode === 'chatgpt') {
      const credential = await getValidChatGptCredential(dir).catch(() => null)
      return { config: dedicated, source: 'dedicated', authMode: 'chatgpt', credential }
    }
    return { config: dedicated, source: 'dedicated', authMode: 'api-key' }
  }

  const legacy = await readStoredAcpProvider(dir)
  if (!legacy) return null
  return {
    source: 'agent',
    authMode: 'api-key',
    config: {
      name: legacy.name,
      baseUrl: legacy.baseUrl,
      model: legacy.model,
      apiKey: legacy.apiKey,
    },
  }
}

export async function getInlineCompletionProviderStatus(
  dir = app.getPath('userData'),
): Promise<InlineCompletionProviderStatus> {
  return toStatus(await resolveInlineCompletionProvider(dir))
}

export async function saveInlineCompletionProvider(
  payload: InlineCompletionProviderSavePayload,
  dir = app.getPath('userData'),
): Promise<Result<InlineCompletionProviderStatus, AppError>> {
  const authMode: InlineCompletionAuthMode = payload.authMode === 'chatgpt' ? 'chatgpt' : 'api-key'
  if ((payload.name ?? '').trim().length > 40) {
    return err({ code: 'INVALID_ARGUMENT', message: '名称过长（至多 40 字）' })
  }

  let stored: StoredInlineCompletionProvider
  if (authMode === 'chatgpt') {
    stored = {
      authMode,
      name: payload.name?.trim() || undefined,
      baseUrl: '',
      model: usableChatGptModel(payload.model),
      apiKey: '',
    }
  } else {
    const invalid = validate(payload)
    if (invalid) return err({ code: 'INVALID_ARGUMENT', message: invalid })
    const baseUrl = payload.baseUrl?.trim() ?? ''
    const local = isLocalBaseUrl(baseUrl)
    const previous = await readStoredProvider(dir)
    const legacy = await readStoredAcpProvider(dir)
    const sameBase = (value: string | undefined) => Boolean(value) && value!.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, '')
    // 只在同一 Base URL 下复用旧 Key，避免把 Key 带到新供应商；本地也不应带远程 Key。
    const existingKey =
      (sameBase(previous?.baseUrl) ? previous?.apiKey : '') ||
      (sameBase(legacy?.baseUrl) ? legacy?.apiKey : '') ||
      ''
    const apiKey = payload.apiKey?.trim() || (local ? '' : existingKey)
    if (!apiKey && !local) {
      return err({ code: 'INVALID_ARGUMENT', message: '远程 API Key 不能为空' })
    }
    stored = {
      authMode,
      name: payload.name?.trim() || undefined,
      baseUrl,
      model: payload.model!.trim(),
      apiKey,
    }
  }

  await mkdir(join(dir, 'ai'), { recursive: true })
  await writeFile(providerFilePath(dir), JSON.stringify(stored, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  return ok(await getInlineCompletionProviderStatus(dir))
}

/** 设置页获取模型列表时复用同一 Base URL 已保存的 Key（输入框留空代表保持不变）。 */
export async function readInlineCompletionApiKey(
  baseUrl: string,
  dir = app.getPath('userData'),
): Promise<string> {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  const sameBase = (value: string | undefined) => Boolean(value) && value!.replace(/\/+$/, '') === normalized
  const dedicated = await readStoredProvider(dir)
  if (sameBase(dedicated?.baseUrl)) return dedicated?.apiKey ?? ''
  const legacy = await readStoredAcpProvider(dir)
  return sameBase(legacy?.baseUrl) ? legacy?.apiKey ?? '' : ''
}

export async function clearInlineCompletionProvider(
  dir = app.getPath('userData'),
): Promise<Result<InlineCompletionProviderStatus, AppError>> {
  await rm(providerFilePath(dir), { force: true })
  return ok(await getInlineCompletionProviderStatus(dir))
}
