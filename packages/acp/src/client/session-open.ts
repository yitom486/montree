import { RequestError } from '@agentclientprotocol/sdk'
import type { AcpSessionRestoreAttempt, AcpSessionRestoreMethod } from '@inkdown/contracts'
import { mergeTopLevelModelsIntoConfigOptions } from '../session/config-options'

export type AcpRpcRequest = (method: string, params?: unknown) => Promise<unknown>

export interface RestoreOrCreateSessionInput {
  /** SDK 调用源：(method, params) => agent.request(method, params)（超时由 sdk-client 显式透传） */
  request: AcpRpcRequest
  cwd: string
  resumeSessionId: string | null
  resumeSupported: boolean
  loadSupported: boolean
  /** 客户端自带的 MCP server（Inkdown 工具）；Agent 不支持 HTTP 传输时传空数组 */
  mcpServers?: unknown[]
  /** session/load 回放期间回调（主进程用来压制 UI 更新） */
  onSuppressUpdates?: (suppress: boolean) => void
  /** 测试可设为 0 */
  retryDelayMs?: number
  log?: (level: 'info' | 'warn', message: string, data?: Record<string, unknown>) => void
}

export interface RestoreOrCreateSessionResult {
  sessionId: string
  configOptions: unknown
  restoreMethod: AcpSessionRestoreMethod
  sessionRestored: boolean
  requestedSessionId?: string
  restoreAttempts: AcpSessionRestoreAttempt[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * SDK 瞬时错误判定：连接层故障（关闭/中断/超时/管道）可重试 1 次；
 * 协议层拒绝（cancelled / method-not-found / invalid-params / 业务 not-found）
 * 不重试，直接落到下一恢复手段。
 *
 * 注意：SDK 会把 Agent 侧抛出的 Error 归一化为 RequestError(-32603)，原文
 * 藏进 data.details，因此连带 data 一起判定。
 */
export function isTransientAcpTransportError(error: unknown): boolean {
  if (error instanceof RequestError) {
    // -32800 取消、-32601 未实现、-32602 参数错：重试无意义
    if (error.code === -32800 || error.code === -32601 || error.code === -32602) return false
    let detail = ''
    try {
      detail = error.data === undefined ? '' : JSON.stringify(error.data)
    } catch {
      detail = String(error.data)
    }
    return /超时|timeout|timed out|temporar|busy|unavailable|closed|abort|econnreset|epipe/i.test(
      `${error.message} ${detail}`,
    )
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /ACP connection closed|connection closed|closed|abort|超时|timeout|timed out|econnreset|epipe|stdio|stream/i.test(
    message,
  )
}

/**
 * 优先 resume → load → session/new。
 * resume/load 对瞬时传输错误最多再试 1 次；失败明细写入 restoreAttempts。
 */
export async function restoreOrCreateAcpSession(
  input: RestoreOrCreateSessionInput,
): Promise<RestoreOrCreateSessionResult> {
  const resumeId = input.resumeSessionId?.trim() || null
  const restoreAttempts: AcpSessionRestoreAttempt[] = []
  const delayMs = input.retryDelayMs ?? 250
  const log =
    input.log ??
    ((level, message, data) => {
      // 生产环境不刷常规 ACP 诊断；失败 warn 仍保留便于排障
      if (level === 'info' && process.env.NODE_ENV === 'production') return
      const line = `[acp] ${message}`
      if (level === 'warn') console.warn(line, data ?? '')
      else console.info(line, data ?? '')
    })

  const tryRestoreMethod = async (
    method: 'resume' | 'load',
    rpcMethod: string,
  ): Promise<Record<string, unknown> | null> => {
    const maxTries = 2
    let lastError = ''
    for (let tryIndex = 1; tryIndex <= maxTries; tryIndex++) {
      log('info', 'session restore attempt', {
        method: rpcMethod,
        sessionId: resumeId,
        try: tryIndex,
        maxTries,
      })
      try {
        const result = (await input.request(rpcMethod, {
          sessionId: resumeId,
          cwd: input.cwd,
          mcpServers: input.mcpServers ?? [],
        })) as Record<string, unknown>
        restoreAttempts.push({ method, ok: true, tries: tryIndex })
        log('info', 'session restore ok', { method: rpcMethod, sessionId: resumeId })
        return result
      } catch (error) {
        lastError = errorMessage(error)
        log('warn', 'session restore failed', {
          method: rpcMethod,
          sessionId: resumeId,
          try: tryIndex,
          error: lastError,
        })
        const canRetry = tryIndex < maxTries && isTransientAcpTransportError(error)
        if (!canRetry) {
          restoreAttempts.push({ method, ok: false, tries: tryIndex, error: lastError })
          return null
        }
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      }
    }
    restoreAttempts.push({ method, ok: false, tries: maxTries, error: lastError })
    return null
  }

  log('info', 'openSession', {
    resumeId,
    resumeSupported: input.resumeSupported,
    loadSupported: input.loadSupported,
  })

  // session/new 共用 helper：首次失败时裸调（mcpServers: []）重试一次；
  // 成功则继续，仍失败抛原错（首次错误为准，便于 UI 显示真实原因）。
  const requestSessionNew = async (): Promise<Record<string, unknown>> => {
    const baseParams = {
      cwd: input.cwd,
      mcpServers: input.mcpServers ?? [],
    }
    try {
      return (await input.request('session/new', baseParams)) as Record<string, unknown>
    } catch (firstError) {
      // 已是裸调则无重试意义，直接抛
      if ((input.mcpServers ?? []).length === 0) throw firstError
      log('warn', 'session/new failed, retry without mcpServers', {
        error: errorMessage(firstError),
      })
      try {
        return (await input.request('session/new', {
          cwd: input.cwd,
          mcpServers: [],
        })) as Record<string, unknown>
      } catch {
        throw firstError
      }
    }
  }

  const withModelsFallback = (result: Record<string, unknown>): unknown =>
    mergeTopLevelModelsIntoConfigOptions(result.configOptions, result)

  if (resumeId && input.resumeSupported) {
    const resumed = await tryRestoreMethod('resume', 'session/resume')
    if (resumed) {
      const id = typeof resumed.sessionId === 'string' ? resumed.sessionId : resumeId
      return {
        sessionId: id,
        configOptions: withModelsFallback(resumed),
        restoreMethod: 'resume',
        sessionRestored: true,
        requestedSessionId: resumeId,
        restoreAttempts,
      }
    }
  } else if (resumeId && !input.resumeSupported) {
    log('info', 'skip session/resume：Agent 未声明 resume 能力')
  }

  if (resumeId && input.loadSupported) {
    input.onSuppressUpdates?.(true)
    try {
      const loaded = await tryRestoreMethod('load', 'session/load')
      if (loaded) {
        const id = typeof loaded.sessionId === 'string' ? loaded.sessionId : resumeId
        return {
          sessionId: id,
          configOptions: withModelsFallback(loaded),
          restoreMethod: 'load',
          sessionRestored: true,
          requestedSessionId: resumeId,
          restoreAttempts,
        }
      }
    } finally {
      input.onSuppressUpdates?.(false)
    }
  } else if (resumeId && !input.loadSupported) {
    log('info', 'skip session/load：Agent 未声明 loadSession 能力')
  }

  log('info', 'falling back to session/new', { resumeId, restoreAttempts })
  const sessionResult = await requestSessionNew()
  const newSessionId =
    typeof sessionResult.sessionId === 'string' ? sessionResult.sessionId : null
  if (!newSessionId) {
    throw new Error('session/new 未返回 sessionId')
  }

  return {
    sessionId: newSessionId,
    configOptions: withModelsFallback(sessionResult),
    restoreMethod: 'new',
    sessionRestored: false,
    requestedSessionId: resumeId ?? undefined,
    restoreAttempts,
  }
}
