import type {
  AcpAuthenticatePayload, AcpConnectResult, AcpLoadSessionPayload, AcpSessionNewPayload, AcpSessionNewResult,
  AcpPromptPayload, AcpPromptResult, AcpSetConfigOptionPayload, AcpSetConfigOptionResult,
  AcpSessionUpdateEvent, AcpStatusChangedEvent, AppError, Result,
} from '@yitom/contracts'

export const TRANSLATION_IPC = {
  connect: 'translation:connect', authenticate: 'translation:authenticate',
  sessionNew: 'translation:session-new', loadSession: 'translation:load-session',
  prompt: 'translation:prompt', setConfigOption: 'translation:set-config-option',
  update: 'translation:update', status: 'translation:status',
  output: 'translation:output',
} as const

export const TRANSLATION_TOOL_NAME = 'montree_translation_emit'
export type TranslationOutputEvent =
  | { type: 'language'; sourceLanguage: string | null }
  | { type: 'text'; text: string }
  | { type: 'phrase' | 'term'; text: string; meaning: string }
  | { type: 'done' }
export interface TranslationOutputEnvelope {
  runtimeId: string
  sessionId: string
  requestId: string
  sequence: number
  event: TranslationOutputEvent
}
export type TranslationToolCall = { requestId: string; sequence: number } & TranslationOutputEvent

/** 工具调用与 IPC 使用同一契约，不接受模型自由文本作为显示内容。 */
export function parseTranslationToolCall(value: unknown): TranslationToolCall | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (typeof data.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.requestId)
    || !Number.isInteger(data.sequence) || (data.sequence as number) < 0 || (data.sequence as number) > 127) return null
  const base = { requestId: data.requestId, sequence: data.sequence as number }
  const keys = ['requestId', 'sequence', 'type']
  let event: TranslationOutputEvent
  if (data.type === 'language') {
    if (data.sourceLanguage !== null && (typeof data.sourceLanguage !== 'string' || !data.sourceLanguage.trim() || data.sourceLanguage.length > 40)) return null
    keys.push('sourceLanguage')
    event = { type: 'language', sourceLanguage: typeof data.sourceLanguage === 'string' ? data.sourceLanguage.trim() : null }
  } else if (data.type === 'text') {
    if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 600) return null
    keys.push('text')
    event = { type: 'text', text: data.text }
  } else if (data.type === 'phrase' || data.type === 'term') {
    if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 160
      || typeof data.meaning !== 'string' || !data.meaning.trim() || data.meaning.length > 400) return null
    keys.push('text', 'meaning')
    event = { type: data.type, text: data.text.trim(), meaning: data.meaning.trim() }
  } else if (data.type === 'done') event = { type: 'done' }
  else return null
  if (Object.keys(data).some((key) => !keys.includes(key))) return null
  return { ...base, ...event }
}

export interface TranslationAPI {
  connect: (runtimeId: string) => Promise<Result<AcpConnectResult, AppError>>
  authenticate: (payload: AcpAuthenticatePayload & { runtimeId: string }) => Promise<Result<Extract<AcpConnectResult, { phase: 'ready' }>, AppError>>
  sessionNew: (payload: AcpSessionNewPayload & { runtimeId: string }) => Promise<Result<AcpSessionNewResult, AppError>>
  loadSession: (payload: AcpLoadSessionPayload & { runtimeId: string }) => Promise<Result<AcpSessionNewResult, AppError>>
  prompt: (payload: AcpPromptPayload & { runtimeId: string; requestId: string }) => Promise<Result<AcpPromptResult, AppError>>
  setConfigOption: (payload: AcpSetConfigOptionPayload & { runtimeId: string }) => Promise<Result<AcpSetConfigOptionResult, AppError>>
  onSessionUpdate: (callback: (event: AcpSessionUpdateEvent & { runtimeId: string }) => void) => () => void
  onStatusChanged: (callback: (event: AcpStatusChangedEvent & { runtimeId: string }) => void) => () => void
  onOutput: (callback: (event: TranslationOutputEnvelope) => void) => () => void
}
