import type {
  ChatGptAuthResult,
  ChatGptAuthStatus,
  InlineCompletionModelListPayload,
  InlineCompletionModelListResult,
  InlineCompletionProviderResult,
  InlineCompletionProviderSavePayload,
  InlineCompletionProviderStatus,
} from './inline-completion-provider'

/** 编辑器行内补全（ghost text）的本仓 IPC 约定：主进程用已配置的 OpenAI 兼容模型生成，不经 ACP Agent。 */
export const INLINE_COMPLETION_IPC = {
  complete: 'ai:inline-complete',
  cancel: 'ai:inline-cancel',
  status: 'ai:inline-status',
} as const

export type InlineCompletionBlock =
  | 'paragraph'
  | 'heading'
  | 'list item'
  | 'blockquote'
  | 'table cell'
  | 'code block'

export interface InlineCompletionHints {
  /** 文档标题：首个 Markdown 标题 */
  title?: string
  /** 光标所在的标题路径（不含正在输入的标题本身） */
  section?: string[]
  /** 光标所在的 Markdown 块类型 */
  block?: InlineCompletionBlock
}

export interface InlineCompletionRequest {
  requestId: string
  filePath: string
  /** markdown / typst，或代码块内的语言名 */
  language: string
  prefix: string
  suffix: string
  hints?: InlineCompletionHints
}

export interface InlineCompletionResult {
  requestId: string
  items: string[]
  /** 未配置模型 / 已取消 / 出错时为对应原因，items 为空 */
  reason?: 'not-configured' | 'cancelled' | 'error'
  message?: string
}

export interface InlineCompletionStatus { configured: boolean; model?: string }

export interface InlineCompletionAPI {
  complete: (request: InlineCompletionRequest) => Promise<InlineCompletionResult>
  cancel: (requestId: string) => Promise<void>
  status: () => Promise<InlineCompletionStatus>
  providerStatus: () => Promise<InlineCompletionProviderStatus>
  saveProvider: (payload: InlineCompletionProviderSavePayload) => Promise<InlineCompletionProviderResult>
  clearProvider: () => Promise<InlineCompletionProviderResult>
  chatGptStatus: () => Promise<ChatGptAuthStatus>
  loginChatGpt: () => Promise<ChatGptAuthResult>
  logoutChatGpt: () => Promise<ChatGptAuthResult>
  listProviderModels: (payload: InlineCompletionModelListPayload) => Promise<InlineCompletionModelListResult>
}
