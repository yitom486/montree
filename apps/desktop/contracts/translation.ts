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
} as const

export interface TranslationAPI {
  connect: (runtimeId: string) => Promise<Result<AcpConnectResult, AppError>>
  authenticate: (payload: AcpAuthenticatePayload & { runtimeId: string }) => Promise<Result<Extract<AcpConnectResult, { phase: 'ready' }>, AppError>>
  sessionNew: (payload: AcpSessionNewPayload & { runtimeId: string }) => Promise<Result<AcpSessionNewResult, AppError>>
  loadSession: (payload: AcpLoadSessionPayload & { runtimeId: string }) => Promise<Result<AcpSessionNewResult, AppError>>
  prompt: (payload: AcpPromptPayload & { runtimeId: string }) => Promise<Result<AcpPromptResult, AppError>>
  setConfigOption: (payload: AcpSetConfigOptionPayload & { runtimeId: string }) => Promise<Result<AcpSetConfigOptionResult, AppError>>
  onSessionUpdate: (callback: (event: AcpSessionUpdateEvent & { runtimeId: string }) => void) => () => void
  onStatusChanged: (callback: (event: AcpStatusChangedEvent & { runtimeId: string }) => void) => () => void
}
