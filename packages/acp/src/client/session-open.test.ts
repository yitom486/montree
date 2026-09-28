import { describe, expect, it, afterEach } from 'vitest'
import { agent, client, methods, RequestError } from '@agentclientprotocol/sdk'
import {
  isTransientAcpTransportError,
  restoreOrCreateAcpSession,
} from './session-open'

const liveConnections: Array<{ close: () => void }> = []

afterEach(() => {
  while (liveConnections.length > 0) {
    try {
      liveConnections.pop()?.close()
    } catch {
      // 忽略竞态关闭
    }
  }
})

/**
 * SDK 原生 request 源：内存对接的 ClientConnection.agent.request。
 * fake Agent 用 onRequest 注册 resume/load/new，不走 stdio。
 */
function setupSdkRequest(handlers: {
  onResume?: () => unknown
  onLoad?: () => unknown
  onNew?: () => unknown
}): { request: (method: string, params?: unknown) => Promise<unknown>; calls: string[] } {
  const calls: string[] = []
  const appAgent = agent({ name: 'fake' })
  appAgent.onRequest(methods.agent.session.resume, async () => {
    calls.push('session/resume')
    if (!handlers.onResume) throw RequestError.methodNotFound('session/resume')
    return handlers.onResume() as never
  })
  appAgent.onRequest(methods.agent.session.load, async () => {
    calls.push('session/load')
    if (!handlers.onLoad) throw RequestError.methodNotFound('session/load')
    return handlers.onLoad() as never
  })
  appAgent.onRequest(methods.agent.session.new, async () => {
    calls.push('session/new')
    if (!handlers.onNew) throw RequestError.methodNotFound('session/new')
    return handlers.onNew() as never
  })
  const appClient = client({ name: 'inkdown-test' })
  const clientConn = appClient.connect(appAgent)
  liveConnections.push(clientConn)
  return {
    calls,
    request: (method, params) => clientConn.agent.request<unknown, unknown>(method, params),
  }
}

describe('isTransientAcpTransportError（SDK 错误类型）', () => {
  it('连接关闭与超时可重试', () => {
    expect(isTransientAcpTransportError(new Error('ACP connection closed'))).toBe(true)
    expect(isTransientAcpTransportError(new Error('请求超时: session/resume'))).toBe(true)
  })

  it('协议层拒绝不可重试', () => {
    expect(isTransientAcpTransportError(RequestError.requestCancelled())).toBe(false)
    expect(isTransientAcpTransportError(RequestError.methodNotFound('session/resume'))).toBe(false)
    expect(isTransientAcpTransportError(RequestError.invalidParams())).toBe(false)
    expect(isTransientAcpTransportError(new Error('session not found'))).toBe(false)
  })
})

