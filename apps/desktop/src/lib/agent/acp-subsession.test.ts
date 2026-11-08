import { beforeEach, describe, expect, it, vi } from 'vitest'
import { err, ok } from '@yitom/contracts'

vi.mock('@/api/acp-api', () => ({
  acpApi: {
    prompt: vi.fn(),
    cancel: vi.fn(),
    sessionNew: vi.fn(),
    setConfigOption: vi.fn(),
    loadSession: vi.fn(),
  },
}))

import { acpApi } from '@/api/acp-api'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import type {
  SubsessionEnsureOptions,
  SubsessionEnsureResult,
  SubsessionStore,
} from './acp-subsession'
import {
  accumulateSubsessionUpdate,
  accumulateSubsessionUpdateFor,
  clearSubsessionSessions,
  ensureSubsessionSession,
  isSubsessionPrompting,
  resetSubsession,
  sendSubsessionPrompt,
  subsessionOwnsSessionId,
} from './acp-subsession'

const mockedPrompt = vi.mocked(acpApi.prompt)
const mockedSessionNew = vi.mocked(acpApi.sessionNew)
const mockedLoadSession = vi.mocked(acpApi.loadSession)

let sidSeq = 0

function baseOpts(overrides?: Partial<SubsessionEnsureOptions>): SubsessionEnsureOptions {
  return {
    purpose: 'quiz',
    key: 'default',
    rotation: { idleMs: 2 * 60 * 60 * 1000, maxPrompts: 20 },
    ...overrides,
  }
}

function createMemoryStore() {
  const rows = new Map<string, { sessionId: string; promptCount: number; lastUsedAt: number }>()
  const store: SubsessionStore & {
    rows: typeof rows
    save: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
    touch: ReturnType<typeof vi.fn>
  } = {
    rows,
    save: vi.fn(async (purpose: string, key: string, state) => {
      rows.set(`${purpose}${key}`, { ...state })
    }),
    load: vi.fn(async (purpose: string, key: string) => rows.get(`${purpose}${key}`) ?? null),
    touch: vi.fn(async (purpose: string, key: string) => {
      const row = rows.get(`${purpose}${key}`)
      if (row) row.lastUsedAt = Date.now()
    }),
  }
  return store
}

function streamText(sessionId: string, text: string): void {
  accumulateSubsessionUpdate(sessionId, { content: [{ type: 'text', text }] })
}

function sidOf(result: SubsessionEnsureResult): string {
  if ('error' in result) throw new Error(`expected session, got error=${result.error}`)
  return result.sessionId
}

beforeEach(() => {
  clearSubsessionSessions()
  vi.clearAllMocks()
  sidSeq = 0
  useAcpUiStore.setState({ status: 'connected', promptCapabilities: {} })
  mockedSessionNew.mockImplementation(async () => ok({ sessionId: `sid-${(sidSeq += 1)}`, configOptions: [] }))
  mockedLoadSession.mockImplementation(async () => ok({ sessionId: 'loaded-sid', configOptions: [] }))
})

