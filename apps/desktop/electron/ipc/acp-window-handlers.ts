import { ipcMain, type WebContents } from 'electron'
import { IPC, err, resolveSnapshotTimeoutMs, type AcpPermissionResponsePayload, type AcpSnapshotResponsePayload } from '@yitom/contracts'
import type { AcpConnectPayload, AcpAuthenticatePayload, AcpLoadSessionPayload, AcpSessionNewPayload, AcpPromptPayload, AcpCancelPayload, AcpSetConfigOptionPayload, Result, AppError } from '@yitom/contracts'
import {
  acpState, ownsAcpSession, claimAcpSession, releaseAcpSession, onAcpSessionUpdate, onAcpStatusChanged,
  setAcpPermissionBridge, setAcpSnapshotBridge,
  connectAcp, authenticateAcp, loadAcpSession, createAcpSession,
  disconnectAcp, promptAcp, cancelAcp, setAcpConfigOption,
} from '../services/acp/acp-client'
import { currentAcpContext, getAcpContext, listAcpContexts, runInAcpContext, forgetAcpContext, type AcpContext } from '../services/acp/acp-context'
import { disposeContextAcpProcesses } from '../services/acp/process-manager'
import { captureReaderViewport } from '../services/reader-screenshot-service'
import { startWindowMcpServer, stopWindowMcpServers } from '../services/acp/mcp/stdio-server'
import { handleSnapshotRequest } from '../services/acp/acp-bridges'

const registered = new WeakSet<AcpContext>()

/**
 * 同窗口快照并发门：agent 并行十几路 read 时，在途快照曾在 sender 上堆出
 * 十几个 destroyed 监听（MaxListeners 警告）。超限 FIFO 排队；计时器在
 * 拿到槽位后起算，排队不吃超时；窗口销毁时占槽者经 destroyed 收尾放行，
 * 排队者随后取槽即见 closed 而直接拒绝，不悬挂。
 * 无竞争时全同步（不改变既有调用时序），仅超限排队走异步。
 */
export const MAX_SNAPSHOT_IN_FLIGHT = 4

function createSnapshotGate(maxInflight: number) {
  let active = 0
  const waiters: Array<() => void> = []
  return {
    /** 有槽位立刻返回释放函数（同步）；满时返回 null，调用方排队等放行。 */
    tryAcquire(): (() => void) | null {
      if (active >= maxInflight) return null
      active += 1
      let released = false
      return () => {
        if (released) return
        released = true
        active -= 1
        waiters.shift()?.()
      }
    },
    /** 排队等放行。被唤醒后仍需 tryAcquire（槽位可能被新到请求先拿走，
     * 此时重新排队；active 只增不超，无超发、无丢失唤醒）。 */
    waitForSlot(): Promise<void> {
      return new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    },
  }
}

/** Trusted IPC sender chooses the scope; renderer-supplied IDs never choose another window. */
export function withAcpWindow<T>(sender: WebContents, callback: () => T): T {
  const context = getAcpContext(`window-${sender.id}`)
  return runInAcpContext(context, () => {
    if (!registered.has(context)) {
      registered.add(context)
      const send = (channel: string, payload: unknown) => {
        if (!sender.isDestroyed() && !context.closed) sender.send(channel, payload)
      }
      onAcpSessionUpdate((event) => send(IPC.ACP_SESSION_UPDATE, event))
      onAcpStatusChanged((event) => send(IPC.ACP_STATUS_CHANGED, event))
      const snapshotGate = createSnapshotGate(MAX_SNAPSHOT_IN_FLIGHT)
      setAcpPermissionBridge(({ requestId, sessionId, params }) => new Promise((resolve) => {
        if (sender.isDestroyed() || context.closed) { resolve({ outcome: 'cancelled' }); return }
        let settled = false
        const timer = setTimeout(() => finish({ outcome: 'cancelled' }), 120_000)
        const finish = (outcome: AcpPermissionResponsePayload['outcome']) => {
          // 响应与超时竞态只收一次：重复 finish 会重复 removeListener（无害）
          // 但会掩盖“已收尾又来响应”的时序，标记后直接返回
          if (settled) return
          settled = true
          clearTimeout(timer)
          ipcMain.removeListener(IPC.ACP_PERMISSION_RESPONSE, handler)
          sender.removeListener('destroyed', destroyed)
          resolve(outcome)
        }
        const destroyed = () => finish({ outcome: 'cancelled' })
        const handler = (event: Electron.IpcMainEvent, payload: AcpPermissionResponsePayload) => {
          if (event.sender.id === sender.id && payload?.requestId === requestId) finish(payload.outcome)
        }
        ipcMain.on(IPC.ACP_PERMISSION_RESPONSE, handler)
        sender.once('destroyed', destroyed)
        const toolCall = params.toolCall as Record<string, unknown> | undefined
        send(IPC.ACP_PERMISSION_REQUEST, { requestId, sessionId, toolCall, options: params.options, rawParams: params, summary: toolCall?.title ?? '工具调用' })
      }))
      setAcpSnapshotBridge(async ({ requestId, resource, args }) => {
        // 先取槽位再计时：排队等待不消耗快照超时
        let release = snapshotGate.tryAcquire()
        while (!release) {
          await snapshotGate.waitForSlot()
          release = snapshotGate.tryAcquire()
        }
        if (sender.isDestroyed() || context.closed) { release(); throw new Error('Agent 所属窗口已关闭') }
        const content = await new Promise<string>((resolve, reject) => {
          let settled = false
          const timer = setTimeout(() => finish(new Error(`Montree 快照请求超时：${resource}`)), resolveSnapshotTimeoutMs(resource))
          const finish = (error?: Error, text?: string) => {
            if (settled) return
            settled = true
            release()
            clearTimeout(timer)
            ipcMain.removeListener(IPC.ACP_SNAPSHOT_RESPONSE, handler)
            sender.removeListener('destroyed', destroyed)
            if (error) reject(error)
            else resolve(text ?? '')
          }
          const destroyed = () => finish(new Error('Agent 所属窗口已关闭'))
          const handler = (event: Electron.IpcMainEvent, payload: AcpSnapshotResponsePayload) => {
            if (event.sender.id !== sender.id || payload?.requestId !== requestId) return
            if (payload.ok) finish(undefined, payload.content)
            else finish(new Error(payload.message))
          }
          ipcMain.on(IPC.ACP_SNAPSHOT_RESPONSE, handler)
          sender.once('destroyed', destroyed)
          send(IPC.ACP_SNAPSHOT_REQUEST, { requestId, resource, args })
        })
        return resource === 'viewport-image' ? JSON.stringify(await captureReaderViewport(sender, content)) : content
      })
      sender.once('destroyed', () => {
        context.closed = true
        void runInAcpContext(context, async () => {
          acpState.connectGeneration += 1
          disposeContextAcpProcesses()
          try { await disconnectAcp(undefined, { killProcess: true }) }
          finally {
            await stopWindowMcpServers()
            acpState.sessionUpdateListeners.clear()
            acpState.statusListeners.clear()
            acpState.snapshotBridge = null
            acpState.permissionBridge = null
            forgetAcpContext(context)
          }
        }).catch((error) => console.error('[acp] 窗口 Agent 清理失败', error))
      })
      void startWindowMcpServer({ readSnapshot: handleSnapshotRequest }).then((handle) => {
        if (!context.closed) acpState.montreeMcp = handle
      }).catch(() => { /* connect retries and returns the actionable error */ })
    }
    return callback()
  })
}

