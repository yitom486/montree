// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ok, err } from '@yitom/contracts'

vi.mock('@/api/acp-api', () => ({ acpApi: {
  prompt: vi.fn(), cancel: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  setConfigOption: vi.fn(), authenticate: vi.fn(),
} }))
vi.mock('@/lib/agent/acp-stream-host', () => ({ flushAcpStreamBuffer: vi.fn(), registerStreamAuthReset: () => () => {} }))
vi.mock('@/lib/agent/context/build-prompt-prefix', () => ({ buildMontreePromptPrefix: () => [] }))
vi.mock('@/lib/workspace/report-error', () => ({ reportAppError: vi.fn(), reportUnknownError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { info: vi.fn() } }))
// This hook owns transport orchestration, not the package panel's optional UI tree.
vi.mock('@yitom/chat-ui', () => ({}))

import { acpApi } from '@/api/acp-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { reportUnknownError } from '@/lib/workspace/report-error'
import { appApi } from '@/api/app-api'
import { useAcpSession } from './useAcpSession'
import { captureAcpTurnIdentity, isAcpTurnIdentityCurrent } from '@/lib/agent/acp-turn-controller'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let root: Root
let session: ReturnType<typeof useAcpSession>
let second: ReturnType<typeof useAcpSession>
let scope = 0
function Probe() {
  session = useAcpSession()
  second = useAcpSession()
  return null
}
const payload = { text: 'hello', prompt: [{ type: 'text' as const, text: 'hello' }] }

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  vi.spyOn(appApi, 'getWindowScopeId').mockReturnValue('turn-test-' + (++scope))
  root = createRoot(document.createElement('div'))
  await act(async () => { root.render(createElement(Probe)) })
  act(() => {
    useAcpUiStore.getState().createThread()
    useAcpUiStore.setState({ prompting: false, sessionId: 'session-a', selectedRuntimeId: 'codex-acp', status: 'connected', connectRequestedAt: 0, runtimeSwitchRequestedAt: 0 })
  })
  vi.mocked(acpApi.prompt).mockResolvedValue(ok({ stopReason: 'end_turn' }))
  vi.mocked(acpApi.cancel).mockResolvedValue(ok(undefined))
  vi.mocked(acpApi.disconnect).mockResolvedValue(ok(undefined))
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  vi.restoreAllMocks()
})