describe('ensure 建新与复用', () => {
  it('does not replay a failed prompt after the caller has received structured output', async () => {
    mockedPrompt.mockResolvedValueOnce(err({ code: 'ACP_PROTOCOL_ERROR', message: 'connection lost' }))
    const result = await sendSubsessionPrompt({ ...baseOpts(), canRetry: () => false }, 'translate')
    expect(result.status).toBe('failed')
    expect(mockedPrompt).toHaveBeenCalledOnce()
    expect(mockedSessionNew).toHaveBeenCalledOnce()
  })
  it('does not merge agent thoughts or tool output into assistant reply text', async () => {
    const opts = baseOpts()
    const sid = sidOf(await ensureSubsessionSession(opts))
    const deltas: string[] = []
    mockedPrompt.mockImplementationOnce(async () => {
      for (const sessionUpdate of ['agent_thought_chunk', 'tool_call_update', 'user_message_chunk']) {
        accumulateSubsessionUpdate(sid, { sessionUpdate, content: { type: 'text', text: 'private' } })
      }
      accumulateSubsessionUpdate(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'reply' } })
      return ok({ stopReason: 'end_turn' })
    })
    expect(await sendSubsessionPrompt({ ...opts, onDelta: text => deltas.push(text) }, 'hi')).toMatchObject({ reply: 'reply' })
    expect(deltas).toEqual(['reply'])
  })
  it('首次建新会话并写 store', async () => {
    const store = createMemoryStore()
    const ensured = await ensureSubsessionSession(baseOpts({ store }))
    expect('sessionId' in ensured && ensured.sessionId).toBe('sid-1')
    expect('fresh' in ensured && ensured.fresh).toBe(true)
    expect(mockedSessionNew).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenCalledWith(
      'quiz',
      'default',
      expect.objectContaining({ sessionId: 'sid-1', promptCount: 0 }),
    )
  })

  it('未过期即复用，不调 sessionNew', async () => {
    const first = await ensureSubsessionSession(baseOpts())
    const second = await ensureSubsessionSession(baseOpts())
    expect(sidOf(first)).toBe(sidOf(second))
    expect('fresh' in second && second.fresh).toBe(false)
    expect(mockedSessionNew).toHaveBeenCalledTimes(1)
  })

  it('toc 模式透传 toolScope', async () => {
    const ensured = await ensureSubsessionSession(
      baseOpts({ purpose: 'toc', key: 'op-1', rotation: { mode: 'always-new' }, toolScope: 'toc' }),
    )
    expect('sessionId' in ensured).toBe(true)
    expect(mockedSessionNew).toHaveBeenCalledWith(expect.objectContaining({ toolScope: 'toc' }))
  })

  it('新建后应用独立配置覆盖（翻译模型）', async () => {
    mockedSessionNew.mockResolvedValueOnce(ok({
      sessionId: 'model-sid',
      configOptions: [{ configId: 'model', name: 'Model', type: 'select', currentValue: 'default' }],
    }))
    await ensureSubsessionSession(
      baseOpts({ purpose: 'translate', key: 'opencode:fast', configPatches: [{ configId: 'model', value: 'fast' }] }),
    )
    expect(vi.mocked(acpApi.setConfigOption)).toHaveBeenCalledWith({
      sessionId: 'model-sid',
      configId: 'model',
      value: 'fast',
    })
  })

  it('always-new 每次新建且不读 store', async () => {
    const store = createMemoryStore()
    const opts = baseOpts({ purpose: 'toc', key: 'op-1', rotation: { mode: 'always-new' }, store })
    const first = await ensureSubsessionSession(opts)
    const second = await ensureSubsessionSession({ ...opts, key: 'op-2' })
    expect(sidOf(first)).not.toBe(sidOf(second))
    expect(mockedSessionNew).toHaveBeenCalledTimes(2)
    expect(store.load).not.toHaveBeenCalled()
  })

  it('翻译可以跳过主聊天偏好并返回独立配置后的选项', async () => {
    const initial = [{ configId: 'effort', name: 'Effort', type: 'select' as const, currentValue: 'medium', options: [{ value: 'medium', name: 'Medium' }, { value: 'max', name: 'Max' }] }]
    const runtimeId = useAcpUiStore.getState().selectedRuntimeId
    useAcpUiStore.setState({ preferredConfigByRuntime: { [runtimeId]: { effort: 'max' } } })
    mockedSessionNew.mockResolvedValueOnce(ok({ sessionId: 'translation', configOptions: initial }))
    const configureSession = vi.fn(async () => [{ ...initial[0], currentValue: 'low' }])
    const ensured = await ensureSubsessionSession(baseOpts({ purpose: 'translate', runtimeId: useAcpUiStore.getState().selectedRuntimeId, inheritConfigPreferences: false, configureSession }))
    expect(configureSession).toHaveBeenCalledWith('translation', initial)
    expect(acpApi.setConfigOption).not.toHaveBeenCalled()
    expect('configOptions' in ensured && ensured.configOptions[0].currentValue).toBe('low')
  })

  it('独立配置失败时不发送 prompt，也不复用未配置好的会话', async () => {
    mockedSessionNew.mockResolvedValueOnce(ok({ sessionId: 'unconfigured', configOptions: [] }))
    const opts = baseOpts({ purpose: 'translate', configureSession: async () => { throw new Error('配置被拒绝') } })
    await expect(sendSubsessionPrompt(opts, 'hello')).rejects.toThrow('配置被拒绝')
    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(subsessionOwnsSessionId('unconfigured')).toBe(false)
  })

  it('promptCount 达阈值轮转新会话', async () => {
    const opts = baseOpts({ rotation: { idleMs: 2 * 60 * 60 * 1000, maxPrompts: 1 } })
    mockedPrompt.mockResolvedValue(ok({ stopReason: 'end_turn' }))
    await sendSubsessionPrompt(opts, 'hi')
    const ensured = await ensureSubsessionSession(opts)
    expect('sessionId' in ensured && ensured.sessionId).toBe('sid-2')
    expect(mockedSessionNew).toHaveBeenCalledTimes(2)
  })
})

