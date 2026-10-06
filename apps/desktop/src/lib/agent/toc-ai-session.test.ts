import { beforeEach, describe, expect, it, vi } from 'vitest'
import { err, ok } from '@montree/contracts'

vi.mock('@/api/acp-api', () => ({
  acpApi: {
    prompt: vi.fn(),
    cancel: vi.fn(),
    sessionNew: vi.fn(),
    setConfigOption: vi.fn(),
  },
}))

import { acpApi } from '@/api/acp-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import {
  accumulateTocSessionUpdate,
  cancelTocPrompt,
  ensureTocSessionId,
  resetTocSession,
  sendTocPrompt,
} from './toc-ai-session'

const mockedPrompt = vi.mocked(acpApi.prompt)
const mockedCancel = vi.mocked(acpApi.cancel)
const mockedSessionNew = vi.mocked(acpApi.sessionNew)

async function connectSession(sessionId = 'sid-abcdef01'): Promise<string> {
  useAcpUiStore.setState({ status: 'connected' })
  mockedSessionNew.mockResolvedValue(ok({ sessionId, configOptions: [] }))
  const created = await ensureTocSessionId()
  if (!created) throw new Error('session setup failed')
  return created.sessionId
}

function streamText(sessionId: string, text: string): void {
  accumulateTocSessionUpdate(sessionId, { content: [{ type: 'text', text }] })
}

beforeEach(() => {
  resetTocSession()
  vi.clearAllMocks()
})

describe('sendTocPrompt 发送结局', () => {
  it('有正文 → ok', async () => {
    const sid = await connectSession()
    mockedPrompt.mockImplementation(async () => {
      streamText(sid, '[{"title":"a","printedPage":1}]')
      return ok({ stopReason: 'end_turn' })
    })
    const result = await sendTocPrompt('text', [], { fingerprint: 'fp-1' })
    expect(result.outcome).toBe('ok')
    expect(result.reply).toContain('printedPage')
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(result.opId).toContain(sid.slice(0, 8))
  })

  it('成功但零正文 → empty（工具可能已跑，调用方值得等待）', async () => {
    await connectSession()
    mockedPrompt.mockResolvedValue(ok({ stopReason: 'end_turn' }))
    const result = await sendTocPrompt('text')
    expect(result.outcome).toBe('empty')
    expect(result.reply).toBe('')
  })

  it('ACP_TIMEOUT → timeout（客户端计时，不代表服务端停）', async () => {
    await connectSession()
    mockedPrompt.mockResolvedValue(err({ code: 'ACP_TIMEOUT', message: '请求超时: session/prompt' }))
    const result = await sendTocPrompt('text')
    expect(result.outcome).toBe('timeout')
    expect(result.reply).toBeNull()
  })

  it('其他错误 → error（等待无意义）', async () => {
    await connectSession()
    mockedPrompt.mockResolvedValue(err({ code: 'ACP_PROTOCOL_ERROR', message: 'boom' }))
    const result = await sendTocPrompt('text')
    expect(result.outcome).toBe('error')
    expect(result.reply).toBeNull()
  })

  it('prompt 抛异常 → error', async () => {
    await connectSession()
    mockedPrompt.mockRejectedValue(new Error('ipc down'))
    const result = await sendTocPrompt('text')
    expect(result.outcome).toBe('error')
    expect(result.reply).toBeNull()
  })

  it('无会话 → error 且不调 prompt', async () => {
    const result = await sendTocPrompt('text')
    expect(result.outcome).toBe('error')
    expect(result.reply).toBeNull()
    expect(mockedPrompt).not.toHaveBeenCalled()
  })
})

describe('cancelTocPrompt 止血', () => {
  it('无会话时静默返回', async () => {
    resetTocSession()
    await cancelTocPrompt()
    expect(mockedCancel).not.toHaveBeenCalled()
  })

  it('按传入会话取消（不误杀新会话）', async () => {
    const sid = await connectSession('sid-old-0001')
    mockedCancel.mockResolvedValue(ok(undefined))
    await cancelTocPrompt(sid)
    expect(mockedCancel).toHaveBeenCalledWith({ sessionId: sid })
  })
})
