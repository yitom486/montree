import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  methods,
  RequestError,
  type ClientApp,
  type ClientConnection,
  type InitializeResponse,
} from '@agentclientprotocol/sdk'
import type {
  AcpAuthMethod,
  AcpConnectionStatus,
  AcpPermissionOutcome,
  AcpProxySettings,
  AcpRuntimeInfo,
  AcpSessionRestoreMethod,
  AppError,
  CodexAuthPreflight,
  InkdownVirtualResource,
} from "../contracts"
import { DEFAULT_ACP_RUNTIME_ID, err, ok, type Result } from "../contracts"
import { findBuiltinAcpRuntime } from "../contracts"
import { getAcpRuntimeAdapter, type AcpRuntimeAdapter } from '../runtimes'
import {
  getLiveAcpProcess,
  isSpawnedAcpProcessAlive,
  spawnAcpProcess,
  type SpawnedAcpProcess,
} from '../process/process-manager'
import { connectSdkClient, sdkRequest, type SdkStreamHandle } from './sdk-client'
import { registerAcpClientHandlers, type AcpClientHandlerDeps } from './client-handlers'
import { restoreOrCreateAcpSession, type RestoreOrCreateSessionResult } from './session-open'
import { AcpTerminalManager } from './acp-terminal'
import { buildAcpProxySpawnEnv, readAcpProxySettings } from './acp-proxy-service'
import { getDefaultAgentDataDir } from './acp-paths'
import { runConnectAuthGate } from '../auth/connect-auth-gate'
import {
  parseLoadSessionSupported,
  parsePromptCapabilities,
  parseResumeSessionSupported,
} from '../session/session-capabilities'

export interface AcpClientCallbacks {
  /** 权限审批回调：当 Agent 尝试执行工具调用或敏感操作时触发 */
  onPermissionRequest?: (payload: {
    sessionId?: string
    toolCall?: { id?: string; title?: string; kind?: string }
    params: Record<string, unknown>
  }) => Promise<AcpPermissionOutcome>
  /** 会话内容流式/状态更新通知 */
  onSessionUpdate?: (params: Record<string, unknown>) => void
  /** 连接状态机变化通知 */
  onStatusChange?: (status: AcpConnectionStatus, detail?: string) => void
  /** Agent 进程 stderr 输出行（供排错与诊断） */
  onStderrLine?: (line: string) => void
  /** 虚拟文件读取（默认不支持，除非宿主提供） */
  readSnapshot?: (resource: InkdownVirtualResource) => Promise<string>
  /** 日志打印 */
  onLog?: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void
}

export interface AcpClientOptions {
  /** 运行时标识，如 'codex-acp', 'claude', 'cursor-cli', 'deepseek', 'gemini' 等 */
  runtime?: string | AcpRuntimeInfo
  /** 工作区根目录路径（必需） */
  workspaceRoot: string
  /** 客户端信息声明（向 Agent 表明调用方身份） */
  clientInfo?: {
    name: string
    version?: string
  }
  /** 数据持久化目录（缺省自动根据操作系统返回标准路径） */
  dataDir?: string
  /** 代理配置（覆盖默认配置文件） */
  proxy?: Partial<AcpProxySettings>
  /** 附加环境变量 */
  env?: NodeJS.ProcessEnv
  /** 事件与审批回调 */
  callbacks?: AcpClientCallbacks
}

export class AcpSessionHandle {
  constructor(
    public readonly sessionId: string,
    private readonly client: AcpClient,
    public readonly restoreMethod: AcpSessionRestoreMethod,
    public readonly configOptions?: unknown,
  ) {}

  /** 向当前会话发送 Prompt / 消息交互 */
  async prompt(promptText: string, options?: { timeoutMs?: number }): Promise<Result<unknown, AppError>> {
    return this.client.promptSession(this.sessionId, promptText, options)
  }

  /** 修改会话配置项（如模型 ID、模式等） */
  async setConfigOption(configId: string, value: string | boolean): Promise<Result<unknown, AppError>> {
    return this.client.setSessionConfigOption(this.sessionId, configId, value)
  }
}

/**
 * 独立的 Headless ACP 客户端：
 * - 纯 TypeScript / Node.js 实现，零 Electron 依赖；
 * - 统一管理多种 Agent 运行时（Codex, Claude, Cursor, DeepSeek 等）；
 * - 自动负责子进程生命周期、Stdio 传输桥接、协议握手与断线清理；
 * - 可在任意 Node.js 项目、CLI 命令行工具或 Web 服务中直接复用。
 */