describe('purpose-key 隔离与流式路由', () => {
  it('独立翻译传输不拦截主聊天事件，主聊天增量不进入翻译', async () => {
    const client = {
      sessionNew: vi.fn(async () => ok({ sessionId: 'same-id', configOptions: [] })),
      loadSession: acpApi.loadSession, setConfigOption: acpApi.setConfigOption,
      prompt: vi.fn(async () => {
        expect(subsessionOwnsSessionId('same-id')).toBe(false)
        expect(isSubsessionPrompting()).toBe(false)
        accumulateSubsessionUpdate('same-id', { content: [{ type: 'text', text: '主聊天' }] })
        accumulateSubsessionUpdateFor('translate', 'same-id', { content: [{ type: 'text', text: '翻译' }] }, 'opencode')
        return ok({ stopReason: 'end_turn' })
      }),
    }
    const result = await sendSubsessionPrompt(baseOpts({ purpose: 'translate', runtimeId: 'opencode', client, ensureTransport: async () => 'connected', inheritConfigPreferences: false }), 'translate')
    expect(result.reply).toBe('翻译')
  })
  it('不同 purpose-key 互不干扰', async () => {
    const a = await ensureSubsessionSession(baseOpts({ purpose: 'quiz', key: 'default' }))
    const b = await ensureSubsessionSession(baseOpts({ purpose: 'card', key: 'fp-abc' }))
    expect(sidOf(a)).not.toBe(sidOf(b))
    expect(subsessionOwnsSessionId(sidOf(a))).toBe(true)
    expect(subsessionOwnsSessionId(sidOf(b))).toBe(true)
    expect(subsessionOwnsSessionId('sid-unknown')).toBe(false)
    expect(isSubsessionPrompting('quiz')).toBe(false)
  })

  it('accumulate 按 sessionId 路由并经 prompting 态兜底', async () => {
    const opts = baseOpts()
    const ensured = await ensureSubsessionSession(opts)
    const sid = 'sessionId' in ensured ? ensured.sessionId : ''
    mockedPrompt.mockImplementation(async () => {
      // 未知 sid 但 prompting 中：沿 `|| isXxxPrompting()` 语义仍被收集
      streamText('sid-not-ours', 'hello ')
      streamText(sid, 'world')
      return ok({ stopReason: 'end_turn' })
    })
    const sent = await sendSubsessionPrompt(opts, 'hi')
    expect(sent.status).toBe('ok')
    expect(sent.reply).toBe('hello world')
  })

  it('onDelta 只转发本次 prompt 的增量', async () => {
    const opts = baseOpts()
    const ensured = await ensureSubsessionSession(opts)
    const sid = 'sessionId' in ensured ? ensured.sessionId : ''
    const deltas: string[] = []
    mockedPrompt.mockImplementation(async () => {
      streamText(sid, '你')
      streamText(sid, '好')
      return ok({ stopReason: 'end_turn' })
    })
    const sent = await sendSubsessionPrompt({ ...opts, onDelta: (delta) => deltas.push(delta) }, 'hi')
    expect(sent.reply).toBe('你好')
    expect(deltas).toEqual(['你', '好'])
  })

  it('非 prompting 且 sid 未命中时不收集', async () => {
    const ensured = await ensureSubsessionSession(baseOpts())
    const sid = 'sessionId' in ensured ? ensured.sessionId : ''
    streamText('sid-not-ours', 'stray')
    mockedPrompt.mockImplementation(async () => {
      streamText(sid, 'real')
      return ok({ stopReason: 'end_turn' })
    })
    const sent = await sendSubsessionPrompt(baseOpts(), 'hi')
    expect(sent.reply).toBe('real')
  })
})

