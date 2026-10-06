import { beforeEach, describe, expect, it, vi } from 'vitest'
import { err, ok } from '@montree/contracts'

vi.mock('@/api/acp-api', () => ({
  acpApi: {
    prompt: vi.fn(),
    cancel: vi.fn(),
    sessionNew: vi.fn(),
    setConfigOption: vi.fn(),
    loadSession: vi.fn(),
  },
}))

vi.mock('@/api/ai-session-api', () => ({
  aiSessionApi: {
    get: vi.fn(),
    put: vi.fn(),
    touch: vi.fn(),
  },
}))

import { acpApi } from '@/api/acp-api'
import { aiSessionApi } from '@/api/ai-session-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import {
  accumulateCardStudioSessionUpdate,
  cardStudioOwnsSessionId,
  clearCardStudioSessions,
  getOrCreateCardStudioSessionId,
  resetCardStudioSession,
  sendCardStudioPrompt,
} from './card-studio-session'

const mockedPrompt = vi.mocked(acpApi.prompt)
const mockedSessionNew = vi.mocked(acpApi.sessionNew)
const mockedLoadSession = vi.mocked(acpApi.loadSession)
const mockedGet = vi.mocked(aiSessionApi.get)
const mockedPut = vi.mocked(aiSessionApi.put)
const mockedTouch = vi.mocked(aiSessionApi.touch)

function streamText(sessionId: string, text: string): void {
  accumulateCardStudioSessionUpdate(sessionId, { content: [{ type: 'text', text }] })
}

beforeEach(() => {
  clearCardStudioSessions()
  resetCardStudioSession('fp-1')
  vi.clearAllMocks()
  useAcpUiStore.setState({ status: 'connected' })
  mockedGet.mockResolvedValue(ok(null))
  mockedPut.mockResolvedValue(ok(undefined))
  mockedTouch.mockResolvedValue(ok(undefined))
  mockedSessionNew.mockResolvedValue(ok({ sessionId: 'sid-card-01', configOptions: [] }))
})

