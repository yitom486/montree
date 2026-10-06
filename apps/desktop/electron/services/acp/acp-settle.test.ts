import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent, client, methods } from '@agentclientprotocol/sdk'
import { MONTREE_SETTLE_COMPLETE_KIND, type AcpSessionUpdateEvent } from '@montree/contracts'
import {
  acpState,
  armSuppressSettle,
  disarmSuppressSettle,
  onAcpSessionUpdate,
  SUPPRESS_SETTLE_WINDOW_MS,
} from './acp-state'
import { emitSessionUpdate } from './acp-bridges'
import { registerAcpClientHandlers } from './client-handlers'
import { restoreOrCreateAcpSession } from './session-open'
import { disconnectAcp } from './acp-connection'
import { promptAcp } from './acp-session-ops'
import { AcpTerminalManager } from './acp-terminal'

const liveConnections: Array<{ close: () => void }> = []

function replayParams(text: string): Record<string, unknown> {
  return {
    sessionId: 'old-1',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  }
}

function resetSuppressState(): void {
  acpState.suppressSessionUpdates = false
  // disarm 顺带清计时器与 monitorOnly，避免静默超时串到下个用例
  disarmSuppressSettle()
  acpState.pendingHasLocalHistory = null
}

function settleKindOf(event: AcpSessionUpdateEvent): string {
  const update = event.update as Record<string, unknown>
  return typeof update.sessionUpdate === 'string' ? update.sessionUpdate : ''
}

afterEach(() => {
  // 先 disarm（清静默计时器，当前时钟下生效），再关连接、最后恢复真实时钟
  resetSuppressState()
  while (liveConnections.length > 0) {
    try {
      liveConnections.pop()?.close()
    } catch {
      // 忽略竞态关闭
    }
  }
  vi.useRealTimers()
  acpState.sessionUpdateListeners.clear()
  acpState.statusListeners.clear()
  acpState.sdkConn = null
  acpState.sdkApp = null
  acpState.sdkStream = null
  acpState.sessionId = null
  acpState.runtimeId = null
  acpState.workspaceRoot = null
  acpState.status = 'disconnected'
  acpState.activePromptSessionId = null
})

describe('定居窗口单元（fake timers，只测转发层同步逻辑）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('请求期压制只丢弃、不 arm 定居窗口', () => {
    const seen: AcpSessionUpdateEvent[] = []
    const unsub = onAcpSessionUpdate((event) => seen.push(event))
    try {
      acpState.suppressSessionUpdates = true
      emitSessionUpdate(replayParams('Hi'))
      expect(seen).toHaveLength(0)
      expect(acpState.suppressSettleUntil).toBe(0)
    } finally {
      unsub()
    }
  })

  it('armed 窗口内命中即顺延后丢弃，静默超时广播收尾', () => {
    const seen: AcpSessionUpdateEvent[] = []
    const unsub = onAcpSessionUpdate((event) => seen.push(event))
    try {
      const t0 = Date.now()
      armSuppressSettle()
      expect(acpState.suppressSettleUntil).toBe(t0 + SUPPRESS_SETTLE_WINDOW_MS)

      // 窗口中段再来一条重放：丢弃且窗口顺延
      vi.advanceTimersByTime(1000)
      emitSessionUpdate(replayParams('Hi again'))
      expect(seen).toHaveLength(0)
      expect(acpState.suppressSettleUntil).toBe(t0 + 1000 + SUPPRESS_SETTLE_WINDOW_MS)

      // 之后再无回放：静默超时触发收尾（冻结用，不等 prompt）
      vi.advanceTimersByTime(SUPPRESS_SETTLE_WINDOW_MS)
      expect(acpState.suppressSettleUntil).toBe(0)
      expect(seen).toHaveLength(1)
      expect(settleKindOf(seen[0]!)).toBe(MONTREE_SETTLE_COMPLETE_KIND)

      // 收尾后不再重复：过期后的新 update 只放行
      emitSessionUpdate(replayParams('real'))
      expect(seen).toHaveLength(2)
      expect(seen[1]!.update).toMatchObject({ sessionUpdate: 'agent_message_chunk' })
      vi.advanceTimersByTime(SUPPRESS_SETTLE_WINDOW_MS * 2)
      expect(seen).toHaveLength(2)
    } finally {
      unsub()
    }
  })

  it('过期窗口由下一条真实更新触发：先放行后收尾', () => {
    const seen: AcpSessionUpdateEvent[] = []
    const unsub = onAcpSessionUpdate((event) => seen.push(event))
    try {
      armSuppressSettle()
      // 不推进时钟触发计时器，直接把窗口标过期：模拟计时器尚未 fire 时先到一条迟到重放
      acpState.suppressSettleUntil = Date.now() - 1
      emitSessionUpdate(replayParams('late replay'))
      expect(seen).toHaveLength(2)
      expect(seen[0]!.update).toMatchObject({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'late replay' },
      })
      expect(settleKindOf(seen[1]!)).toBe(MONTREE_SETTLE_COMPLETE_KIND)
      expect(acpState.suppressSettleUntil).toBe(0)
      // 挂起的计时器已被 disarm 清掉，推进时钟不再补发
      vi.advanceTimersByTime(SUPPRESS_SETTLE_WINDOW_MS * 2)
      expect(seen).toHaveLength(2)
    } finally {
      unsub()
    }
  })

  it('空线程 monitorOnly：回放放行并滑动，超时同样收尾', () => {
    const seen: AcpSessionUpdateEvent[] = []
    const unsub = onAcpSessionUpdate((event) => seen.push(event))
    try {
      const t0 = Date.now()
      armSuppressSettle(Date.now(), { monitorOnly: true })
      expect(acpState.suppressSettleMonitorOnly).toBe(true)

      vi.advanceTimersByTime(1000)
      emitSessionUpdate(replayParams('history one'))
      expect(seen).toHaveLength(1)
      expect(seen[0]!.update).toMatchObject({
        content: { type: 'text', text: 'history one' },
      })
      // 放行同样顺延窗口（滑动静默）
      expect(acpState.suppressSettleUntil).toBe(t0 + 1000 + SUPPRESS_SETTLE_WINDOW_MS)

      vi.advanceTimersByTime(SUPPRESS_SETTLE_WINDOW_MS)
      expect(seen).toHaveLength(2)
      expect(settleKindOf(seen[1]!)).toBe(MONTREE_SETTLE_COMPLETE_KIND)
      expect(acpState.suppressSettleMonitorOnly).toBe(false)
    } finally {
      unsub()
    }
  })

  it('disarm 后立即放行且不广播收尾（prompt/disconnect 自有 finishStreaming）', () => {
    const seen: AcpSessionUpdateEvent[] = []
    const unsub = onAcpSessionUpdate((event) => seen.push(event))
    try {
      armSuppressSettle()
      disarmSuppressSettle()
      expect(acpState.suppressSettleUntil).toBe(0)
      emitSessionUpdate(replayParams('real'))
      expect(seen).toHaveLength(1)
      expect(settleKindOf(seen[0]!)).toBe('agent_message_chunk')
      // 挂起的计时器已清，推进时钟无补发
      vi.advanceTimersByTime(SUPPRESS_SETTLE_WINDOW_MS * 2)
      expect(seen).toHaveLength(1)
    } finally {
      unsub()
    }
  })
})

