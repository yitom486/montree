import { app } from 'electron'
import { err, ok, type Result } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import type {
  InlineCompletionModelListPayload,
} from '../../../contracts/inline-completion-provider'
import { readInlineCompletionApiKey } from './inline-completion-provider'

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

function errorBody(text: string): string {
  const value = text.trim()
  return value ? `：${value.slice(0, 300)}` : ''
}

/**
 * 从 OpenAI 兼容的 GET /models 读取模型 id。
 * 不依赖预设列表，避免供应商模型改名/下线后用户只能手填。
 */
export async function listInlineCompletionModels(
  payload: InlineCompletionModelListPayload,
  dir = app.getPath('userData'),
): Promise<Result<string[], AppError>> {
  const baseUrl = payload.baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/.+/.test(baseUrl)) {
    return err({ code: 'INVALID_ARGUMENT', message: 'Base URL 必须是 http(s) 地址' })
  }
  let apiKey = payload.apiKey?.trim() ?? ''
  if (!apiKey && !isLocalBaseUrl(baseUrl)) {
    apiKey = await readInlineCompletionApiKey(baseUrl, dir).catch(() => '')
  }
  if (!apiKey && !isLocalBaseUrl(baseUrl)) {
    return err({ code: 'INVALID_ARGUMENT', message: '远程服务需要 API Key 才能获取模型列表' })
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    })
  } catch (cause) {
    return err({
      code: 'NETWORK_ERROR',
      message: cause instanceof Error && cause.name === 'TimeoutError'
        ? '获取模型列表超时'
        : `获取模型列表失败：${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return err({
      code: 'NETWORK_ERROR',
      message: `获取模型列表失败（${response.status}）${errorBody(body)}`,
    })
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return err({ code: 'INVALID_STATE', message: '模型列表响应不是有效 JSON' })
  }
  if (!json || typeof json !== 'object') {
    return err({ code: 'INVALID_STATE', message: '模型列表响应格式错误' })
  }

  const record = json as { data?: unknown; models?: unknown }
  const rows = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : []
  const ids = [...new Set(rows
    .map((row) => {
      if (typeof row === 'string') return row
      if (!row || typeof row !== 'object') return ''
      const value = row as { id?: unknown; name?: unknown }
      return typeof value.id === 'string' ? value.id : typeof value.name === 'string' ? value.name : ''
    })
    .filter((id) => Boolean(id)))]
    .slice(0, 500)
    .sort((a, b) => a.localeCompare(b))

  return ok(ids)
}
