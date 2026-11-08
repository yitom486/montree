import type { AcpAuthMethod } from '@yitom/contracts'
import { translationApi } from '@/api/translation-api'
import { accumulateSubsessionUpdateFor } from './acp-subsession'
import type { TranslationOutputEnvelope } from '../../../contracts/translation'

const connected = new Set<string>()
const generations = new Map<string, number>()
const auth = new Map<string, AcpAuthMethod[]>()
const pending = new Map<string, Promise<'connected' | 'auth-required'>>()
let subscribed = false
const outputListeners = new Map<string, (event: TranslationOutputEnvelope) => void>()

export function subscribeTranslationOutput(runtimeId: string, requestId: string, listener: (event: TranslationOutputEnvelope) => void) {
  subscribe()
  const key = JSON.stringify([runtimeId, requestId])
  outputListeners.set(key, listener)
  return () => { outputListeners.delete(key) }
}

export class TranslationAuthRequiredError extends Error {
  constructor(public runtimeId: string, public methods: AcpAuthMethod[]) {
    super('翻译 Agent 需要认证，请在翻译设置中完成登录')
  }
}

function subscribe() {
  if (subscribed) return
  translationApi.onOutput((event) => outputListeners.get(JSON.stringify([event.runtimeId, event.requestId]))?.(event))
  translationApi.onSessionUpdate((event) => accumulateSubsessionUpdateFor('translate', event.sessionId, event.update, event.runtimeId))
  translationApi.onStatusChanged((event) => {
    if (event.status === 'disconnected' || event.status === 'error') auth.delete(event.runtimeId)
    if (event.status !== 'connected' && connected.delete(event.runtimeId)) {
      generations.set(event.runtimeId, (generations.get(event.runtimeId) ?? 0) + 1)
    }
  })
  subscribed = true
}

export function translationConnectionEpoch(runtimeId: string): number {
  return generations.get(runtimeId) ?? 0
}

export function translationAuthError(runtimeId: string): TranslationAuthRequiredError {
  return new TranslationAuthRequiredError(runtimeId, auth.get(runtimeId) ?? [])
}

/** 用户可在 CLI 完成登录后点「重试读取」，重新探测凭证。 */
export function retryTranslationAuthentication(runtimeId: string): void {
  auth.delete(runtimeId)
}

export function ensureTranslationConnection(runtimeId: string): Promise<'connected' | 'auth-required'> {
  subscribe()
  if (connected.has(runtimeId)) return Promise.resolve('connected')
  const existing = pending.get(runtimeId)
  if (existing) return existing
  if (auth.has(runtimeId)) return Promise.resolve('auth-required')
  const task = (async () => {
    const result = await translationApi.connect(runtimeId)
    if (!result.ok) throw new Error(result.error.message)
    if (result.value.phase === 'needs_auth') {
      auth.set(runtimeId, result.value.authMethods)
      return 'auth-required' as const
    }
    connected.add(runtimeId)
    auth.delete(runtimeId)
    return 'connected' as const
  })().finally(() => { pending.delete(runtimeId) })
  pending.set(runtimeId, task)
  return task
}

export async function authenticateTranslation(runtimeId: string, methodId: string): Promise<void> {
  const result = await translationApi.authenticate({ runtimeId, methodId })
  if (!result.ok) throw new Error(result.error.message)
  connected.add(runtimeId)
  auth.delete(runtimeId)
}

export function translationClient(runtimeId: string, requestId = '') {
  return {
    sessionNew: (payload: Omit<Parameters<typeof translationApi.sessionNew>[0], 'runtimeId'>) => translationApi.sessionNew({ ...payload, runtimeId }),
    loadSession: (payload: Omit<Parameters<typeof translationApi.loadSession>[0], 'runtimeId'>) => translationApi.loadSession({ ...payload, runtimeId }),
    prompt: (payload: Omit<Parameters<typeof translationApi.prompt>[0], 'runtimeId' | 'requestId'>) => translationApi.prompt({ ...payload, runtimeId, requestId }),
    setConfigOption: (payload: Omit<Parameters<typeof translationApi.setConfigOption>[0], 'runtimeId'>) => translationApi.setConfigOption({ ...payload, runtimeId }),
  }
}
