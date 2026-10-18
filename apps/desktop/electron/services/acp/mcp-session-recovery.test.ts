import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAcpContext, runInAcpContext, forgetAcpContext } from './acp-context'
import { getAcpState } from './acp-state'
import { bindSessionMcp, cancelMcpRecovery, ensureSessionMcp } from './mcp-session-recovery'
import { McpConnectionHealth } from './mcp/connection-health'
import type { MontreeMcpServerHandle } from './mcp/montree-mcp-server'

const mocks = vi.hoisted(() => ({ request: vi.fn(), notify: vi.fn() }))
vi.mock('./sdk-client', () => ({ sdkRequest: (_agent: unknown, ...args: unknown[]) => mocks.request(...args) }))
vi.mock('./acp-connection', () => ({ detachSdkStreamNow: vi.fn(), disconnectAcp: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }))
import { promptAcp, cancelAcp } from './acp-session-ops'

let owner: ReturnType<typeof getAcpContext>
let health: McpConnectionHealth
let handle: MontreeMcpServerHandle
let oldClient: object
const sessionId = 'existing-session'
const inWindow = <T>(fn: () => T) => runInAcpContext(owner, fn)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  owner = getAcpContext(`recovery-${Math.random()}`)
  health = new McpConnectionHealth()
  handle = { url: 'window-pipe', authToken: 'private-token', close: async () => undefined, health }
  oldClient = {}
  const state = getAcpState(owner)
  state.resumeSessionSupported = true
  state.loadSessionSupported = true
  state.status = 'connected'
  state.sessionId = sessionId
  state.sdkConn = { agent: { notify: mocks.notify, request: mocks.request } } as unknown as NonNullable<typeof state.sdkConn>
  inWindow(() => bindSessionMcp(sessionId, handle, process.cwd(), { toolsMode: 'ptc', app: 'resources' }))
  health.discovered(oldClient)
  mocks.request.mockImplementation(async (method: string) => method === 'session/prompt' ? { stopReason: 'end_turn' } : { sessionId })
})
afterEach(() => {
  inWindow(() => cancelMcpRecovery())
  forgetAcpContext(owner)
  vi.useRealTimers()
})