describe('restoreOrCreateAcpSession（SDK 内存对接）', () => {
  it('prefers session/resume when supported', async () => {
    const sdk = setupSdkRequest({
      onResume: () => ({}),
      onLoad: () => {
        throw new Error('unexpected session/load')
      },
      onNew: () => {
        throw new Error('unexpected session/new')
      },
    })

    const result = await restoreOrCreateAcpSession({
      request: sdk.request,
      cwd: '/ws',
      resumeSessionId: 'old-1',
      resumeSupported: true,
      loadSupported: true,
      retryDelayMs: 0,
      log: () => undefined,
    })

    expect(result.restoreMethod).toBe('resume')
    expect(result.sessionRestored).toBe(true)
    expect(result.sessionId).toBe('old-1')
    expect(sdk.calls).toEqual(['session/resume'])
  })

  it('retries resume on transient close then falls back to load', async () => {
    let resumeTries = 0
    const sdk = setupSdkRequest({
      onResume: () => {
        resumeTries += 1
        throw new Error('ACP connection closed')
      },
      onLoad: () => ({ configOptions: [] }),
    })

    const suppress: boolean[] = []
    const result = await restoreOrCreateAcpSession({
      request: sdk.request,
      cwd: '/ws',
      resumeSessionId: 'old-1',
      resumeSupported: true,
      loadSupported: true,
      retryDelayMs: 0,
      onSuppressUpdates: (v) => suppress.push(v),
      log: () => undefined,
    })

    expect(resumeTries).toBe(2)
    expect(result.restoreMethod).toBe('load')
    expect(result.sessionRestored).toBe(true)
    expect(result.restoreAttempts[0]).toMatchObject({ method: 'resume', ok: false, tries: 2 })
    expect(result.restoreAttempts[1]).toMatchObject({ method: 'load', ok: true, tries: 1 })
    expect(suppress).toEqual([true, false])
  })

  it('falls back to session/new with failed attempts recorded', async () => {
    const sdk = setupSdkRequest({
      onResume: () => {
        throw RequestError.methodNotFound('session/resume')
      },
      onLoad: () => {
        throw new Error('session not found')
      },
      onNew: () => ({ sessionId: 'brand-new' }),
    })

    const result = await restoreOrCreateAcpSession({
      request: sdk.request,
      cwd: '/ws',
      resumeSessionId: '01a04ca7-dead',
      resumeSupported: true,
      loadSupported: true,
      retryDelayMs: 0,
      log: () => undefined,
    })

    expect(result.restoreMethod).toBe('new')
    expect(result.sessionRestored).toBe(false)
    expect(result.sessionId).toBe('brand-new')
    expect(result.requestedSessionId).toBe('01a04ca7-dead')
    // 协议层拒绝不重试，各 1 次
    expect(result.restoreAttempts).toEqual([
      expect.objectContaining({ method: 'resume', ok: false, tries: 1 }),
      expect.objectContaining({ method: 'load', ok: false, tries: 1 }),
    ])
  })

  it('skips restore and creates new when no resume id', async () => {
    const sdk = setupSdkRequest({
      onNew: () => ({ sessionId: 'n1' }),
    })

    const result = await restoreOrCreateAcpSession({
      request: sdk.request,
      cwd: '/ws',
      resumeSessionId: null,
      resumeSupported: true,
      loadSupported: true,
      retryDelayMs: 0,
      log: () => undefined,
    })

    expect(result).toMatchObject({
      sessionId: 'n1',
      restoreMethod: 'new',
      sessionRestored: false,
    })
    expect(sdk.calls).toEqual(['session/new'])
  })

  it('records vi.fn call shape for resume params', async () => {
    const seen: unknown[] = []
    const appAgent = agent({ name: 'fake-params' })
    appAgent.onRequest(methods.agent.session.resume, async (ctx) => {
      seen.push(ctx.params)
      return {}
    })
    const appClient = client({ name: 'inkdown-test' })
    const clientConn = appClient.connect(appAgent)
    liveConnections.push(clientConn)

    await restoreOrCreateAcpSession({
      request: (method, params) => clientConn.agent.request<unknown, unknown>(method, params),
      cwd: '/ws',
      resumeSessionId: 'old-9',
      resumeSupported: true,
      loadSupported: false,
      retryDelayMs: 0,
      log: () => undefined,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ sessionId: 'old-9', cwd: '/ws' })
  })

  it('session/new 失败时裸调（mcpServers: []）重试一次，成功则继续', async () => {
    const seen: unknown[] = []
    let calls = 0
    const result = await restoreOrCreateAcpSession({
      request: async (method, params) => {
        if (method === 'session/new') {
          calls += 1
          seen.push(params)
          if (calls === 1) throw new Error('MCP mount boom')
          return { sessionId: 'n2' }
        }
        throw new Error(`unexpected ${method}`)
      },
      cwd: '/ws',
      resumeSessionId: null,
      resumeSupported: false,
      loadSupported: false,
      mcpServers: [{ type: 'http', name: 'inkdown', url: 'http://x' }],
      retryDelayMs: 0,
      log: () => undefined,
    })

    expect(result.sessionId).toBe('n2')
    expect(result.restoreMethod).toBe('new')
    expect(calls).toBe(2)
    expect(seen[1]).toMatchObject({ mcpServers: [] })
  })

  it('session/new 裸调仍失败时返回原错（首次错误为准）', async () => {
    const first = new Error('first boom')
    let calls = 0
    await expect(
      restoreOrCreateAcpSession({
        request: async (method) => {
          if (method === 'session/new') {
            calls += 1
            if (calls === 1) throw first
            throw new Error('second boom')
          }
          throw new Error(`unexpected ${method}`)
        },
        cwd: '/ws',
        resumeSessionId: null,
        resumeSupported: false,
        loadSupported: false,
        mcpServers: [{ type: 'http', name: 'inkdown', url: 'http://x' }],
        retryDelayMs: 0,
        log: () => undefined,
      }),
    ).rejects.toBe(first)
    expect(calls).toBe(2)
  })

  it('恢复建新同样走 MCP 裸调重试（resume 失败 → new 首次失败 → 裸调成功）', async () => {
    let newCalls = 0
    const seenNewParams: unknown[] = []
    const sdk = setupSdkRequest({
      onResume: () => {
        throw new Error('session not found')
      },
      onLoad: () => {
        throw new Error('session not found')
      },
      onNew: () => {
        newCalls += 1
        if (newCalls === 1) throw new Error('MCP mount boom')
        return { sessionId: 'recovered' }
      },
    })

    const result = await restoreOrCreateAcpSession({
      request: async (method, params) => {
        if (method === 'session/new') seenNewParams.push(params)
        return sdk.request(method, params)
      },
      cwd: '/ws',
      resumeSessionId: 'old-1',
      resumeSupported: true,
      loadSupported: true,
      mcpServers: [{ type: 'http', name: 'inkdown', url: 'http://x' }],
      retryDelayMs: 0,
      log: () => undefined,
    })

    expect(result.sessionId).toBe('recovered')
    expect(result.restoreMethod).toBe('new')
    expect(newCalls).toBe(2)
    expect(seenNewParams[1]).toMatchObject({ mcpServers: [] })
  })

  it('顶层 models 方言合成 model 选项（恢复建新路径）', async () => {
    const sdk = setupSdkRequest({
      onResume: () => {
        throw new Error('session not found')
      },
      onLoad: () => {
        throw new Error('session not found')
      },
      onNew: () => ({ sessionId: 'dsh-1', models: ['d1', 'd2'] }),
    })

    const result = await restoreOrCreateAcpSession({
      request: sdk.request,
      cwd: '/ws',
      resumeSessionId: 'old-1',
      resumeSupported: true,
      loadSupported: true,
      retryDelayMs: 0,
      log: () => undefined,
    })

    expect(result.sessionId).toBe('dsh-1')
    const { parseAcpConfigOptions } = await import('@inkdown/acp')
    const parsed = parseAcpConfigOptions(result.configOptions)
    expect(parsed.find((o) => o.configId === 'model')?.options?.map((o) => o.value)).toEqual([
      'd1',
      'd2',
    ])
  })

  it('load 返回顶层 models 同样合成（对象形 + currentModelId）', async () => {
    const sdk = setupSdkRequest({
      onResume: () => {
        throw new Error('session not found')
      },
      onLoad: () => ({
        sessionId: 'old-1',
        models: { availableModels: [{ id: 'a', name: 'A' }], currentModelId: 'a' },
      }),
    })

    const result = await restoreOrCreateAcpSession({
      request: sdk.request,
      cwd: '/ws',
      resumeSessionId: 'old-1',
      resumeSupported: true,
      loadSupported: true,
      retryDelayMs: 0,
      log: () => undefined,
    })

    expect(result.restoreMethod).toBe('load')
    const { parseAcpConfigOptions } = await import('@inkdown/acp')
    const parsed = parseAcpConfigOptions(result.configOptions)
    expect(parsed.find((o) => o.configId === 'model')?.currentValue).toBe('a')
  })
})
