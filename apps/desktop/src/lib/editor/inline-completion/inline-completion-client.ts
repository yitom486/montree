import { err } from '@yitom/contracts'
import { toast } from 'sonner'
import type { InlineCompletionStatus } from '../../../../contracts/inline-completion'
import type {
  ChatGptAuthResult,
  ChatGptAuthStatus,
  InlineCompletionModelListPayload,
  InlineCompletionModelListResult,
  InlineCompletionProviderResult,
  InlineCompletionProviderSavePayload,
  InlineCompletionProviderStatus,
} from '../../../../contracts/inline-completion-provider'
import type { InlineCompletionContext } from './inline-completion-extension'

let nextRequest = 0
let statusCache: { at: number; value: InlineCompletionStatus } | null = null
let statusPending: Promise<InlineCompletionStatus> | null = null
const STATUS_TTL = 30_000
const STATUS_EVENT = 'montree-inline-completion-status-changed'

function bridge() { return typeof window !== 'undefined' ? window.montreeInlineCompletion : undefined }

/** 是否已配置补全模型（缓存 30 秒；无桥接时为未配置）。同步读取最近一次结果，后台刷新。 */
export function inlineCompletionConfigured(): boolean {
  const api = bridge()
  if (!api) return false
  if (!statusCache || Date.now() - statusCache.at > STATUS_TTL) void refreshInlineCompletionStatus()
  return statusCache?.value.configured ?? false
}
export async function refreshInlineCompletionStatus(): Promise<InlineCompletionStatus> {
  const api = bridge()
  if (!api) return { configured: false }
  statusPending ??= api.status().then((value) => { statusCache = { at: Date.now(), value }; return value })
    .catch(() => ({ configured: false })).finally(() => { statusPending = null })
  return statusPending
}

export function onInlineCompletionStatusChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(STATUS_EVENT, listener)
  return () => window.removeEventListener(STATUS_EVENT, listener)
}

function notifyInlineCompletionStatusChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STATUS_EVENT))
}

export async function getInlineCompletionProviderStatus(): Promise<InlineCompletionProviderStatus> {
  const api = bridge()
  if (!api || typeof api.providerStatus !== 'function') {
    return { configured: false, hasApiKey: false }
  }
  return api.providerStatus().catch(() => ({ configured: false, hasApiKey: false }))
}

export async function saveInlineCompletionProvider(
  payload: InlineCompletionProviderSavePayload,
): Promise<InlineCompletionProviderResult> {
  const api = bridge()
  if (!api || typeof api.saveProvider !== 'function') {
    return err({ code: 'API_UNAVAILABLE', message: '补全 API 不可用，请重启应用' })
  }
  const result = await api.saveProvider(payload)
  if (result.ok) {
    statusCache = null
    void refreshInlineCompletionStatus()
    notifyInlineCompletionStatusChanged()
  }
  return result
}

export async function clearInlineCompletionProvider(): Promise<InlineCompletionProviderResult> {
  const api = bridge()
  if (!api || typeof api.clearProvider !== 'function') {
    return err({ code: 'API_UNAVAILABLE', message: '补全 API 不可用，请重启应用' })
  }
  const result = await api.clearProvider()
  if (result.ok) {
    statusCache = null
    void refreshInlineCompletionStatus()
    notifyInlineCompletionStatusChanged()
  }
  return result
}

export async function listInlineCompletionModels(
  payload: InlineCompletionModelListPayload,
): Promise<InlineCompletionModelListResult> {
  const api = bridge()
  if (!api || typeof api.listProviderModels !== 'function') {
    return err({ code: 'API_UNAVAILABLE', message: '模型列表 API 不可用，请重启应用' })
  }
  return api.listProviderModels(payload)
}

export async function getChatGptAuthStatus(): Promise<ChatGptAuthStatus> {
  const api = bridge()
  if (!api || typeof api.chatGptStatus !== 'function') {
    return { configured: false, models: [] }
  }
  return api.chatGptStatus().catch(() => ({ configured: false, models: [] }))
}

export async function loginChatGpt(): Promise<ChatGptAuthResult> {
  const api = bridge()
  if (!api || typeof api.loginChatGpt !== 'function') {
    return err({ code: 'API_UNAVAILABLE', message: 'ChatGPT 登录需要重启应用后生效' })
  }
  const result = await api.loginChatGpt()
  if (result.ok) {
    statusCache = null
    void refreshInlineCompletionStatus()
    notifyInlineCompletionStatusChanged()
  }
  return result
}

export async function logoutChatGpt(): Promise<ChatGptAuthResult> {
  const api = bridge()
  if (!api || typeof api.logoutChatGpt !== 'function') {
    return err({ code: 'API_UNAVAILABLE', message: 'ChatGPT 登录需要重启应用后生效' })
  }
  const result = await api.logoutChatGpt()
  if (result.ok) {
    statusCache = null
    void refreshInlineCompletionStatus()
    notifyInlineCompletionStatusChanged()
  }
  return result
}

export async function fetchInlineCompletions(filePath: string, context: InlineCompletionContext, signal: AbortSignal): Promise<string[]> {
  const api = bridge()
  if (!api) return []
  const requestId = `ic-${++nextRequest}`
  const onAbort = () => { void api.cancel(requestId) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await api.complete({
      requestId,
      filePath,
      language: context.language,
      prefix: context.prefix,
      suffix: context.suffix,
      hints: context.hints,
    })
    if (result.reason === 'not-configured') statusCache = { at: Date.now(), value: { configured: false } }
    if (result.reason === 'error' && result.message && !signal.aborted) {
      // 补全失败默认是静默的；给用户一次可见提示，避免误以为模型没有响应。
      toast.error(`AI 补全失败：${result.message.slice(0, 240)}`, { id: 'inline-completion-error' })
    }
    return signal.aborted ? [] : result.items
  } finally { signal.removeEventListener('abort', onAbort) }
}
