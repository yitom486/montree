import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent, client, methods, RequestError } from '@agentclientprotocol/sdk'
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import { registerAcpClientHandlers, pickAllowOptionId } from './client-handlers'
import { AcpTerminalManager } from './acp-terminal'
import { resolveAcpPromptCapabilities } from './acp-connection'
import type { AcpPermissionOutcome } from '@montree/contracts'
import type { MontreeVirtualResource } from '@montree/contracts'

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

function testDeps(
  overrides: Partial<{
    workspaceRoot: string | null
    readSnapshot: (resource: MontreeVirtualResource) => Promise<string>
    onPermission: (payload: {
      sessionId?: string
      params: Record<string, unknown>
    }) => Promise<AcpPermissionOutcome>
    onSessionUpdate: (params: Record<string, unknown>) => void
  }> = {},
) {
  return {
    getWorkspaceRoot: () => overrides.workspaceRoot ?? null,
    terminals: new AcpTerminalManager(),
    readSnapshot:
      overrides.readSnapshot ??
      (async () => {
        throw new Error('no snapshot in test')
      }),
    onPermission:
      overrides.onPermission ??
      (async (): Promise<AcpPermissionOutcome> => ({ outcome: 'cancelled' })),
    onSessionUpdate: overrides.onSessionUpdate ?? (() => undefined),
  }
}

/**
 * SDK 内存对接：ClientApp 注册真实 handler，fake Agent 经
 * agentApp.connect(clientApp) 拿到 AgentConnection 调用客户端方法。
 */
function setupPeer(deps: ReturnType<typeof testDeps>) {
  const appClient = client({ name: 'montree-test' })
  registerAcpClientHandlers(appClient, deps)
  const appAgent = agent({ name: 'fake' })
  const agentConn = appAgent.connect(appClient)
  liveConnections.push(agentConn)
  return { appClient, appAgent, agentConn }
}

describe('pickAllowOptionId', () => {
  it('prefers allow_once kind', () => {
    const id = pickAllowOptionId({
      options: [
        { optionId: 'reject-once', kind: 'reject_once' },
        { optionId: 'allow-once', kind: 'allow_once' },
      ],
    })
    expect(id).toBe('allow-once')
  })

  it('falls back to id when optionId missing', () => {
    const id = pickAllowOptionId({
      options: [{ id: 'allow-once', kind: 'allow_once' }],
    })
    expect(id).toBe('allow-once')
  })

  it('returns null when no options', () => {
    expect(pickAllowOptionId({})).toBeNull()
  })
})

describe('AcpTerminalManager path guard', () => {
  it('rejects cwd outside workspace', () => {
    const mgr = new AcpTerminalManager()
    const root = process.cwd()
    expect(() =>
      mgr.create({
        sessionId: 's1',
        command: process.execPath,
        args: ['-e', ''],
        cwd: resolve(root, '..', `__acp_term_outside_${Date.now()}`),
        workspaceRoot: root,
      }),
    ).toThrow(/工作区/)
  })
})

describe('SDK 握手（initialize 内存对接）', () => {
  it('negotiates protocol version and agent info', async () => {
    const appAgent = agent({ name: 'fake' })
    appAgent.onRequest(methods.agent.initialize, async () => ({
      protocolVersion: 1,
      agentCapabilities: {},
      authMethods: [],
      agentInfo: { name: 'mock-agent', version: '0.0.1' },
    }))
    const appClient = client({ name: 'montree-test' })
    const clientConn = appClient.connect(appAgent)
    liveConnections.push(clientConn)

    const init = await clientConn.agent.request(methods.agent.initialize, {
      protocolVersion: 1,
      clientCapabilities: {},
    })
    expect(init.protocolVersion).toBe(1)
    expect(init.agentInfo?.name).toBe('mock-agent')
  })
})

describe('SDK 流式 update（session/update 通知）', () => {
  it('forwards agent updates to onSessionUpdate', async () => {
    const seen: Array<Record<string, unknown>> = []
    const { agentConn } = setupPeer(
      testDeps({ onSessionUpdate: (params) => seen.push(params) }),
    )

    await agentConn.client.notify(methods.client.session.update, {
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    })
    await agentConn.client.notify(methods.client.session.update, {
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' world' },
      },
    })

    await vi.waitFor(() => {
      expect(seen).toHaveLength(2)
    })
    expect(seen[0]).toMatchObject({ sessionId: 's1' })
    expect(seen[1]).toMatchObject({ sessionId: 's1' })
  })
})