describe('store/load 复用', () => {
  it('store 有未过期行则 loadSession 复用，不调 sessionNew', async () => {
    const store = createMemoryStore()
    store.rows.set('cardfp-1', { sessionId: 'stored-sid', promptCount: 3, lastUsedAt: Date.now() })
    mockedLoadSession.mockResolvedValue(ok({ sessionId: 'stored-sid', configOptions: [] }))
    const ensured = await ensureSubsessionSession(
      baseOpts({ purpose: 'card', key: 'fp-1', store }),
    )
    expect('sessionId' in ensured && ensured.sessionId).toBe('stored-sid')
    expect('fresh' in ensured && ensured.fresh).toBe(false)
    expect(mockedLoadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'stored-sid', secondary: true }),
    )
    expect(mockedSessionNew).not.toHaveBeenCalled()
  })

  it('load 失败回落新建', async () => {
    const store = createMemoryStore()
    store.rows.set('cardfp-1', { sessionId: 'dead-sid', promptCount: 0, lastUsedAt: Date.now() })
    mockedLoadSession.mockResolvedValue(err({ code: 'ACP_PROTOCOL_ERROR', message: 'gone' }))
    const ensured = await ensureSubsessionSession(
      baseOpts({ purpose: 'card', key: 'fp-1', store }),
    )
    expect('sessionId' in ensured && ensured.sessionId).toBe('sid-1')
    expect(mockedSessionNew).toHaveBeenCalledTimes(1)
  })
})

