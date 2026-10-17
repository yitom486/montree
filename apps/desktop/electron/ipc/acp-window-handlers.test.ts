import { EventEmitter } from 'node:events'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { IPC, ok } from '@yitom/contracts'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), connect: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const ipc = new EventEmitter() as EventEmitter & { handle: (name: string, fn: (...args: any[]) => any) => void }
  ipc.handle = (name, fn) => mocks.handlers.set(name, fn)
  return { ipcMain: ipc, app: { getPath: () => process.cwd(), getVersion: () => 'test' } }
})
vi.mock('../services/acp/acp-connection', () => ({ connectAcp: mocks.connect, disconnectAcp: vi.fn(async () => ok(undefined)), authenticateAcp: vi.fn() }))
vi.mock('../services/reader-screenshot-service', () => ({ captureReaderViewport: vi.fn() }))
import { ipcMain, type WebContents } from 'electron'
import { registerAcpWindowHandlers, withAcpWindow, MAX_SNAPSHOT_IN_FLIGHT } from './acp-window-handlers'
import { acpState, setStatus, getAcpState, claimAcpSession, ownsAcpSession } from '../services/acp/acp-state'
import { handleSnapshotRequest, handlePermissionRequest, emitSessionUpdate } from '../services/acp/acp-bridges'
import { currentAcpContext, getAcpContext, forgetAcpContext } from '../services/acp/acp-context'

let nextId = 800
const windows: FakeWindow[] = []
class FakeWindow extends EventEmitter {
  id = ++nextId
  destroyed = false
  sent: Array<{ channel: string; payload: any }> = []
  isDestroyed() { return this.destroyed }
  send(channel: string, payload: unknown) { this.sent.push({ channel, payload }) }
  get webContents() { return this as unknown as WebContents }
  destroy() { this.destroyed = true; this.emit('destroyed') }
}
const window = () => { const value = new FakeWindow(); windows.push(value); return value }
const invoke = (sender: FakeWindow, channel: string, payload?: unknown) => mocks.handlers.get(channel)!({ sender: sender.webContents }, payload)
beforeAll(registerAcpWindowHandlers)
afterEach(async () => {
  windows.splice(0).forEach((window) => { window.destroy(); forgetAcpContext(getAcpContext(`window-${window.id}`)) })
  await Promise.resolve()
  mocks.connect.mockReset()
})

