import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcpConnectResult } from '@yitom/contracts'
import { ok } from '@yitom/contracts'
import { translationApi } from '@/api/translation-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { accumulateSubsessionUpdateFor } from './acp-subsession'

vi.mock('@/api/translation-api', () => ({ translationApi: {
  connect: vi.fn(), authenticate: vi.fn(), sessionNew: vi.fn(), loadSession: vi.fn(), prompt: vi.fn(), setConfigOption: vi.fn(),
  onSessionUpdate: vi.fn(), onStatusChanged: vi.fn(), onOutput: vi.fn(),
} }))
vi.mock('./acp-subsession', () => ({ accumulateSubsessionUpdateFor: vi.fn() }))

let status: Parameters<typeof translationApi.onStatusChanged>[0]
let update: Parameters<typeof translationApi.onSessionUpdate>[0]
let output: Parameters<typeof translationApi.onOutput>[0]
const ready = () => ok({ phase: 'ready', sessionId: 'translation', runtimeId: 'opencode', protocolVersion: 1, configOptions: [] } as AcpConnectResult)
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.mocked(translationApi.onStatusChanged).mockImplementation((callback) => { status = callback; return () => {} })
  vi.mocked(translationApi.onSessionUpdate).mockImplementation((callback) => { update = callback; return () => {} })
  vi.mocked(translationApi.onOutput).mockImplementation((callback) => { output = callback; return () => {} })
  vi.mocked(translationApi.connect).mockResolvedValue(ready())
  useAcpUiStore.setState({ status: 'disconnected', sessionId: null, selectedRuntimeId: 'codex-acp' })
})

describe('independent translation transport', () => {
  it('isolates structured events by runtime/request and removes closed subscriptions', async () => {
    const transport = await import('./translation-transport')
    const listener = vi.fn()
    const off = transport.subscribeTranslationOutput('opencode', 'request-a', listener)
    const event = { runtimeId: 'opencode', sessionId: 's', requestId: 'request-a', sequence: 0, event: { type: 'text' as const, text: '译文' } }
    output({ ...event, runtimeId: 'other' })
    output({ ...event, requestId: 'request-b' })
    expect(listener).not.toHaveBeenCalled()
    output(event)
    expect(listener).toHaveBeenCalledWith(event)
    off()
    output(event)
    expect(listener).toHaveBeenCalledOnce()
    await transport.translationClient('opencode', 'request-a').prompt({ sessionId: 's', prompt: [] })
    expect(translationApi.prompt).toHaveBeenCalledWith({ runtimeId: 'opencode', requestId: 'request-a', sessionId: 's', prompt: [] })
  })
  it('connects from an offline main chat, coalesces requests, and leaves main state unchanged', async () => {
    const transport = await import('./translation-transport')
    await Promise.all([transport.ensureTranslationConnection('opencode'), transport.ensureTranslationConnection('opencode')])
    expect(translationApi.connect).toHaveBeenCalledTimes(1)
    expect(translationApi.connect).toHaveBeenCalledWith('opencode')
    expect(useAcpUiStore.getState()).toMatchObject({ status: 'disconnected', sessionId: null, selectedRuntimeId: 'codex-acp' })
    await transport.translationClient('opencode').sessionNew({})
    expect(translationApi.sessionNew).toHaveBeenCalledWith({ runtimeId: 'opencode' })
  })

  it('keeps authentication in the translation connection', async () => {
    const transport = await import('./translation-transport')
    vi.mocked(translationApi.connect).mockResolvedValueOnce(ok({ phase: 'needs_auth', runtimeId: 'opencode', protocolVersion: 1, authMethods: [{ id: 'login', name: 'Login' }] } as AcpConnectResult))
    expect(await transport.ensureTranslationConnection('opencode')).toBe('auth-required')
    expect(transport.translationAuthError('opencode').methods[0].id).toBe('login')
    vi.mocked(translationApi.authenticate).mockResolvedValueOnce(ok({ phase: 'ready', sessionId: 'translation', runtimeId: 'opencode', protocolVersion: 1 } as Extract<AcpConnectResult, { phase: 'ready' }>))
    await transport.authenticateTranslation('opencode', 'login')
    expect(await transport.ensureTranslationConnection('opencode')).toBe('connected')
    expect(translationApi.connect).toHaveBeenCalledTimes(1)
    expect(useAcpUiStore.getState().status).toBe('disconnected')
  })

  it('reconnects its own exited process and routes updates with runtime identity', async () => {
    const transport = await import('./translation-transport')
    await transport.ensureTranslationConnection('opencode')
    status({ runtimeId: 'opencode', status: 'disconnected', sessionId: null })
    expect(transport.translationConnectionEpoch('opencode')).toBe(1)
    await transport.ensureTranslationConnection('opencode')
    expect(translationApi.connect).toHaveBeenCalledTimes(2)
    update({ runtimeId: 'opencode', sessionId: 'same-id', update: { sessionUpdate: 'agent_message_chunk' } })
    expect(accumulateSubsessionUpdateFor).toHaveBeenCalledWith('translate', 'same-id', { sessionUpdate: 'agent_message_chunk' }, 'opencode')
  })

  it('can retry discovery after credentials are supplied outside the app', async () => {
    const transport = await import('./translation-transport')
    vi.mocked(translationApi.connect).mockResolvedValueOnce(ok({ phase: 'needs_auth', runtimeId: 'opencode', protocolVersion: 1, authMethods: [] } as AcpConnectResult))
    expect(await transport.ensureTranslationConnection('opencode')).toBe('auth-required')
    transport.retryTranslationAuthentication('opencode')
    expect(await transport.ensureTranslationConnection('opencode')).toBe('connected')
    expect(translationApi.connect).toHaveBeenCalledTimes(2)
  })
})