describe('useAcpSession shared turn controller', () => {
  it('two hook instances share send preparation and only append/send once', async () => {
    const result = deferred<Awaited<ReturnType<typeof acpApi.prompt>>>()
    vi.mocked(acpApi.prompt).mockReturnValue(result.promise)
    await act(async () => {
      const first = session.sendPrompt(payload)
      const duplicate = second.sendPrompt(payload)
      await Promise.resolve()
      expect(acpApi.prompt).toHaveBeenCalledTimes(1)
      result.resolve(ok({ stopReason: 'end_turn' }))
      await Promise.all([first, duplicate])
    })
    const state = useAcpUiStore.getState()
    expect(state.threads.find(t => t.id === state.activeThreadId)!.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(state.prompting).toBe(false)
  })

  it.each(['thread', 'runtime', 'session'] as const)('late prompt failure never rolls back/finishes the new %s', async kind => {
    const result = deferred<Awaited<ReturnType<typeof acpApi.prompt>>>()
    vi.mocked(acpApi.prompt).mockReturnValue(result.promise)
    let sending!: Promise<void>
    await act(async () => { sending = session.sendPrompt(payload); await Promise.resolve() })
    act(() => {
      if (kind === 'thread') useAcpUiStore.getState().createThread()
      else if (kind === 'runtime') useAcpUiStore.setState({ selectedRuntimeId: 'opencode' })
      else useAcpUiStore.setState({ sessionId: 'session-b' })
      useAcpUiStore.getState().appendUserMessage('new route question')
      useAcpUiStore.getState().beginAgentReply()
      useAcpUiStore.getState().applySessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'new route answer' } })
      useAcpUiStore.getState().setPrompting(true)
    })
    const before = useAcpUiStore.getState()
    const messages = before.threads.find(t => t.id === before.activeThreadId)!.messages
    await act(async () => { result.resolve(err({ code: 'UNKNOWN', message: 'old failure' })); await sending })
    const after = useAcpUiStore.getState()
    expect(after.prompting).toBe(true)
    expect(after.threads.find(t => t.id === after.activeThreadId)!.messages).toBe(messages)
  })

  it('preparing auto-connect is single flight and abandons a changed route before applying connection result', async () => {
    act(() => { useAcpUiStore.setState({ sessionId: null, status: 'disconnected' }) })
    const ready = deferred<Awaited<ReturnType<typeof acpApi.connect>>>()
    vi.mocked(acpApi.connect).mockReturnValue(ready.promise)
    let sending!: Promise<void>
    await act(async () => {
      sending = session.sendPrompt(payload)
      await second.sendPrompt(payload)
    })
    expect(acpApi.connect).toHaveBeenCalledTimes(1)
    act(() => {
      useAcpUiStore.getState().createThread()
      useAcpUiStore.setState({ sessionId: 'new-session', status: 'connected' })
    })
    await act(async () => {
      ready.resolve(ok({ phase: 'ready', runtimeId: 'codex-acp', protocolVersion: 1, sessionId: 'old-session' }))
      await sending
    })
    expect(acpApi.prompt).not.toHaveBeenCalled()
    expect(useAcpUiStore.getState().sessionId).toBe('new-session')
  })

  it('rejected transport reports a host error, clears prompting and permits retry', async () => {
    vi.mocked(acpApi.prompt).mockRejectedValueOnce(new Error('transport rejected'))
    await act(async () => { await session.sendPrompt(payload) })
    expect(reportUnknownError).toHaveBeenCalledOnce()
    expect(useAcpUiStore.getState().prompting).toBe(false)
    const state = useAcpUiStore.getState()
    expect(state.threads.find(t => t.id === state.activeThreadId)!.messages.some(m => m.text.includes('发送失败：transport rejected'))).toBe(true)
    await act(async () => { await session.sendPrompt(payload) })
    expect(acpApi.prompt).toHaveBeenCalledTimes(2)
  })

  it('confirmed stop works during send and suppresses its late failure', async () => {
    const result = deferred<Awaited<ReturnType<typeof acpApi.prompt>>>()
    vi.mocked(acpApi.prompt).mockReturnValue(result.promise)
    let sending!: Promise<void>
    await act(async () => { sending = session.sendPrompt(payload); await Promise.resolve() })
    await act(async () => { await second.cancel() })
    expect(acpApi.cancel).toHaveBeenCalledOnce()
    expect(useAcpUiStore.getState().prompting).toBe(false)
    const state = useAcpUiStore.getState()
    const messages = state.threads.find(t => t.id === state.activeThreadId)!.messages
    await act(async () => { result.resolve(err({ code: 'UNKNOWN', message: 'after stop' })); await sending })
    expect(useAcpUiStore.getState().threads.find(t => t.id === state.activeThreadId)!.messages).toBe(messages)
  })

  it('late cancel confirmation does not finish another thread', async () => {
    const result = deferred<Awaited<ReturnType<typeof acpApi.cancel>>>()
    vi.mocked(acpApi.cancel).mockReturnValue(result.promise)
    let cancelling!: Promise<void>
    await act(async () => { cancelling = session.cancel(); await Promise.resolve() })
    act(() => {
      useAcpUiStore.getState().createThread()
      useAcpUiStore.getState().setPrompting(true)
    })
    await act(async () => { result.resolve(ok(undefined)); await cancelling })
    expect(useAcpUiStore.getState().prompting).toBe(true)
  })

  it('identity detects session replacement even when the id is restored', () => {
    const identity = captureAcpTurnIdentity()
    act(() => {
      useAcpUiStore.setState({ sessionId: null })
      useAcpUiStore.setState({ sessionId: identity.sessionId })
    })
    expect(isAcpTurnIdentityCurrent(identity)).toBe(false)
  })

  it('a successful auto-connect may establish a new session before the queued send', async () => {
    act(() => { useAcpUiStore.setState({ sessionId: null, status: 'disconnected' }) })
    vi.mocked(acpApi.connect).mockResolvedValue(ok({ phase: 'ready', runtimeId: 'codex-acp', protocolVersion: 1, sessionId: 'prepared-session' }))
    await act(async () => { await session.sendPrompt(payload) })
    expect(acpApi.prompt).toHaveBeenCalledWith({ sessionId: 'prepared-session', prompt: payload.prompt })
    expect(useAcpUiStore.getState().prompting).toBe(false)
  })

  it('a rejected auto-connect releases prepare and shows the host error path', async () => {
    act(() => { useAcpUiStore.setState({ sessionId: null, status: 'disconnected' }) })
    vi.mocked(acpApi.connect).mockRejectedValueOnce(new Error('connect rejected')).mockResolvedValueOnce(ok({ phase: 'ready', runtimeId: 'codex-acp', protocolVersion: 1, sessionId: 'retry-session' }))
    await act(async () => { await session.sendPrompt(payload) })
    expect(reportUnknownError).toHaveBeenCalledOnce()
    expect(useAcpUiStore.getState().status).toBe('error')
    await act(async () => { await second.sendPrompt(payload) })
    expect(acpApi.prompt).toHaveBeenCalledWith({ sessionId: 'retry-session', prompt: payload.prompt })
  })

  it('a new route may send while an old transport remains pending', async () => {
    const old = deferred<Awaited<ReturnType<typeof acpApi.prompt>>>()
    vi.mocked(acpApi.prompt).mockReturnValueOnce(old.promise)
    let sending!: Promise<void>
    await act(async () => { sending = session.sendPrompt(payload); await Promise.resolve() })
    act(() => {
      useAcpUiStore.getState().createThread()
      useAcpUiStore.setState({ prompting: false, sessionId: 'new-route', status: 'connected' })
    })
    await act(async () => { await second.sendPrompt(payload) })
    expect(acpApi.prompt).toHaveBeenCalledTimes(2)
    await act(async () => { old.resolve(ok({ stopReason: 'end_turn' })); await sending })
  })

  it('confirmed cancel frees a hanging prompt slot and the old finally cannot release the next turn', async () => {
    const old = deferred<Awaited<ReturnType<typeof acpApi.prompt>>>()
    const next = deferred<Awaited<ReturnType<typeof acpApi.prompt>>>()
    vi.mocked(acpApi.prompt).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    let sending!: Promise<void>
    let nextSending!: Promise<void>
    await act(async () => { sending = session.sendPrompt(payload); await Promise.resolve() })
    await act(async () => { await second.cancel() })
    await act(async () => { nextSending = second.sendPrompt(payload); await Promise.resolve() })
    expect(acpApi.prompt).toHaveBeenCalledTimes(2)
    await act(async () => { old.resolve(ok({ stopReason: 'cancelled' })); await sending })
    expect(useAcpUiStore.getState().prompting).toBe(true)
    await act(async () => { await session.sendPrompt(payload) })
    expect(acpApi.prompt).toHaveBeenCalledTimes(2)
    await act(async () => { next.resolve(ok({ stopReason: 'end_turn' })); await nextSending })
    expect(useAcpUiStore.getState().prompting).toBe(false)
  })
})