describe('window-owned ACP IPC', () => {
  it('status and streamed updates reach only their owner, even when another window connects last', () => {
    const a = window(), b = window()
    withAcpWindow(a.webContents, () => { acpState.sessionId = 'a' })
    withAcpWindow(b.webContents, () => { acpState.sessionId = 'b' })
    withAcpWindow(a.webContents, () => {
      setStatus('connected')
      emitSessionUpdate({ sessionId: 'a', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a only' } } })
    })
    expect(a.sent.map((event) => event.channel)).toEqual([IPC.ACP_STATUS_CHANGED, IPC.ACP_SESSION_UPDATE])
    expect(b.sent).toEqual([])
    expect(getAcpState(getAcpContext(`window-${b.id}`)).sessionId).toBe('b')
  })

  it('equal snapshot IDs resolve only the matching sender; owner closure rejects without a focused-window fallback', async () => {
    const a = window(), b = window()
    const pendingA = withAcpWindow(a.webContents, () => handleSnapshotRequest('viewport.txt'))
    const pendingB = withAcpWindow(b.webContents, () => handleSnapshotRequest('viewport.txt'))
    expect(a.sent[0].payload.requestId).toBe(b.sent[0].payload.requestId)
    let bResolved = false
    void pendingB.then(() => { bResolved = true })
    ipcMain.emit(IPC.ACP_SNAPSHOT_RESPONSE, { sender: a.webContents }, { requestId: 1, ok: true, content: 'a document' })
    expect(await pendingA).toBe('a document')
    expect(bResolved).toBe(false)
    ipcMain.emit(IPC.ACP_SNAPSHOT_RESPONSE, { sender: b.webContents }, { requestId: 1, ok: true, content: 'b document' })
    expect(await pendingB).toBe('b document')
    const pendingClose = withAcpWindow(a.webContents, () => handleSnapshotRequest('viewport.txt'))
    const rejected = expect(pendingClose).rejects.toThrow('窗口已关闭')
    a.destroy()
    await rejected
    expect(b.sent).toHaveLength(1)
  })

  it('同窗口快照并发限流：超限排队，释放后放行且监听器归零', async () => {
    const a = window()
    withAcpWindow(a.webContents, () => {})
    // 基线 = 每窗唯一的上下文销毁守卫；桥接监听器必须全部归零到它
    const baseline = a.listenerCount('destroyed')
    expect(baseline).toBe(1)
    const pendings = Array.from({ length: MAX_SNAPSHOT_IN_FLIGHT + 2 }, () =>
      withAcpWindow(a.webContents, () => handleSnapshotRequest('viewport.txt')),
    )
    const sentOf = () => a.sent.filter((s) => s.channel === IPC.ACP_SNAPSHOT_REQUEST)
    const respond = (requestId: number, content: string) => {
      ipcMain.emit(IPC.ACP_SNAPSHOT_RESPONSE, { sender: a.webContents }, { requestId, ok: true, content })
    }
    // 前 4 个同步发出（无竞争快路径），第 5、6 个排队
    expect(sentOf()).toHaveLength(MAX_SNAPSHOT_IN_FLIGHT)
    const results: string[] = []
    pendings.forEach((p, i) => void p.then((v) => { results[i] = v as string }))
    // 回前 4 个：第 5、6 个依次放行发出
    for (const s of sentOf()) respond(s.payload.requestId, `c-${s.payload.requestId}`)
    await expect.poll(() => sentOf().length).toBe(MAX_SNAPSHOT_IN_FLIGHT + 2)
    // 回剩下 2 个：6 个全决议，destroyed 监听器回到基线（无堆积）
    for (const s of sentOf().slice(MAX_SNAPSHOT_IN_FLIGHT)) respond(s.payload.requestId, `c-${s.payload.requestId}`)
    await expect.poll(() => results.filter(Boolean)).toHaveLength(MAX_SNAPSHOT_IN_FLIGHT + 2)
    expect(results.every((v) => typeof v === 'string')).toBe(true)
    expect(a.listenerCount('destroyed')).toBe(baseline)
    await Promise.all(pendings)
  })

  it('permission IDs cannot approve another window; closure cancels pending approval', async () => {
    const a = window(), b = window()
    const params = { toolCall: { title: 'test' }, options: [{ optionId: 'allow', kind: 'allow_once' }] }
    const pa = withAcpWindow(a.webContents, () => handlePermissionRequest('a', params))
    const pb = withAcpWindow(b.webContents, () => handlePermissionRequest('b', params))
    let bResolved = false
    void pb.then(() => { bResolved = true })
    ipcMain.emit(IPC.ACP_PERMISSION_RESPONSE, { sender: a.webContents }, { requestId: 1, outcome: { outcome: 'selected', optionId: 'allow' } })
    expect(await pa).toEqual({ outcome: 'selected', optionId: 'allow' })
    expect(bResolved).toBe(false)
    b.destroy()
    expect(await pb).toEqual({ outcome: 'cancelled' })
  })

  it('reserves a restoring session before await, rejects another window and releases failed claims', async () => {
    const a = window(), b = window()
    let finish!: (value: any) => void
    mocks.connect.mockImplementation(async () => {
      expect(currentAcpContext().id).toBe(`window-${a.id}`)
      return await new Promise((resolve) => { finish = resolve })
    })
    const restoring = invoke(a, IPC.ACP_CONNECT, { runtimeId: 'opencode', resumeSessionId: 'shared-history' })
    expect((await invoke(b, IPC.ACP_CONNECT, { runtimeId: 'opencode', resumeSessionId: 'shared-history' })).ok).toBe(false)
    expect((await invoke(b, IPC.ACP_CONNECT, { runtimeId: 'opencode', resumeSessionId: ' shared-history ' })).ok).toBe(false)
    expect((await invoke(b, IPC.ACP_CANCEL, { sessionId: 'shared-history' })).ok).toBe(false)
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    finish({ ok: false, error: { code: 'ACP_PROTOCOL_ERROR', message: 'fixture failure' } })
    await restoring
    expect(ownsAcpSession('shared-history', 'opencode', getAcpContext(`window-${a.id}`))).toBe(false)
  })

  it('allows each connection to use its own opaque ID when independent Agents return identical IDs', async () => {
    const a = window(), b = window()
    for (const sender of [a, b]) withAcpWindow(sender.webContents, () => { acpState.runtimeId = 'opencode'; claimAcpSession('session-1') })
    // The ownership guard permits both; the unconnected test SDK returns the next-layer error.
    for (const sender of [a, b]) expect((await invoke(sender, IPC.ACP_CANCEL, { sessionId: 'session-1' })).error.code).toBe('ACP_NOT_CONNECTED')
  })
})
