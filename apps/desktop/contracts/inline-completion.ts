/** 编辑器行内补全（ghost text）的本仓 IPC 约定：主进程用已配置的 OpenAI 兼容模型生成，不经 ACP Agent。 */
export const INLINE_COMPLETION_IPC = {
  complete: 'ai:inline-complete',
  cancel: 'ai:inline-cancel',
  status: 'ai:inline-status',
} as const

export interface InlineCompletionRequest {
  requestId: string
  filePath: string
  /** markdown / typst，或代码块内的语言名 */
  language: string
  prefix: string
  suffix: string
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
}