describe('SDK permission（allow / reject 直返）', () => {
  function permissionParams() {
    return {
      sessionId: 's1',
      toolCall: {
        toolCallId: 'tc-1',
        title: 'Delete file',
        kind: 'delete' as const,
        status: 'pending' as const,
      },
      options: [
        { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' as const },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' as const },
      ],
    }
  }

  it('allow: bridge selected 直返 agent', async () => {
    let seen: Record<string, unknown> | null = null
    const { agentConn } = setupPeer(
      testDeps({
        onPermission: async ({ params }) => {
          seen = params
          return { outcome: 'selected', optionId: 'allow-once' }
        },
      }),
    )

    const response = await agentConn.client.request<
      RequestPermissionResponse,
      RequestPermissionRequest
    >(
      methods.client.session.requestPermission,
      permissionParams(),
    )

    expect(seen).not.toBeNull()
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' })
  })

  it('reject: bridge selected reject-once 直返 agent', async () => {
    const { agentConn } = setupPeer(
      testDeps({
        onPermission: async () => ({ outcome: 'selected', optionId: 'reject-once' }),
      }),
    )

    const response = await agentConn.client.request<
      RequestPermissionResponse,
      RequestPermissionRequest
    >(
      methods.client.session.requestPermission,
      permissionParams(),
    )

    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' })
  })

  it('bridge 异常时 cancelled，不抛错', async () => {
    const { agentConn } = setupPeer(
      testDeps({
        onPermission: async () => {
          throw new Error('bridge down')
        },
      }),
    )

    const response = await agentConn.client.request<
      RequestPermissionResponse,
      RequestPermissionRequest
    >(
      methods.client.session.requestPermission,
      permissionParams(),
    )

    expect(response.outcome).toEqual({ outcome: 'cancelled' })
  })
})

describe('SDK fs 虚拟快照（±32602）', () => {
  it('命中虚拟路径时走快照，不读磁盘', async () => {
    const seen: string[] = []
    const { agentConn } = setupPeer(
      testDeps({
        workspaceRoot: '/ws',
        readSnapshot: async (resource) => {
          seen.push(resource)
          return '{"entries":[]}'
        },
      }),
    )

    const response = await agentConn.client.request(methods.client.fs.readTextFile, {
      sessionId: 's1',
      path: '/ws/.montree/agent/toc.json',
    })

    expect(seen).toEqual(['toc.json'])
    expect(response.content).toBe('{"entries":[]}')
  })

  it('虚拟目录下的未知资源返回 -32602', async () => {
    const { agentConn } = setupPeer(testDeps({ workspaceRoot: '/ws' }))

    const error = await agentConn.client
      .request(methods.client.fs.readTextFile, {
        sessionId: 's1',
        path: '/ws/.montree/agent/nope.json',
      })
      .then(
        () => null,
        (failure) => failure as RequestError,
      )

    expect(error).toBeInstanceOf(RequestError)
    expect(error?.code).toBe(-32602)
  })
})

describe('SDK terminal guard', () => {
  it('terminal/create without workspace 返回 -32602', async () => {
    const { agentConn } = setupPeer(testDeps({ workspaceRoot: null }))

    const error = await agentConn.client
      .request(methods.client.terminal.create, {
        sessionId: 's1',
        command: 'echo',
      })
      .then(
        () => null,
        (failure) => failure as RequestError,
      )

    expect(error).toBeInstanceOf(RequestError)
    expect(error?.code).toBe(-32602)
  })

  it('terminal/create cwd 越界由 manager 拦截（映射 -32000，不断言静默放行）', async () => {
    const { agentConn } = setupPeer(testDeps({ workspaceRoot: process.cwd() }))

    const error = await agentConn.client
      .request(methods.client.terminal.create, {
        sessionId: 's1',
        command: 'echo',
        cwd: resolve(process.cwd(), '..', `__acp_term_outside_${Date.now()}`),
      })
      .then(
        () => null,
        (failure) => failure as RequestError,
      )

    expect(error).toBeInstanceOf(RequestError)
    expect(error?.code).toBe(-32000)
    expect(String(error?.message)).toMatch(/工作区/)
  })
})