describe('card-studio-session（一书一会话）', () => {
  it('未连接先发直连信令；无驱动则报失败（不回落）', async () => {
    useAcpUiStore.setState({ status: 'disconnected' })
    const ensured = await getOrCreateCardStudioSessionId('fp-1')
    expect(ensured).toEqual({ error: 'unavailable' })
    // 信令发出去了（hook 挂载时自驱 connect）
    expect(useAcpUiStore.getState().connectRequestedAt).toBeGreaterThan(0)
    expect(mockedSessionNew).not.toHaveBeenCalled()
  })

  it('认证中直接报 auth-required（等用户点登录，不替等）', async () => {
    useAcpUiStore.setState({ status: 'awaiting_auth' })
    expect(await getOrCreateCardStudioSessionId('fp-1')).toEqual({ error: 'auth-required' })
    expect(await sendCardStudioPrompt('fp-1', 'prompt')).toEqual({
      status: 'auth-required',
      reply: '',
    })
  })

  it('首调用建新会话并落库；同书复用不重建', async () => {
    const first = await getOrCreateCardStudioSessionId('fp-1')
    expect(first).toEqual({ sessionId: 'sid-card-01' })
    expect(mockedPut).toHaveBeenCalledTimes(1)
    expect(mockedPut).toHaveBeenCalledWith(
      expect.objectContaining({ bookFingerprint: 'fp-1', sessionId: 'sid-card-01' }),
    )

    const second = await getOrCreateCardStudioSessionId('fp-1')
    expect(second).toEqual({ sessionId: 'sid-card-01' })
    expect(mockedSessionNew).toHaveBeenCalledTimes(1)
  })

  it('分书隔离：两本书各建各的', async () => {
    mockedSessionNew
      .mockResolvedValueOnce(ok({ sessionId: 'sid-a', configOptions: [] }))
      .mockResolvedValueOnce(ok({ sessionId: 'sid-b', configOptions: [] }))
    expect(await getOrCreateCardStudioSessionId('fp-a')).toEqual({ sessionId: 'sid-a' })
    expect(await getOrCreateCardStudioSessionId('fp-b')).toEqual({ sessionId: 'sid-b' })
    expect(cardStudioOwnsSessionId('sid-a')).toBe(true)
    expect(cardStudioOwnsSessionId('sid-b')).toBe(true)
    expect(cardStudioOwnsSessionId('sid-x')).toBe(false)
  })

  it('库里有未过期会话走 load 复用', async () => {
    mockedLoadSession.mockResolvedValue(ok({ sessionId: 'sid-old', configOptions: [] }))
    mockedGet.mockResolvedValue(
      ok({
        bookFingerprint: 'fp-1',
        purpose: 'card-studio',
        sessionId: 'sid-old',
        promptCount: 3,
        lastUsedAt: Date.now(),
        createdAt: 1,
        updatedAt: 2,
      }),
    )
    expect(await getOrCreateCardStudioSessionId('fp-1')).toEqual({ sessionId: 'sid-old' })
    expect(mockedLoadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sid-old', secondary: true }),
    )
    expect(mockedSessionNew).not.toHaveBeenCalled()
  })

  it('发送成功记 touch；旧会话已死自转一次重试', async () => {
    const ensured = await getOrCreateCardStudioSessionId('fp-1')
    expect(ensured).toEqual({ sessionId: 'sid-card-01' })
    mockedPrompt.mockImplementationOnce(async () => {
      streamText('sid-card-01', '{"title":"t"}')
      return ok({ stopReason: 'end_turn' })
    })
    expect(await sendCardStudioPrompt('fp-1', 'prompt')).toEqual({
      status: 'ok',
      reply: '{"title":"t"}',
    })
    expect(mockedTouch).toHaveBeenCalledTimes(1)

    // prompt 拒收 → 自转建新会话重试一次
    mockedSessionNew.mockResolvedValueOnce(ok({ sessionId: 'sid-card-02', configOptions: [] }))
    mockedPrompt.mockResolvedValueOnce(err({ code: 'ACP_PROTOCOL_ERROR', message: 'gone' }))
    mockedPrompt.mockImplementationOnce(async () => {
      streamText('sid-card-02', 'retry-ok')
      return ok({ stopReason: 'end_turn' })
    })
    expect(await sendCardStudioPrompt('fp-1', 'prompt')).toEqual({
      status: 'ok',
      reply: 'retry-ok',
    })
    expect(mockedSessionNew).toHaveBeenCalledTimes(2)
  })

  it('无驱动时直连信令发出但无人接单→失败（不断流、不假卡）', async () => {
    useAcpUiStore.setState({ status: 'disconnected' })
    // 单测无 hook 挂载：信令发出，1s 无人驱动即收兵
    expect(await sendCardStudioPrompt('fp-1', 'prompt')).toEqual({ status: 'failed', reply: '' })
    expect(useAcpUiStore.getState().connectRequestedAt).toBeGreaterThan(0)
    expect(mockedSessionNew).not.toHaveBeenCalled()

    useAcpUiStore.setState({ status: 'connected' })
    mockedSessionNew.mockResolvedValueOnce(err({ code: 'ACP_PROTOCOL_ERROR', message: 'nope' }))
    expect(await sendCardStudioPrompt('fp-1', 'prompt')).toEqual({ status: 'failed', reply: '' })
  })

  it('手动重置后下次建新会话', async () => {
    expect(await getOrCreateCardStudioSessionId('fp-1')).toEqual({ sessionId: 'sid-card-01' })
    resetCardStudioSession('fp-1')
    mockedSessionNew.mockResolvedValueOnce(ok({ sessionId: 'sid-card-99', configOptions: [] }))
    expect(await getOrCreateCardStudioSessionId('fp-1')).toEqual({ sessionId: 'sid-card-99' })
  })
})