export class AcpClient {
  private status: AcpConnectionStatus = 'disconnected'
  private runtimeInfo: AcpRuntimeInfo
  private adapter: AcpRuntimeAdapter
  private readonly workspaceRoot: string
  private readonly clientInfo: { name: string; version: string }
  private readonly dataDir: string
  private readonly callbacks: AcpClientCallbacks
  private readonly terminals = new AcpTerminalManager()

  private processHandle: SpawnedAcpProcess | null = null
  private sdkApp: ClientApp | null = null
  private sdkConnection: ClientConnection | null = null
  private streamHandle: SdkStreamHandle | null = null
  private initResponse: InitializeResponse | null = null

  constructor(options: AcpClientOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.clientInfo = {
      name: options.clientInfo?.name ?? 'inkdown',
      version: options.clientInfo?.version ?? '0.1.0',
    }
    this.dataDir = options.dataDir ?? getDefaultAgentDataDir()
    this.callbacks = options.callbacks ?? {}

    const runtimeId =
      typeof options.runtime === 'string'
        ? options.runtime
        : options.runtime?.id ?? DEFAULT_ACP_RUNTIME_ID

    this.adapter = getAcpRuntimeAdapter(runtimeId)

    if (typeof options.runtime === 'object' && options.runtime !== null) {
      this.runtimeInfo = options.runtime
    } else {
      const found = findBuiltinAcpRuntime(runtimeId)
      if (!found) {
        throw new Error(`未知或未注册的 ACP 运行时模板: ${runtimeId}`)
      }
      this.runtimeInfo = found
    }
  }

  get currentStatus(): AcpConnectionStatus {
    return this.status
  }

  get isConnected(): boolean {
    return this.status === 'connected' && Boolean(this.sdkConnection?.agent)
  }

  /** 获取底层当前 Agent 的 RPC 客户端句柄 */
  get agent() {
    return this.sdkConnection?.agent ?? null
  }