function sessionError(sessionId: string | undefined, restoring = false, runtimeId = acpState.runtimeId): Result<never, AppError> | undefined {
  if (!sessionId) return undefined
  if (ownsAcpSession(sessionId, runtimeId)) return undefined
  const context = currentAcpContext()
  const foreign = listAcpContexts().some((other) => other !== context && !other.closed && ownsAcpSession(sessionId, runtimeId, other))
  if (foreign || !restoring) {
    return err({ code: 'ACP_PROTOCOL_ERROR', message: '该 Agent 会话不属于当前窗口，请在当前窗口新建对话' })
  }
  return undefined
}

/** 恢复前同步占用，避免两个窗口同时恢复同一历史会话的竞态。 */
async function restoreOwnedSession<T>(sessionId: string | undefined, runtimeId: string | null, callback: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
  const invalid = sessionError(sessionId, true, runtimeId)
  if (invalid) return invalid
  const alreadyOwned = sessionId ? ownsAcpSession(sessionId, runtimeId) : false
  if (sessionId) claimAcpSession(sessionId, runtimeId)
  try {
    const result = await callback()
    if (!result.ok && sessionId && !alreadyOwned) releaseAcpSession(sessionId, runtimeId)
    return result
  } catch (error) {
    if (sessionId && !alreadyOwned) releaseAcpSession(sessionId, runtimeId)
    throw error
  }
}

export function registerAcpWindowHandlers(): void {
  ipcMain.handle(IPC.ACP_CONNECT, (event, payload: AcpConnectPayload) => withAcpWindow(event.sender, () => restoreOwnedSession(payload.resumeSessionId, payload.runtimeId, () => connectAcp(payload))))
  ipcMain.handle(IPC.ACP_AUTHENTICATE, (event, payload: AcpAuthenticatePayload) => withAcpWindow(event.sender, () => authenticateAcp(payload)))
  ipcMain.handle(IPC.ACP_LOAD_SESSION, (event, payload: AcpLoadSessionPayload) => withAcpWindow(event.sender, () => restoreOwnedSession(payload.sessionId, acpState.runtimeId, () => loadAcpSession(payload))))
  ipcMain.handle(IPC.ACP_DISCONNECT, (event) => withAcpWindow(event.sender, () => disconnectAcp()))
  ipcMain.handle(IPC.ACP_SESSION_NEW, (event, payload?: AcpSessionNewPayload) => withAcpWindow(event.sender, () => createAcpSession(payload?.cwd, payload?.toolScope === 'toc' ? 'toc' : 'full')))
  ipcMain.handle(IPC.ACP_PROMPT, (event, payload: AcpPromptPayload) => withAcpWindow(event.sender, () => sessionError(payload.sessionId) ?? promptAcp(payload)))
  ipcMain.handle(IPC.ACP_CANCEL, (event, payload: AcpCancelPayload) => withAcpWindow(event.sender, () => sessionError(payload.sessionId) ?? cancelAcp(payload)))
  ipcMain.handle(IPC.ACP_SET_CONFIG_OPTION, (event, payload: AcpSetConfigOptionPayload) => withAcpWindow(event.sender, () => sessionError(payload.sessionId) ?? setAcpConfigOption(payload)))
}