describe('send 自转重试与结局', () => {
  it('prompt 拒收删 entry 自转一次重试成功', async () => {
    mockedPrompt
      .mockResolvedValueOnce(err({ code: 'ACP_PROTOCOL_ERROR', message: 'dead' }))
      .mockImplementation(async () => {
        streamText('sid-2', 'retried')
        return ok({ stopReason: 'end_turn' })
      })
    const sent = await sendSubsessionPrompt(baseOpts(), 'hi')
    expect(sent.status).toBe('ok')
    expect(sent.reply).toBe('retried')
    expect(mockedSessionNew).toHaveBeenCalledTimes(2)
  })

  it('两次都拒收则 failed（无 errorCode 即为抛异常路径时亦然）', async () => {
    mockedPrompt.mockResolvedValue(err({ code: 'ACP_PROTOCOL_ERROR', message: 'down' }))
    const sent = await sendSubsessionPrompt(baseOpts(), 'hi')
    expect(sent.status).toBe('failed')
    expect(sent.reply).toBe('')
    expect(sent.errorCode).toBe('ACP_PROTOCOL_ERROR')
    expect(mockedSessionNew).toHaveBeenCalledTimes(2)
  })

  it('ACP_TIMEOUT 不自转，直接 failed 并透传 errorCode', async () => {
    mockedPrompt.mockResolvedValue(err({ code: 'ACP_TIMEOUT', message: '请求超时: session/prompt' }))
    const sent = await sendSubsessionPrompt(baseOpts(), 'hi')
    expect(sent.status).toBe('failed')
    expect(sent.errorCode).toBe('ACP_TIMEOUT')
    expect(mockedSessionNew).toHaveBeenCalledTimes(1)
  })

  it('成功时 store.touch 被调', async () => {
    const store = createMemoryStore()
    mockedPrompt.mockResolvedValue(ok({ stopReason: 'end_turn' }))
    const sent = await sendSubsessionPrompt(baseOpts({ store }), 'hi')
    expect(sent.status).toBe('ok')
    expect(store.touch).toHaveBeenCalledWith('quiz', 'default')
  })

  it('图片经 buildAcpPromptBlocks 组装进 blocks', async () => {
    useAcpUiStore.setState({ promptCapabilities: { image: true } })
    mockedPrompt.mockResolvedValue(ok({ stopReason: 'end_turn' }))
    const sent = await sendSubsessionPrompt(
      {
        ...baseOpts({ purpose: 'toc', key: 'op-9', rotation: { mode: 'always-new' } }),
        images: [{ id: 'toc-img-0', kind: 'image', name: 'toc-p8.png', mimeType: 'image/png', base64: 'aGk=' }],
      },
      '整理目录',
    )
    expect(sent.status).toBe('ok')
    const blocks = mockedPrompt.mock.calls[0]?.[0]?.prompt ?? []
    expect(blocks.some((b) => b.type === 'image')).toBe(true)
  })
})

describe('重置与传输错误透传', () => {
  it('手动重置后下次 ensure 建新会话', async () => {
    const opts = baseOpts()
    const first = await ensureSubsessionSession(opts)
    resetSubsession('quiz', 'default')
    expect(subsessionOwnsSessionId(sidOf(first))).toBe(false)
    const second = await ensureSubsessionSession(opts)
    expect(sidOf(first)).not.toBe(sidOf(second))
    expect(mockedSessionNew).toHaveBeenCalledTimes(2)
  })

  it('auth-required 透传且不调 prompt', async () => {
    useAcpUiStore.setState({ status: 'awaiting_auth' })
    const ensured = await ensureSubsessionSession(baseOpts())
    expect('error' in ensured && ensured.error).toBe('auth-required')
    const sent = await sendSubsessionPrompt(baseOpts(), 'hi')
    expect(sent.status).toBe('auth-required')
    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(mockedSessionNew).not.toHaveBeenCalled()
  })

  it('unavailable 映射为 failed', async () => {
    useAcpUiStore.setState({ status: 'error' })
    const sent = await sendSubsessionPrompt(baseOpts(), 'hi')
    expect(sent.status).toBe('failed')
    expect(mockedPrompt).not.toHaveBeenCalled()
  })
})

describe('drainTrailingUpdates（prompt 应答先于尾部增量到达）', () => {
  it('应答后晚到的文本块在读取回复前被等到', async () => {
    const { drainTrailingUpdates } = await import('./acp-subsession')
    const entry: { lastUpdateAt?: number; replyBuffer: string } = { replyBuffer: '' }
    setTimeout(() => { entry.replyBuffer += '{"title":'; entry.lastUpdateAt = Date.now() }, 60)
    setTimeout(() => { entry.replyBuffer += '"卡"}'; entry.lastUpdateAt = Date.now() }, 120)
    await drainTrailingUpdates(entry)
    expect(entry.replyBuffer).toBe('{"title":"卡"}')
  })

  it('真正的空回复在上限内返回', async () => {
    const { drainTrailingUpdates } = await import('./acp-subsession')
    const started = Date.now()
    await drainTrailingUpdates({ replyBuffer: '' })
    expect(Date.now() - started).toBeLessThan(1500)
  })
})
