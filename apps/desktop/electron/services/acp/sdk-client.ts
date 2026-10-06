import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { PassThrough, Readable, Writable } from 'node:stream'
import {
  client as createSdkClientApp,
  ndJsonStream,
  type ClientApp,
  type ClientConnection,
  type ClientContext,
  type Stream,
} from '@agentclientprotocol/sdk'

/** SDK 请求超时：沿用旧手搓传输的 120s，显式透传 */
export const ACP_SDK_REQUEST_TIMEOUT_MS = 120_000

export interface SdkStreamHandle {
  stream: Stream
  /** 摘掉桥接（温进程复用时保住子进程 stdio，不关 fd） */
  dispose: () => void
}

/**
 * stdio 桥接：Node 侧先经 PassThrough 再 toWeb，最后 ndJsonStream(output, input)。
 * 注意参数序：output（写往 Agent，即 child.stdin 侧）在前，input（读自 Agent）在后。
 *
 * 垫 PassThrough 的原因：SDK connection.close() 会一路 cancel 到字节流，
 * 直连 child stdio 会把温进程的 fd 一并销毁，下次复用即死；垫层让 close
 * 只吃掉桥，child stdio 原样保留给下次 connect。
 */
export function createSdkStreamHandle(child: ChildProcessWithoutNullStreams): SdkStreamHandle {
  const stdoutBridge = new PassThrough()
  const stdinBridge = new PassThrough()
  child.stdout.pipe(stdoutBridge)
  stdinBridge.pipe(child.stdin, { end: false })
  const output = Writable.toWeb(stdinBridge) as WritableStream<Uint8Array>
  const input = Readable.toWeb(stdoutBridge) as ReadableStream<Uint8Array>
  const stream = ndJsonStream(output, input)
  let disposed = false
  return {
    stream,
    dispose: () => {
      if (disposed) return
      disposed = true
      try {
        child.stdout.unpipe(stdoutBridge)
      } catch {
        // 忽略竞态关闭
      }
      try {
        stdinBridge.unpipe(child.stdin)
      } catch {
        // 忽略竞态关闭
      }
      try {
        stdoutBridge.destroy()
      } catch {
        // 忽略竞态关闭
      }
      try {
        stdinBridge.destroy()
      } catch {
        // 忽略竞态关闭
      }
    },
  }
}

/**
 * 长驻连接：client({ name: 'montree' }).connect()，持有 ClientConnection。
 * 不用 connectWith 作用域式；调用方用返回的 connection.agent 发请求，
 * 断开时 connection.close() 取消在途请求。
 */
export function connectSdkClient(
  child: ChildProcessWithoutNullStreams,
  configure: (app: ClientApp) => void,
  /** 所属运行时 id：仅日志/隔离用，不改变 SDK 建连形态；缺省向后兼容单 codex 路径 */
  runtimeId?: string,
): { app: ClientApp; connection: ClientConnection; streamHandle: SdkStreamHandle } {
  if (runtimeId && process.env.NODE_ENV !== 'production') {
    console.info(`[acp:sdk] connect runtime=${runtimeId} pid=${child.pid ?? '?'}`)
  }
  const app = createSdkClientApp({ name: 'montree' })
  configure(app)
  const streamHandle = createSdkStreamHandle(child)
  const connection = app.connect(streamHandle.stream)
  return { app, connection, streamHandle }
}

/** 带显式超时的 agent.request：超时 abort（触发 $/cancel_request）并拒绝 */
export async function sdkRequest<Response, Params>(
  agent: ClientContext,
  method: string,
  params: Params,
  timeoutMs: number = ACP_SDK_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = agent.request<Response, Params>(method, params, {
      cancellationSignal: controller.signal,
    })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`请求超时: ${method}`))
      }, timeoutMs)
      timer.unref?.()
    })
    return await Promise.race([pending, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
