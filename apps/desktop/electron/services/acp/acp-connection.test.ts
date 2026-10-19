import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnedAcpProcess } from './process-manager'
import { getAcpContext, runInAcpContext, forgetAcpContext } from './acp-context'
import { getAcpState } from './acp-state'
import { McpConnectionHealth } from './mcp/connection-health'
import { restoreOrCreateAcpSession as restoreSession } from '@yitom/acp-client'
import type { McpProcessRestartInput } from './mcp-session-recovery'

const mocks = vi.hoisted(() => ({
  live: null as SpawnedAcpProcess | null,
  spawn: vi.fn(), initialize: vi.fn(), restore: vi.fn(), sessionRequest: vi.fn(),
  active: 0, maximum: 0,
}))
vi.mock('electron', () => ({ app: { getVersion: () => '0.4.12', getAppPath: () => process.cwd(), getPath: () => 'D:/test-home' } }))
vi.mock('./agent-resources', () => ({ initializeAgentResources: async () => process.cwd()+'/apps/desktop/resources/agent', montreeAgentResourceDir: () => process.cwd()+'/apps/desktop/resources/agent' }))
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
  getLiveAcpProcess: (_runtimeId: string, _cwd?: string, tag?: string | null) =>
    tag !== undefined && (mocks.live?.profileTag ?? null) !== tag ? undefined : mocks.live,
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
  sdkRequest: (agent: { label: string }, method: string, params:unknown) => {
    if (method === 'initialize') return mocks.initialize(agent.label)
    return mocks.sessionRequest(method,params)
  },
}))

import { connectAcp, disconnectAcp, restartAcpForMcp } from './acp-connection'
import { createAcpSession, loadAcpSession } from './acp-session-ops'

function processHandle(label: string): SpawnedAcpProcess {
  const child = Object.assign(new EventEmitter(), { label, stdout: {}, stdin: {} })
  return { child, kill: vi.fn(() => { mocks.live = null }), stderrTail: [] } as unknown as SpawnedAcpProcess
}
const initialized = { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } }, authMethods: [] }
let scope: ReturnType<typeof getAcpContext>
let configHome: string
beforeEach(() => {
  // 固定兼容路径，避免开发机现有 Codex 配置与 CI 空 HOME 导致不同温进程标签。
  configHome = mkdtempSync(join(tmpdir(), 'montree-reconnect-home-'))
  writeFileSync(join(configHome, 'config.toml'), 'model = "fixture"\n')
  vi.stubEnv('CODEX_HOME', configHome)
  vi.stubEnv('CODEX_CONFIG', '{}')
  vi.clearAllMocks()
  mocks.sessionRequest.mockResolvedValue({sessionId:'secondary',configOptions:[]})
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
  vi.unstubAllEnvs()
  rmSync(configHome, { recursive: true, force: true })
})
const payload = { runtimeId: 'codex-acp', resumeSessionId: 'old-session', hasLocalHistory: true }

