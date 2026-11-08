import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ok, err } from '@yitom/contracts'
import type { ElicitationEvent } from '../../../contracts/acp-elicitation'
const mocks = vi.hoisted(() => ({ listener: undefined as ((event: ElicitationEvent) => void) | undefined, reply: vi.fn(), status: undefined as ((event: { status: string }) => void) | undefined }))
vi.mock('@/api/acp-elicitation-api', () => ({ acpElicitationApi: {
  subscribe: (listener: typeof mocks.listener) => { mocks.listener = listener; return () => { mocks.listener = undefined } },
  respond: mocks.reply,
} }))
vi.mock('@/api/acp-api', () => ({ acpApi: { onStatusChanged: (listener: typeof mocks.status) => { mocks.status = listener; return () => { mocks.status = undefined } } } }))
import { startAcpElicitationIngest, respondToElicitation } from './useAcpElicitationIngest'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useElicitationStore } from '@/stores/acp/elicitation-store'
import { emitThreadLifecycle } from '@/lib/agent/thread-lifecycle'
let stop: (() => void) | undefined
const request = (id = 'question-1', sessionId = 's1') => mocks.listener?.({ kind: 'request', request: { id, sessionId, message: '选择', schema: { properties: { value: { type: 'string' } } } } })
beforeEach(() => {
  mocks.reply.mockReset().mockResolvedValue(ok(undefined))
  useAcpUiStore.setState({ activeThreadId: 't1', selectedRuntimeId: 'opencode', sessionId: 's1' })
  useElicitationStore.setState({ pending: [], receipts: [] })
  stop = startAcpElicitationIngest()
})
afterEach(() => { stop?.(); vi.restoreAllMocks() })
describe('elicitation routing and response races', () => {
  it('claims a response once across duplicate clicks, preserving a receipt after early close', async () => {
    let resolve!: (result: ReturnType<typeof ok<void>>) => void
    mocks.reply.mockImplementation(() => new Promise(done => { resolve = done }))
    request()
    const response = { action: 'accept' as const, content: { value: 'a' } }
    const pending = respondToElicitation('question-1', response)
    await respondToElicitation('question-1', response)
    expect(mocks.reply).toHaveBeenCalledTimes(1)
    mocks.listener?.({ kind: 'closed', id: 'question-1' })
    resolve(ok(undefined)); await pending
    expect(useElicitationStore.getState().receipts[0].response).toEqual(response)
  })
  it('cancels on thread switch and refuses foreign session requests', () => {
    request()
    useAcpUiStore.setState({ activeThreadId: 't2' })
    expect(mocks.reply).toHaveBeenCalledWith({ id: 'question-1', response: { action: 'cancel' } })
    expect(useElicitationStore.getState().pending).toHaveLength(0)
    request('foreign', 'other-session')
    expect(useElicitationStore.getState().pending).toHaveLength(0)
  })
  it('keeps a failed submission editable and cancels on status loss, clear and teardown', async () => {
    request()
    mocks.reply.mockResolvedValueOnce(err({ code: 'ACP_PROTOCOL_ERROR', message: 'invalid answer' }))
    await expect(respondToElicitation('question-1', { action: 'accept', content: {} })).rejects.toThrow('invalid answer')
    expect(useElicitationStore.getState().pending[0].submitting).toBe(false)
    emitThreadLifecycle({ kind: 'clear', threadId: 't1' })
    expect(useElicitationStore.getState().pending).toHaveLength(0)
    request('status'); mocks.status?.({ status: 'disconnected' })
    expect(useElicitationStore.getState().pending).toHaveLength(0)
    request('teardown'); stop?.(); stop = undefined
    expect(useElicitationStore.getState().pending).toHaveLength(0)
    expect(mocks.listener).toBeUndefined()
  })
})