  /**
   * 启动并连接 Agent：
   * 1. 预检判停（如缺少 API Key、未安装 CLI）；
   * 2. 跨平台拉起后台守护子进程；
   * 3. 建立 Stdio pass-through 与 ndJsonStream 桥接；
   * 4. 注册权限与 FS 回调；
   * 5. 执行 initialize 协议握手。
   */
  async connect(): Promise<Result<{ status: AcpConnectionStatus; init: InitializeResponse }, AppError>> {
    try {
      this.setStatus('connecting')

      // 1. 预检判停
      const blocker = this.adapter.resolveSpawnBlocker?.()
      if (blocker) {
        this.setStatus('error', blocker)
        return err({ code: 'ACP_SPAWN_ERROR', message: blocker })
      }

      // 2. 命令行路径动态解析（如 Cursor 探测 agent.cmd / PATH）
      let effectiveRuntime = { ...this.runtimeInfo }
      if (this.adapter.resolveSpawnCommand) {
        const resolved = this.adapter.resolveSpawnCommand()
        if (!resolved) {
          const message = `运行时 CLI 未安装: ${this.runtimeInfo.id}`
          this.setStatus('error', message)
          return err({ code: 'ACP_SPAWN_ERROR', message })
        }
        effectiveRuntime.command = resolved.command
        effectiveRuntime.args = resolved.args
      }

      // 3. 代理与环境变量合成
      const storedProxy = await readAcpProxySettings(this.dataDir)
      const proxyEnv = buildAcpProxySpawnEnv(storedProxy)
      const spawnEnv = this.adapter.getSpawnEnv?.(storedProxy) ?? proxyEnv

      // 4. 冷启动/生命周期钩子
      await this.adapter.beforeSpawn?.()

      // 5. 启动或复用进程
      const processHandle = spawnAcpProcess({
        runtime: effectiveRuntime,
        cwd: this.workspaceRoot,
        env: spawnEnv.env,
        envRemove: spawnEnv.envRemove,
        onStderrLine: (line) => {
          this.callbacks.onStderrLine?.(line)
        },
        onExit: (code, signal) => {
          this.callbacks.onLog?.('warn', `Agent 进程已退出 (code: ${code}, signal: ${signal})`)
          if (this.status === 'connected' || this.status === 'connecting') {
            void this.disconnect('Agent 进程异常终止')
          }
        },
      })
      this.processHandle = processHandle

      // 6. 建立 SDK 桥接
      const handlerDeps: AcpClientHandlerDeps = {
        getWorkspaceRoot: () => this.workspaceRoot,
        terminals: this.terminals,
        readSnapshot: async (resource) => {
          if (!this.callbacks.readSnapshot) {
            throw new Error(`当前宿主未实现 readSnapshot 回调: ${resource}`)
          }
          return this.callbacks.readSnapshot(resource)
        },
        onPermission: async (payload) => {
          if (this.callbacks.onPermissionRequest) {
            return this.callbacks.onPermissionRequest({
              sessionId: payload.sessionId,
              toolCall: (payload.params as any)?.toolCall,
              params: payload.params,
            })
          }
          // 默认保守：未提供审批回调时不静默同意，安全返回取消
          return { outcome: 'cancelled' }
        },
        onSessionUpdate: (params) => {
          this.callbacks.onSessionUpdate?.(params)
        },
      }

      const { app, connection, streamHandle } = connectSdkClient(
        processHandle.child,
        (clientApp) => {
          registerAcpClientHandlers(clientApp, handlerDeps)
        },
        this.runtimeInfo.id,
      )

      this.sdkApp = app
      this.sdkConnection = connection
      this.streamHandle = streamHandle

      // 7. initialize 握手
      const initResp = await sdkRequest<InitializeResponse, unknown>(
        connection.agent,
        methods.agent.initialize,
        {
          protocolVersion: 1,
          clientInfo: this.clientInfo,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
            session: {
              configOptions: { boolean: {} },
            },
          },
        },
      )

      this.initResponse = initResp
      this.setStatus('connected')
      return ok({ status: 'connected', init: initResp })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.setStatus('error', message)
      await this.disconnect(message)
      return err({ code: 'ACP_PROTOCOL_ERROR', message })
    }
  }

  /** 创建或恢复会话 */
  async createSession(options?: {
    resumeSessionId?: string | null
    mcpServers?: unknown[]
  }): Promise<Result<AcpSessionHandle, AppError>> {
    if (!this.sdkConnection?.agent) {
      return err({ code: 'ACP_NOT_CONNECTED', message: '尚未连接到 Agent 服务端' })
    }

    const agent = this.sdkConnection.agent
    const init = this.initResponse

    const resumeSupported = Boolean(
      init && parseResumeSessionSupported(init.agentCapabilities as any),
    )
    const loadSupported = Boolean(
      init && parseLoadSessionSupported(init.agentCapabilities as any),
    )

    try {
      const openResult = await restoreOrCreateAcpSession({
        request: async (method, params) => {
          return sdkRequest(agent, method, params)
        },
        cwd: this.workspaceRoot,
        resumeSessionId: options?.resumeSessionId ?? null,
        resumeSupported,
        loadSupported,
        mcpServers: options?.mcpServers ?? [],
        log: (level, msg, meta) => {
          this.callbacks.onLog?.(level, msg, meta)
        },
      })

      const handle = new AcpSessionHandle(
        openResult.sessionId,
        this,
        openResult.restoreMethod,
        openResult.configOptions,
      )

      return ok(handle)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return err({ code: 'ACP_PROTOCOL_ERROR', message })
    }
  }

  /** 向指定会话发送消息 */
  async promptSession(
    sessionId: string,
    promptText: string,
    options?: { timeoutMs?: number },
  ): Promise<Result<unknown, AppError>> {
    if (!this.sdkConnection?.agent) {
      return err({ code: 'ACP_NOT_CONNECTED', message: '尚未连接到 Agent 服务端' })
    }

    try {
      const response = await sdkRequest(
        this.sdkConnection.agent,
        methods.agent.session.prompt,
        {
          sessionId,
          prompt: [{ type: 'text', text: promptText }],
        },
        options?.timeoutMs,
      )
      return ok(response)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return err({ code: 'ACP_PROTOCOL_ERROR', message })
    }
  }

  /** 动态更新会话配置项（如模型 ID） */
  async setSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<Result<unknown, AppError>> {
    if (!this.sdkConnection?.agent) {
      return err({ code: 'ACP_NOT_CONNECTED', message: '尚未连接到 Agent 服务端' })
    }

    try {
      const response = await sdkRequest(this.sdkConnection.agent, methods.agent.session.setConfigOption, {
        sessionId,
        configId,
        value,
      })
      return ok(response)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return err({ code: 'ACP_PROTOCOL_ERROR', message })
    }
  }

  /** 断开连接并清理资源 */
  async disconnect(reason?: string): Promise<void> {
    this.setStatus('disconnected', reason)
    try {
      this.streamHandle?.dispose()
      this.sdkConnection?.close()
    } catch {
      // 忽略关闭异常
    } finally {
      this.sdkConnection = null
      this.streamHandle = null
      this.sdkApp = null
      this.initResponse = null
    }

    if (this.processHandle && isSpawnedAcpProcessAlive(this.processHandle)) {
      try {
        this.processHandle.kill()
      } catch {
        // 忽略杀死进程异常
      }
      this.processHandle = null
    }
  }

  private setStatus(status: AcpConnectionStatus, detail?: string): void {
    this.status = status
    this.callbacks.onStatusChange?.(status, detail)
  }
}