describe('MCP recovery before prompt', () => {
  it('keeps healthy and lazily started sessions on the normal prompt path', async () => {
    await inWindow(() => promptAcp({ sessionId, prompt: [{ type: 'text', text: 'hello' }] }))
    expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(['session/prompt'])
    inWindow(() => bindSessionMcp('lazy', { ...handle, health: new McpConnectionHealth() }, process.cwd()))
    await inWindow(() => ensureSessionMcp('lazy', mocks.request))
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('restores the original session and waits for a new catalog before sending once', async () => {
    health.closed(oldClient)
    mocks.request.mockImplementation(async (method: string) => {
      if (method !== 'session/prompt') expect(getAcpState(owner).suppressSessionUpdates).toBe(true)
      return method === 'session/prompt' ? { stopReason: 'end_turn' } : { sessionId }
    })
    const pending = inWindow(() => promptAcp({ sessionId, prompt: [{ type: 'text', text: 'hello' }] }))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0]).toMatchObject(['session/resume', {
      sessionId, _meta: { toolsMode: 'ptc', app: 'resources' },
      mcpServers: [{ name: 'montree', env: expect.arrayContaining([{ name: 'MONTREE_MCP_PIPE', value: 'window-pipe' }]) }],
    }])
    health.discovered({})
    expect((await pending).ok).toBe(true)
    expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(['session/resume', 'session/prompt'])
    expect(getAcpState(owner).suppressSessionUpdates).toBe(false)
    await inWindow(() => ensureSessionMcp(sessionId, mocks.request))
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('falls back from resume to load, keeps MCP and never creates another session', async () => {
    health.closed(oldClient)
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'session/resume') throw new Error('resume unavailable')
      health.discovered({})
      return { sessionId }
    })
    await inWindow(() => ensureSessionMcp(sessionId, mocks.request))
    expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(['session/resume', 'session/load'])
    expect(mocks.request.mock.calls.every(([, params]) => params.mcpServers.length === 1)).toBe(true)
  })

  it('does not accept only an RPC success when no new tools/list arrives', async () => {
    health.closed(oldClient)
    const pending = inWindow(() => promptAcp({ sessionId, prompt: [{ type: 'text', text: 'hello' }] }))
    await vi.advanceTimersByTimeAsync(20_000)
    const result = await pending
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.message).toContain('重新发现')
    expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(['session/resume', 'session/load'])
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(getAcpState(owner).suppressSessionUpdates).toBe(false)
  })

  it('stops on a different session id instead of sending into it', async () => {
    health.closed(oldClient)
    mocks.request.mockResolvedValue({ sessionId: 'wrong-session' })
    const result = await inWindow(() => promptAcp({ sessionId, prompt: [{ type: 'text', text: 'hello' }] }))
    expect(result.ok).toBe(false)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(getAcpState(owner).sessionId).toBe(sessionId)
  })

  it('cancels discovery waiting without sending the prompt', async () => {
    health.closed(oldClient)
    const pending = inWindow(() => promptAcp({ sessionId, prompt: [{ type: 'text', text: 'hello' }] }))
    await vi.advanceTimersByTimeAsync(0)
    inWindow(() => cancelAcp({ sessionId }))
    const result = await pending
    expect(!result.ok && result.error.code).toBe('CANCELLED')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(getAcpState(owner).suppressSessionUpdates).toBe(false)
  })

  it('invalidates an old recovery on connection change without overwriting the new state', async () => {
    health.closed(oldClient)
    const pending = inWindow(() => promptAcp({ sessionId, prompt: [{ type: 'text', text: 'hello' }] }))
    await vi.advanceTimersByTimeAsync(0)
    getAcpState(owner).connectGeneration++
    getAcpState(owner).suppressSessionUpdates = false
    inWindow(() => cancelMcpRecovery())
    const result = await pending
    expect(!result.ok && result.error.code).toBe('CANCELLED')
    expect(getAcpState(owner).suppressSessionUpdates).toBe(false)
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('requires reconnect when the runtime cannot restore the original session', async () => {
    health.closed(oldClient)
    getAcpState(owner).resumeSessionSupported = false
    getAcpState(owner).loadSessionSupported = false
    const result = await inWindow(() => promptAcp({ sessionId, prompt: [{ type: 'text', text: 'hello' }] }))
    expect(!result.ok && result.error.message).toContain('不支持恢复会话')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('does not treat a previous runtime disconnect as a lazy new session failure', async () => {
    health.closed(oldClient)
    inWindow(() => bindSessionMcp('new-lazy-session', handle, process.cwd()))
    await inWindow(() => ensureSessionMcp('new-lazy-session', mocks.request))
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('blocks another session prompt while replay is suppressed by recovery', async () => {
    health.closed(oldClient)
    inWindow(() => bindSessionMcp('other', { ...handle, health: new McpConnectionHealth() }, process.cwd()))
    const recovering = inWindow(() => ensureSessionMcp(sessionId, mocks.request))
    await vi.advanceTimersByTimeAsync(0)
    const result = await inWindow(() => promptAcp({ sessionId: 'other', prompt: [{ type: 'text', text: 'hello' }] }))
    expect(!result.ok && result.error.message).toContain('正在恢复其他会话')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    health.discovered({})
    await recovering
  })

  it('shares concurrent recovery requests for the same session', async () => {
    health.closed(oldClient)
    const first = inWindow(() => ensureSessionMcp(sessionId, mocks.request))
    const second = inWindow(() => ensureSessionMcp(sessionId, mocks.request))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    health.discovered({})
    await Promise.all([first, second])
  })

  it('does not send into a recovered session that rejected code mode', async () => {
    health.closed(oldClient)
    mocks.request.mockImplementation(async (_method: string, params: Record<string, unknown>) => {
      if (params._meta) throw new Error('unsupported meta')
      return { sessionId }
    })
    const result = await inWindow(() => promptAcp({ sessionId, prompt: [{ type: 'text', text: 'hello' }] }))
    expect(!result.ok && result.error.message).toContain('Code mode')
    expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(['session/resume', 'session/resume'])
    expect(mocks.request.mock.calls.every(([, params]) => params.mcpServers.length === 1)).toBe(true)
  })

  it('isolates window bindings and uses the toc scope and cwd of secondary sessions', async () => {
    const otherOwner = getAcpContext('unrelated-recovery-window')
    try {
      health.closed(oldClient)
      await runInAcpContext(otherOwner, () => ensureSessionMcp(sessionId, mocks.request))
      expect(mocks.request).not.toHaveBeenCalled()
      const tocHealth = new McpConnectionHealth()
      const tocClient = {}
      inWindow(() => bindSessionMcp('toc-session', { ...handle, health: tocHealth }, process.cwd(), undefined, 'montree-toc'))
      tocHealth.discovered(tocClient)
      tocHealth.closed(tocClient)
      mocks.request.mockImplementation(async () => { tocHealth.discovered({}); return { sessionId: 'toc-session' } })
      await inWindow(() => ensureSessionMcp('toc-session', mocks.request))
      expect(mocks.request.mock.calls[0]).toMatchObject(['session/resume', { sessionId: 'toc-session', cwd: process.cwd(), mcpServers: [{ name: 'montree-toc' }] }])
    } finally { forgetAcpContext(otherOwner) }
  })
})