describe('SDK auth 守门（authenticate → session/new）', () => {
  it('未认证建会话被拒，authenticate 后放行并透传 methodId', async () => {
    let authed = false
    const seenMethodIds: string[] = []
    const appAgent = agent({ name: 'fake-auth' })
    appAgent.onRequest(methods.agent.authenticate, async (ctx) => {
      seenMethodIds.push(ctx.params.methodId)
      authed = true
      return {}
    })
    appAgent.onRequest(methods.agent.session.new, async () => {
      if (!authed) throw RequestError.authRequired()
      return { sessionId: 's-auth' }
    })
    const appClient = client({ name: 'montree-test' })
    const clientConn = appClient.connect(appAgent)
    liveConnections.push(clientConn)

    const denied = await clientConn.agent
      .request(methods.agent.session.new, { cwd: '/ws', mcpServers: [] })
      .then(
        () => null,
        (failure) => failure as RequestError,
      )
    expect(denied).toBeInstanceOf(RequestError)
    expect(denied?.code).toBe(-32000)

    await clientConn.agent.request(methods.agent.authenticate, { methodId: 'chatgpt' })
    expect(seenMethodIds).toEqual(['chatgpt'])

    const opened = await clientConn.agent.request(methods.agent.session.new, {
      cwd: '/ws',
      mcpServers: [],
    })
    expect(opened.sessionId).toBe('s-auth')
  })
})

describe('SDK disconnect 代际（close 取消在途，新连接不受影响）', () => {
  it('close rejects pending prompt; fresh connection still works', async () => {
    const appAgent = agent({ name: 'fake-hang' })
    appAgent.onRequest(methods.agent.initialize, async () => ({ protocolVersion: 1 }))
    appAgent.onRequest(
      methods.agent.session.prompt,
      async () => new Promise<never>(() => undefined),
    )
    const appClient = client({ name: 'montree-test' })
    const clientConn = appClient.connect(appAgent)
    liveConnections.push(clientConn)

    const pending = clientConn.agent.request(methods.agent.session.prompt, {
      sessionId: 's1',
      prompt: [{ type: 'text', text: 'hi' }],
    })
    // 让请求先发出去再 close
    await new Promise((resolve) => setTimeout(resolve, 20))
    clientConn.close()

    await expect(pending).rejects.toThrow(/closed/i)
    expect(clientConn.signal.aborted).toBe(true)

    // 新代际连接不受旧 close 影响
    const freshConn = appClient.connect(appAgent)
    liveConnections.push(freshConn)
    const init = await freshConn.agent.request(methods.agent.initialize, {
      protocolVersion: 1,
      clientCapabilities: {},
    })
    expect(init.protocolVersion).toBe(1)
  })
})

describe('resolveAcpPromptCapabilities 多模态能力裁决', () => {
  const dummyRuntime = {
    id: 'opencode',
    name: 'OpenCode Agent',
    command: 'opencode',
    args: ['acp'],
    description: 'OpenCode ACP agent',
    requiredEnvKeys: [],
  }

  it('服务端显式声明 image: false 时尊重服务端指令', () => {
    const caps = { promptCapabilities: { image: false } }
    const initResult = { protocolVersion: 1 }
    const result = resolveAcpPromptCapabilities(caps, initResult as any, dummyRuntime)
    expect(result.image).toBe(false)
  })

  it('服务端显式声明 image: true 时保持开启', () => {
    const caps = { promptCapabilities: { image: true } }
    const initResult = { protocolVersion: 1 }
    const result = resolveAcpPromptCapabilities(caps, initResult as any, dummyRuntime)
    expect(result.image).toBe(true)
  })

  it('服务端未显式声明时（空对象或未声明），默认开启多模态图片能力（不依赖硬编码 runtime.id）', () => {
    const caps = { promptCapabilities: {} }
    const initResult = { protocolVersion: 1 }
    const result = resolveAcpPromptCapabilities(caps, initResult as any, dummyRuntime)
    expect(result.image).toBe(true)
  })

  it('自动检测 agentInfo 或 models 中的多模态大模型证据并保持开启', () => {
    const caps = {}
    const initResult = {
      protocolVersion: 1,
      agentInfo: { name: 'claude-agent', version: '1.0.0' },
      models: ['claude-3-7-sonnet', 'gpt-4o'],
    }
    const result = resolveAcpPromptCapabilities(caps, initResult as any, {
      ...dummyRuntime,
      id: 'custom-bridge',
      name: 'Custom Bridge',
    })
    expect(result.image).toBe(true)
  })
})
