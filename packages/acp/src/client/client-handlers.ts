import {
  INKDOWN_VIRTUAL_RESOURCES,
  isInkdownVirtualDirPath,
  parseInkdownVirtualPath,
  type AcpPermissionOutcome,
  type InkdownVirtualResource,
} from '@inkdown/contracts'
import { methods, RequestError, type ClientApp } from '@agentclientprotocol/sdk'
import { acpReadTextFile, acpWriteTextFile } from './acp-fs'
import type { AcpTerminalManager } from './acp-terminal'

export interface AcpClientHandlerDeps {
  getWorkspaceRoot: () => string | null
  terminals: AcpTerminalManager
  /** 读取 Inkdown 虚拟文件：向渲染进程要内存快照，不碰磁盘 */
  readSnapshot: (resource: InkdownVirtualResource) => Promise<string>
  /**
   * Agent 审批：直接返回 bridge 结果（直返，无待决 Map）。
   * 无 bridge 时由 SDK 层直接 cancelled，禁静默 allow。
   */
  onPermission: (payload: {
    sessionId?: string
    params: Record<string, unknown>
  }) => Promise<AcpPermissionOutcome>
  /** session/update 通知透传（回放压制由调用方做） */
  onSessionUpdate: (params: Record<string, unknown>) => void
}

function toInvalidParams(message: string): RequestError {
  return RequestError.invalidParams(undefined, message)
}

function toServerError(error: unknown, fallback: string): RequestError {
  return new RequestError(-32000, error instanceof Error ? error.message : fallback)
}

/**
 * Agent → Client 回调：permission + fs + terminal（声明能力后才会收到）。
 * SDK 原生签名：onRequest/onNotification 注册；抛 RequestError 即回错误，
 * 无需手写 transport.respond/respondError。
 */
