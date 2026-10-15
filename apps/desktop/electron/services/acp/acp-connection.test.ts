import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnedAcpProcess } from './process-manager'
import { getAcpContext, runInAcpContext, forgetAcpContext } from './acp-context'
import { getAcpState } from './acp-state'

const mocks = vi.hoisted(() => ({
  live: null as SpawnedAcpProcess | null,
  spawn: vi.fn(), initialize: vi.fn(), restore: vi.fn(),
  active: 0, maximum: 0,
}))
vi.mock('electron', () => ({ app: { getVersion: () => '0.4.12' } }))
vi.mock('./agent-sandbox-cwd', () => ({ resolveAgentCwd: () => ({ cwd: 'D:\\books', source: 'workspace' }) }))
vi.mock('../bun-runtime', async (original) => ({ ...await original<typeof import('../bun-runtime')>(), ensureBunForCommand: async () => ({ ok: true }) }))
vi.mock('./acp-proxy-service', () => ({ readAcpProxySettings: async () => ({}), buildAcpProxySpawnEnv: () => ({ env: {}, envRemove: [] }) }))
vi.mock('./mcp/stdio-server', () => ({ startWindowMcpServer: async () => ({ url: 'test-pipe', authToken: 'test-token' }) }))
vi.mock('./acp-bridges', async (original) => ({
  ...await original<typeof import('./acp-bridges')>(),
  safeGetAdapter: () => ({}),
  safeProbeAuth: () => ({ looksLoggedIn: true }),
}))
vi.mock('./process-manager', async (original) => ({
  ...await original<typeof import('./process-manager')>(),
  getLiveAcpProcess: () => mocks.live,
  isSpawnedAcpProcessAlive: () => true,
  spawnAcpProcess: (...args: unknown[]) => mocks.spawn(...args),
}))
vi.mock('./session-open', async (original) => ({
  ...await original<typeof import('./session-open')>(),
  restoreOrCreateAcpSession: (...args: unknown[]) => mocks.restore(...args),
}))
vi.mock('./sdk-client', () => ({
  connectSdkClient: (child: { label: string }) => {
    mocks.maximum = Math.max(mocks.maximum, ++mocks.active)
    let closed = false
    return { app: {}, connection: { agent: { label: child.label }, close: () => { if (!closed) { mocks.active--; closed = true } } }, streamHandle: { dispose: vi.fn() } }
  },
  sdkRequest: (agent: { label: string }, method: string) => {
    if (method === 'initialize') return mocks.initialize(agent.label)
    return Promise.resolve({})
  },
}))

import { connectAcp, disconnectAcp } from './acp-connection'

function processHandle(label: string): SpawnedAcpProcess {
  const child = Object.assign(new EventEmitter(), { label, stdout: {}, stdin: {} })
  return { child, kill: vi.fn(() => { mocks.live = null }), stderrTail: [] } as unknown as SpawnedAcpProcess
}
const initialized = { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } }, authMethods: [] }
let scope: ReturnType<typeof getAcpContext>
beforeEach(() => {
  vi.clearAllMocks()
  scope = getAcpContext(`reconnect-${Math.random()}`)
  mocks.active = 0; mocks.maximum = 0
  mocks.live = processHandle('warm')
  mocks.spawn.mockImplementation(() => (mocks.live = processHandle('cold')))
  mocks.initialize.mockImplementation(async (label: string) => { if (label === 'warm') throw new Error('Internal error'); return initialized })
  mocks.restore.mockResolvedValue({ sessionId: 'old-session', sessionRestored: true, restoreMethod: 'resume', restoreAttempts: [], configOptions: [] })
})
afterEach(async () => {
  await runInAcpContext(scope, () => disconnectAcp(undefined, { killProcess: true }))
  forgetAcpContext(scope)
})
const payload = { runtimeId: 'codex-acp', resumeSessionId: 'old-session', hasLocalHistory: true }

describe('ACP reconnect', () => {
  it('温进程握手失败后自动冷启动一次，继续恢复原会话且不发中间错误状态', async () => {
    const statuses: string[] = []
    getAcpState(scope).statusListeners.add((event) => statuses.push(event.status))
    const old = mocks.live!
    const result = await runInAcpContext(scope, () => connectAcp(payload))
    expect(result.ok && result.value.phase === 'ready' && result.value.sessionId).toBe('old-session')
    expect(old.kill).toHaveBeenCalledOnce()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.restore.mock.calls[0]![0]).toMatchObject({ resumeSessionId: 'old-session' })
    expect(statuses).not.toContain('error')
    expect(mocks.maximum).toBe(1)
  })

  it('快速断连重连按顺序清理，连续相同连接共用请求，旧响应不拆新连接', async () => {
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const paused = new Promise<void>((resolve) => { release = resolve })
    mocks.initialize.mockImplementationOnce(async () => { entered(); await paused; return initialized }).mockResolvedValue(initialized)
    const first = runInAcpContext(scope, () => connectAcp(payload))
    await started
    const disconnected = runInAcpContext(scope, () => disconnectAcp())
    const second = runInAcpContext(scope, () => connectAcp(payload))
    expect(runInAcpContext(scope, () => connectAcp(payload))).toBe(second)
    release()
    expect((await first).ok).toBe(false)
    await disconnected
    expect((await second).ok).toBe(true)
    expect(mocks.maximum).toBe(1)
    expect(getAcpState(scope).status).toBe('connected')
  })

  it('冷启动握手仍失败时停止重试并只报告最终错误', async () => {
    mocks.initialize.mockRejectedValue(new Error('Internal error'))
    const result = await runInAcpContext(scope, () => connectAcp(payload))
    expect(result.ok).toBe(false)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.initialize).toHaveBeenCalledTimes(2)
    expect(getAcpState(scope).status).toBe('error')
  })
})
