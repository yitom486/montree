import type { AppError, Result } from '@yitom/contracts'

/** 行内补全专用 provider 配置；与 Agent 自定义供应商解耦，旧配置仍可回退。 */
export const INLINE_COMPLETION_PROVIDER_IPC = {
  get: 'ai:inline-provider-get',
  save: 'ai:inline-provider-save',
  clear: 'ai:inline-provider-clear',
} as const

export const INLINE_COMPLETION_CHATGPT_IPC = {
  status: 'ai:inline-chatgpt-status',
  login: 'ai:inline-chatgpt-login',
  logout: 'ai:inline-chatgpt-logout',
} as const

export const INLINE_COMPLETION_MODEL_IPC = {
  list: 'ai:inline-provider-models',
} as const

export type InlineCompletionProviderSource = 'dedicated' | 'agent'
export type InlineCompletionAuthMode = 'api-key' | 'chatgpt'

export interface InlineCompletionProviderStatus {
  configured: boolean
  source?: InlineCompletionProviderSource
  authMode?: InlineCompletionAuthMode
  name?: string
  baseUrl?: string
  model?: string
  hasApiKey: boolean
  /** ChatGPT 登录态存在但已失效/缺失时，UI 提示重新登录 */
  loginRequired?: boolean
  chatgptAccountId?: string
}

export interface InlineCompletionProviderSavePayload {
  authMode?: InlineCompletionAuthMode
  name?: string
  baseUrl?: string
  model?: string
  /** 留空时沿用已存 Key；本地 localhost 可完全留空 */
  apiKey?: string
}

export interface ChatGptAuthStatus {
  configured: boolean
  accountId?: string
  expiresAt?: number
  models: string[]
}

export interface InlineCompletionModelListPayload {
  baseUrl: string
  /** 本地 localhost 可留空 */
  apiKey?: string
}

export type InlineCompletionProviderResult = Result<InlineCompletionProviderStatus, AppError>
export type ChatGptAuthResult = Result<ChatGptAuthStatus, AppError>
export type InlineCompletionModelListResult = Result<string[], AppError>