describe('ACP reconnect', () => {
  function recoveryInput(): McpProcessRestartInput {
    const state = getAcpState(scope)
    const health = new McpConnectionHealth()
    const handle = { url: 'test-pipe', authToken: 'test-token', health, close: async () => undefined }
    state.runtimeId = 'opencode'; state.sessionId = 'old-session'; state.montreeMcp = handle
    state.processHandle = mocks.live
    mocks.initialize.mockResolvedValue(initialized)
    mocks.restore.mockImplementation(restoreSession)
    return { sessionId: 'old-session', cwd: 'D:\\books', handle, signal: new AbortController().signal,
      generation: state.connectGeneration, advanceGeneration: vi.fn() }
  }

  it('MCP 超时后强制杀旧进程并冷启动，恢复同一会话且等待新 tools/list', async () => {
    const input = recoveryInput()
    const old = mocks.live!
    mocks.sessionRequest.mockImplementation(async (method: string, params) => {
      expect(method).toBe('session/resume')
      expect(params).toMatchObject({ sessionId: 'old-session', mcpServers: [{ name: 'montree' }] })
      input.handle.health!.discovered({})
      return { sessionId: 'old-session', configOptions: [] }
    })
    await runInAcpContext(scope, () => restartAcpForMcp(input))
    expect(old.kill).toHaveBeenCalledOnce()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.initialize).toHaveBeenCalledTimes(1)
    expect(mocks.sessionRequest).toHaveBeenCalledOnce()
    expect(getAcpState(scope).sessionId).toBe('old-session')
    expect(input.advanceGeneration).toHaveBeenCalledWith(input.generation + 1)
  })

  it('冷恢复的 resume/load 均失败时禁止调用 session/new，且关闭失败进程', async () => {
    const input = recoveryInput()
    mocks.sessionRequest.mockRejectedValue(new Error('session not found'))
    await expect(runInAcpContext(scope, () => restartAcpForMcp(input))).rejects.toThrow()
    expect(mocks.sessionRequest.mock.calls.map(([method]) => method)).toEqual(['session/resume', 'session/load'])
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(getAcpState(scope).sdkConn).toBeNull()
  })

  it('冷恢复不得接收其他会话 ID，也不会发送 prompt', async () => {
    const input = recoveryInput()
    mocks.sessionRequest.mockResolvedValue({ sessionId: 'wrong-session' })
    await expect(runInAcpContext(scope, () => restartAcpForMcp(input))).rejects.toThrow()
    expect(mocks.sessionRequest.mock.calls.every(([method]) => ['session/resume', 'session/load'].includes(method))).toBe(true)
    expect(getAcpState(scope).sessionId).toBeNull()
  })

  it('存在其他活动 prompt 或请求已经取消时不重启进程', async () => {
    const input = recoveryInput()
    getAcpState(scope).activePromptSessionId = 'busy'
    await expect(runInAcpContext(scope, () => restartAcpForMcp(input))).rejects.toThrow('状态已变化')
    getAcpState(scope).activePromptSessionId = null
    const controller = new AbortController(); controller.abort()
    await expect(runInAcpContext(scope, () => restartAcpForMcp({ ...input, signal: controller.signal }))).rejects.toThrow('已取消')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('冷启动 RPC 成功但没有新的工具发现时仍失败，不把旧目录当作恢复', async () => {
    const input = recoveryInput()
    input.handle.health!.discovered({})
    const health = input.handle.health!
    health.waitForDiscovery = (after, signal) => McpConnectionHealth.prototype.waitForDiscovery.call(health, after, signal, 10)
    mocks.sessionRequest.mockResolvedValue({ sessionId: 'old-session' })
    const failure = await runInAcpContext(scope, () => restartAcpForMcp(input)).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('重新发现')
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(getAcpState(scope).sdkConn).toBeNull()
  })

  it('冷启动期间取消会清理进程，不继续恢复或发送消息', async () => {
    const input = recoveryInput()
    const controller = new AbortController()
    let started!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const handshake = new Promise<void>(resolve => { release = resolve })
    mocks.initialize.mockImplementation(async () => { started(); await handshake; return initialized })
    const pending = runInAcpContext(scope, () => restartAcpForMcp({ ...input, signal: controller.signal }))
      .catch((error: unknown) => error)
    await entered
    runInAcpContext(scope, () => controller.abort())
    release()
    expect(await pending).toBeInstanceOf(Error)
    await runInAcpContext(scope, () => disconnectAcp(undefined, { killProcess: true }))
    expect(mocks.sessionRequest).not.toHaveBeenCalled()
    expect(getAcpState(scope).sdkConn).toBeNull()
  })

  it('冷启动后 Code mode 能力丢失时不降级发送', async () => {
    const input = recoveryInput()
    input.meta = { toolsMode: 'ptc' }
    await expect(runInAcpContext(scope, () => restartAcpForMcp(input))).rejects.toThrow('Code mode')
    expect(mocks.sessionRequest).not.toHaveBeenCalled()
  })

  it('规则标签变化时不取消仍在回答的旧会话', async () => {
    const old = mocks.live!
    old.profileTag = 'old-native-binding'
    const state = getAcpState(scope)
    state.processHandle = old
    state.activePromptSessionId = 'busy-session'
    const result = await runInAcpContext(scope, () => connectAcp(payload))
    expect(result.ok).toBe(false)
    expect(old.kill).not.toHaveBeenCalled()
    expect(mocks.initialize).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(state.activePromptSessionId).toBe('busy-session')
  })

  it('新会话回显 native 必须对应真实 spawn 中的追加配置，恢复仍兼容', async () => {
    const home = mkdtempSync(join(tmpdir(), 'montree-connect-rules-'))
    vi.stubEnv('CODEX_HOME', home)
    try {
      mocks.initialize.mockResolvedValue({ ...initialized, agentInfo: { name: 'codex-acp', version: '2.2.2' } })
      mocks.restore.mockResolvedValue({ sessionId: 'fresh', sessionRestored: false, restoreMethod: 'new', restoreAttempts: [], configOptions: [] })
      const result = await runInAcpContext(scope, () => connectAcp({ runtimeId: 'codex-acp' }))
      expect(result.ok && result.value.phase === 'ready' && result.value.promptMode).toBe('native')
      const env = mocks.spawn.mock.calls[0]![0].env
      expect(JSON.parse(env.CODEX_CONFIG).developer_instructions).toContain('montree_present')
      mocks.restore.mockResolvedValue({ sessionId: 'fresh', sessionRestored: true, restoreMethod: 'resume', restoreAttempts: [], configOptions: [] })
      const resumed = await runInAcpContext(scope, () => connectAcp({ runtimeId: 'codex-acp', resumeSessionId: 'fresh' }))
      expect(resumed.ok && resumed.value.phase === 'ready' && resumed.value.promptMode).toBe('compatibility')
    } finally {
      vi.unstubAllEnvs()
      rmSync(home, { recursive: true, force: true })
    }
  })

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
  it('正常断开先等待会话 close 确认，再摘桥和结束进程', async () => {
    const state=getAcpState(scope)
    const handle=mocks.live!
    const order:string[]=[]
    let release!:()=>void
    let entered!:()=>void
    const started=new Promise<void>(r=>{entered=r})
    const acknowledged=new Promise<void>(r=>{release=r})
    state.runtimeId='agy';state.closeSessionSupported=true;state.processHandle=handle
    state.ownedSessionIds.set('agy',new Set(['owned']))
    state.sdkConn={agent:{request:async(method:string,params:{sessionId:string})=>{
      expect(method).toBe('session/close');expect(params.sessionId).toBe('owned')
      order.push('request');entered();await acknowledged;order.push('ack');return {}
    }},close:()=>{order.push('transport')}} as unknown as NonNullable<typeof state.sdkConn>
    const pending=runInAcpContext(scope,()=>disconnectAcp(undefined,{killProcess:true}))
    await started
    expect(handle.kill).not.toHaveBeenCalled()
    expect(order).toEqual(['request'])
    release();await pending
    expect(order).toEqual(['request','ack','transport'])
    expect(handle.kill).toHaveBeenCalledOnce()
  })

  it('主会话与批注副会话下发 SDK 原生参数，目录副会话不携带完整宿主规则', async () => {
    mocks.initialize.mockResolvedValue({...initialized,agentInfo:{name:'claude',version:'0.91.0'}})
    mocks.restore.mockResolvedValue({sessionId:'main',restoreMethod:'resume',sessionRestored:true,restoreAttempts:[],nativeSessionAccepted:true})
    const result=await runInAcpContext(scope,()=>connectAcp({runtimeId:'claude',resumeSessionId:'main'}))
    expect(result.ok && result.value.phase==='ready' && result.value.promptMode).toBe('native')
    const meta=mocks.restore.mock.calls[0]![0].sessionMeta
    expect(meta.systemPrompt.append).toContain('montree_present')
    expect(meta.claudeCode.options.plugins[0].path).toContain('resources')
    await runInAcpContext(scope,()=>createAcpSession())
    expect(mocks.sessionRequest.mock.lastCall).toEqual(['session/new',expect.objectContaining({_meta:meta})])
    await runInAcpContext(scope,()=>loadAcpSession({sessionId:'secondary',secondary:true}))
    expect(mocks.sessionRequest.mock.lastCall).toEqual(['session/load',expect.objectContaining({_meta:meta})])
    await runInAcpContext(scope,()=>createAcpSession(undefined,'toc'))
    expect(mocks.sessionRequest.mock.lastCall![1]).not.toHaveProperty('_meta')
    expect(getAcpState(scope).sessionId).toBe('main')
  })

  it('声明 ptc 时把 _meta.toolsMode 合并进 new/resume 并回带能力', async () => {
    mocks.initialize.mockResolvedValue({
      ...initialized,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
        _meta: { toolsMode: { values: ['native', 'ptc'] } },
      },
    })
    mocks.restore.mockResolvedValue({ sessionId: 'code-mode', restoreMethod: 'new', sessionRestored: false, restoreAttempts: [], nativeSessionAccepted: true, configOptions: [] })
    const result = await runInAcpContext(scope, () => connectAcp({ runtimeId: 'deepseek', codeMode: true }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.value as { codeModeSupported?: boolean }).codeModeSupported).toBe(true)
    const input = mocks.restore.mock.calls.at(-1)?.[0] as { sessionMeta?: Record<string, unknown> }
    expect(input.sessionMeta).toMatchObject({ toolsMode: 'ptc' })
  })

  it('只声明 native 时不注入 code mode', async () => {
    mocks.initialize.mockResolvedValue({
      ...initialized,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
        _meta: { toolsMode: { values: ['native'] } },
      },
    })
    mocks.restore.mockResolvedValue({ sessionId: 'native', restoreMethod: 'new', sessionRestored: false, restoreAttempts: [], configOptions: [] })
    const result = await runInAcpContext(scope, () => connectAcp({ runtimeId: 'deepseek', codeMode: true }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.value as { codeModeSupported?: boolean }).codeModeSupported).toBe(false)
    const input = mocks.restore.mock.calls.at(-1)?.[0] as { sessionMeta?: Record<string, unknown> }
    expect(input.sessionMeta?.toolsMode).toBeUndefined()
  })

  it('不把 code mode 元数据被拒后的 native 回退当成成功', async () => {
    mocks.initialize.mockResolvedValue({
      ...initialized,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
        _meta: { toolsMode: { values: ['native', 'ptc'] } },
      },
    })
    mocks.restore.mockResolvedValue({ sessionId: 'downgraded', restoreMethod: 'new', sessionRestored: false, restoreAttempts: [], nativeSessionAccepted: false, configOptions: [] })
    const result = await runInAcpContext(scope, () => connectAcp({ runtimeId: 'deepseek', codeMode: true }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('拒绝了 code mode')
  })

})