export function registerAcpClientHandlers(app: ClientApp, deps: AcpClientHandlerDeps): void {
  app.onRequest(methods.client.session.requestPermission, async (ctx) => {
    const params = ctx.params as unknown as Record<string, unknown>
    const toolCall = params.toolCall
    const toolHint =
      toolCall && typeof toolCall === 'object'
        ? {
            id:
              typeof (toolCall as { toolCallId?: unknown }).toolCallId === 'string'
                ? (toolCall as { toolCallId: string }).toolCallId
                : undefined,
            title:
              typeof (toolCall as { title?: unknown }).title === 'string'
                ? (toolCall as { title: string }).title
                : undefined,
            kind:
              typeof (toolCall as { kind?: unknown }).kind === 'string'
                ? (toolCall as { kind: string }).kind
                : undefined,
          }
        : undefined
    console.info('[acp] ← Agent request', {
      requestId: ctx.requestId,
      method: 'session/request_permission',
      toolCall: toolHint,
      optionCount: Array.isArray(params.options) ? params.options.length : undefined,
    })
    try {
      const outcome = await deps.onPermission({
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
        params,
      })
      return { outcome }
    } catch (error) {
      console.error('[acp] request_permission 失败', error)
      return { outcome: { outcome: 'cancelled' } as AcpPermissionOutcome }
    }
  })

  app.onRequest(methods.client.fs.readTextFile, async (ctx) => {
    const workspaceRoot = deps.getWorkspaceRoot()
    const filePath = ctx.params.path
    if (!workspaceRoot || !filePath) {
      throw toInvalidParams('fs/read_text_file 需要 path 与已连接工作区')
    }
    const virtualResource = parseInkdownVirtualPath(filePath, workspaceRoot)
    if (virtualResource) {
      try {
        const content = await deps.readSnapshot(virtualResource)
        console.info('[acp] fs/read_text_file 虚拟快照 ok', {
          resource: virtualResource,
          chars: content.length,
        })
        return { content }
      } catch (error) {
        throw toServerError(error, '读取 Inkdown 快照失败')
      }
    }

    if (isInkdownVirtualDirPath(filePath, workspaceRoot)) {
      throw toInvalidParams(`Inkdown 虚拟目录下可读：${INKDOWN_VIRTUAL_RESOURCES.join('、')}`)
    }

    try {
      const result = await acpReadTextFile({
        path: filePath,
        workspaceRoot,
        line: ctx.params.line ?? undefined,
        limit: ctx.params.limit ?? undefined,
      })
      console.info('[acp] fs/read_text_file ok', { path: filePath })
      return result
    } catch (error) {
      throw toServerError(error, '读取文件失败')
    }
  })

  app.onRequest(methods.client.fs.writeTextFile, async (ctx) => {
    const workspaceRoot = deps.getWorkspaceRoot()
    const filePath = ctx.params.path
    const content = ctx.params.content
    if (!workspaceRoot || !filePath || typeof content !== 'string') {
      throw toInvalidParams('fs/write_text_file 需要 path、content 与已连接工作区')
    }
    try {
      // 注意：ACP 约定敏感写操作应由 Agent 先 session/request_permission；
      // 若此处直接写入且从未见 request_permission，说明 Agent 认为工作区内写无需再问。
      console.info('[acp] fs/write_text_file（无内嵌审批，依赖 Agent 是否先 request_permission）', {
        path: filePath,
        bytes: content.length,
      })
      return await acpWriteTextFile({ path: filePath, content, workspaceRoot })
    } catch (error) {
      throw toServerError(error, '写入文件失败')
    }
  })

  app.onRequest(methods.client.terminal.create, async (ctx) => {
    const workspaceRoot = deps.getWorkspaceRoot()
    const sessionId = ctx.params.sessionId
    const command = ctx.params.command
    if (!workspaceRoot || !sessionId || !command) {
      throw toInvalidParams('terminal/create 需要 sessionId、command 与已连接工作区')
    }
    try {
      return deps.terminals.create({
        sessionId,
        command,
        args: ctx.params.args ?? undefined,
        env: ctx.params.env ?? undefined,
        cwd: ctx.params.cwd ?? undefined,
        outputByteLimit: ctx.params.outputByteLimit ?? undefined,
        workspaceRoot,
      })
    } catch (error) {
      throw toServerError(error, '创建终端失败')
    }
  })

  app.onRequest(methods.client.terminal.output, async (ctx) => {
    const terminalId = ctx.params.terminalId
    if (!terminalId) {
      throw toInvalidParams('terminal/output 需要 terminalId')
    }
    try {
      return deps.terminals.getOutput(terminalId)
    } catch (error) {
      throw toServerError(error, '读取终端输出失败')
    }
  })

  app.onRequest(methods.client.terminal.waitForExit, async (ctx) => {
    const terminalId = ctx.params.terminalId
    if (!terminalId) {
      throw toInvalidParams('terminal/wait_for_exit 需要 terminalId')
    }
    try {
      return await deps.terminals.waitForExit(terminalId)
    } catch (error) {
      throw toServerError(error, '等待终端退出失败')
    }
  })

  app.onRequest(methods.client.terminal.kill, async (ctx) => {
    const terminalId = ctx.params.terminalId
    if (!terminalId) {
      throw toInvalidParams('terminal/kill 需要 terminalId')
    }
    try {
      return deps.terminals.kill(terminalId)
    } catch (error) {
      throw toServerError(error, '终止终端失败')
    }
  })

  app.onRequest(methods.client.terminal.release, async (ctx) => {
    const terminalId = ctx.params.terminalId
    if (!terminalId) {
      throw toInvalidParams('terminal/release 需要 terminalId')
    }
    try {
      return deps.terminals.release(terminalId)
    } catch (error) {
      throw toServerError(error, '释放终端失败')
    }
  })

  app.onNotification(methods.client.session.update, async (ctx) => {
    deps.onSessionUpdate({
      sessionId: ctx.params.sessionId,
      update: ctx.params.update,
    } as unknown as Record<string, unknown>)
  })
}

function permissionOptionId(option: Record<string, unknown>): string | null {
  if (typeof option.optionId === 'string') return option.optionId
  if (typeof option.id === 'string') return option.id
  return null
}

/** 从 permission options 中挑一个「允许」类 optionId，否则 cancelled */
export function pickAllowOptionId(params: Record<string, unknown>): string | null {
  const options = params.options
  if (!Array.isArray(options)) return null
  for (const item of options) {
    if (!item || typeof item !== 'object') continue
    const option = item as Record<string, unknown>
    const id = permissionOptionId(option)
    const kind = typeof option.kind === 'string' ? option.kind : ''
    if (id && (kind.includes('allow') || kind === 'allow_once' || kind === 'allow_always')) {
      return id
    }
  }
  for (const item of options) {
    if (!item || typeof item !== 'object') continue
    const id = permissionOptionId(item as Record<string, unknown>)
    if (id) return id
  }
  return null
}