describe('load 秒回 + 延迟重放（SDK 内存对接，沿 openSessionAfterAuth 接线）', () => {
  it('重放 updates 被吞，窗口过期后新 update 放行', async () => {
    const seen: AcpSessionUpdateEvent[] = []
    const unsub = onAcpSessionUpdate((event) => seen.push(event))
    try {
      const appClient = client({ name: 'montree-test' })
      registerAcpClientHandlers(appClient, {
        getWorkspaceRoot: () => '/ws',
        terminals: new AcpTerminalManager(),
        readSnapshot: async () => {
          throw new Error('no snapshot in test')
        },
        onPermission: async () => ({ outcome: 'cancelled' }),
        // 连接编排的真实接线：client 回调直通 emitSessionUpdate
        onSessionUpdate: (params) => emitSessionUpdate(params),
      })
      const appAgent = agent({ name: 'fake-cursor' })
      // 注意：SDK connect() 时快照 handler，onRequest 必须先于 connect 注册
      // cursor 行为：load 秒回，随后异步重放历史 session/update
      let agentSide: ReturnType<typeof appAgent.connect> | null = null
      appAgent.onRequest(methods.agent.session.load, async () => {
        setTimeout(() => {
          void agentSide?.client.notify(methods.client.session.update, replayParams('Hi'))
        }, 10)
        setTimeout(() => {
          void agentSide?.client.notify(methods.client.session.update, replayParams('Hi'))
        }, 30)
        // LoadSessionResponse 无 sessionId 字段，调用方回落到请求的 resumeId
        return {}
      })
      const agentConn = appAgent.connect(appClient)
      agentSide = agentConn
      liveConnections.push(agentConn)
      const clientConn = appClient.connect(appAgent)
      liveConnections.push(clientConn)

      // 与 openSessionAfterAuth 同构：请求期压制 → load → arm 定居窗口
      const opened = await restoreOrCreateAcpSession({
        request: (method, params) => clientConn.agent.request<unknown, unknown>(method, params),
        cwd: '/ws',
        resumeSessionId: 'old-1',
        resumeSupported: false,
        loadSupported: true,
        retryDelayMs: 0,
        onSuppressUpdates: (suppress) => {
          acpState.suppressSessionUpdates = suppress
        },
        log: () => undefined,
      })
      expect(opened.restoreMethod).toBe('load')
      expect(opened.sessionId).toBe('old-1')
      expect(acpState.suppressSessionUpdates).toBe(false)
      armSuppressSettle()

      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(seen).toHaveLength(0)
      // 重放命中压制，窗口被顺延、仍处于 armed
      expect(acpState.suppressSettleUntil).toBeGreaterThan(Date.now())

      // 静默期过后（模拟过期）：新 update 先放行，随后广播定居收尾
      acpState.suppressSettleUntil = Date.now() - 1
      await agentConn.client.notify(methods.client.session.update, replayParams('new message'))
      await vi.waitFor(() => {
        expect(seen).toHaveLength(2)
      })
      expect(seen[0].update).toMatchObject({
        content: { type: 'text', text: 'new message' },
      })
      expect(settleKindOf(seen[1]!)).toBe(MONTREE_SETTLE_COMPLETE_KIND)
    } finally {
      unsub()
    }
  })

  it('空线程 monitorOnly：load 回放放行（重建时间线的唯一来源）', async () => {
    const seen: AcpSessionUpdateEvent[] = []
    const unsub = onAcpSessionUpdate((event) => seen.push(event))
    try {
      const appClient = client({ name: 'montree-test' })
      registerAcpClientHandlers(appClient, {
        getWorkspaceRoot: () => '/ws',
        terminals: new AcpTerminalManager(),
        readSnapshot: async () => {
          throw new Error('no snapshot in test')
        },
        onPermission: async () => ({ outcome: 'cancelled' }),
        onSessionUpdate: (params) => emitSessionUpdate(params),
      })
      const appAgent = agent({ name: 'fake-cursor' })
      let agentSide: ReturnType<typeof appAgent.connect> | null = null
      appAgent.onRequest(methods.agent.session.load, async () => {
        setTimeout(() => {
          void agentSide?.client.notify(methods.client.session.update, replayParams('history one'))
        }, 10)
        setTimeout(() => {
          void agentSide?.client.notify(methods.client.session.update, replayParams('history two'))
        }, 30)
        return {}
      })
      const agentConn = appAgent.connect(appClient)
      agentSide = agentConn
      liveConnections.push(agentConn)
      const clientConn = appClient.connect(appAgent)
      liveConnections.push(clientConn)

      const opened = await restoreOrCreateAcpSession({
        request: (method, params) => clientConn.agent.request<unknown, unknown>(method, params),
        cwd: '/ws',
        resumeSessionId: 'old-1',
        resumeSupported: false,
        loadSupported: true,
        retryDelayMs: 0,
        onSuppressUpdates: (suppress) => {
          acpState.suppressSessionUpdates = suppress
        },
        log: () => undefined,
      })
      expect(opened.restoreMethod).toBe('load')
      // 空线程：仅监视不限流（connect.hasLocalHistory=false 经 pending 传到 arm 决策）
      acpState.pendingHasLocalHistory = false
      armSuppressSettle(Date.now(), { monitorOnly: acpState.pendingHasLocalHistory === false })
      acpState.pendingHasLocalHistory = null
      expect(acpState.suppressSettleMonitorOnly).toBe(true)

      await vi.waitFor(() => {
        expect(seen).toHaveLength(2)
      })
      expect(seen[0].update).toMatchObject({
        content: { type: 'text', text: 'history one' },
      })
      expect(seen[1].update).toMatchObject({
        content: { type: 'text', text: 'history two' },
      })
    } finally {
      unsub()
    }
  })

  it('prompt 发起即 disarm，后续真实 update 放行', async () => {
    const seen: AcpSessionUpdateEvent[] = []
    const unsub = onAcpSessionUpdate((event) => seen.push(event))
    try {
      const appAgent = agent({ name: 'fake-cursor' })
      appAgent.onRequest(methods.agent.session.prompt, async () => ({ stopReason: 'end_turn' }))
      const appClient = client({ name: 'montree-test' })
      const clientConn = appClient.connect(appAgent)
      liveConnections.push(clientConn)

      acpState.sdkConn = clientConn
      acpState.status = 'connected'
      acpState.workspaceRoot = '/ws'
      armSuppressSettle()
      expect(acpState.suppressSettleUntil).toBeGreaterThan(0)

      const result = await promptAcp({
        sessionId: 'old-1',
        prompt: [{ type: 'text', text: 'hi' }],
      })
      expect(result.ok).toBe(true)
      expect(acpState.suppressSettleUntil).toBe(0)

      emitSessionUpdate(replayParams('real answer'))
      expect(seen).toHaveLength(1)
    } finally {
      unsub()
    }
  })

  it('disconnect 即 disarm', async () => {
    armSuppressSettle()
    expect(acpState.suppressSettleUntil).toBeGreaterThan(0)
    await disconnectAcp()
    expect(acpState.suppressSettleUntil).toBe(0)
    expect(acpState.suppressSessionUpdates).toBe(false)
    expect(acpState.status).toBe('disconnected')
  })
})
