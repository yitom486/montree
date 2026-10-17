/**
 * 本地管道远端服务客户端（main）：spawn Node 服务进程，长度分帧 stdio，
 * 握手校验（协议版本/Node 下限/期望平台），并行上限，取消，EOF/EPIPE 收尾。
 * 日志只记脱敏字段（连接/方法/耗时/错误码），不记正文与密钥。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import {
  checkHandshakeCompatible,
  checkNodeVersionCompatible,
  createWorkspaceIdGenerator,
  decodeWorkspaceFrames,
  encodeWorkspaceFrame,
  redactWorkspaceLogFields,
  type WorkspaceEventFrame,
  type WorkspaceResponse,
} from '@montree/workspace-core'
import {
  DEFAULT_WORKSPACE_LIMITS,
  WORKSPACE_MIN_NODE_MAJOR,
  WORKSPACE_PROTOCOL_MAJOR,
  WORKSPACE_PROTOCOL_MINOR,
  err,
  ok,
  type AppError,
  type Result,
  type WorkspaceConnectionState,
  type WorkspaceLimits,
  type WorkspaceMethod,
  type WorkspaceServerHandshake,
  type WorkspaceWatchEvent,
} from '@yitom/contracts'

export interface RemotePipeClientOptions {
  nodePath: string
  serverPath: string
  root: string
  session: string
  generation: string
  buildId?: string
  /** 期望远端平台；不一致时拒绝（防 Windows node.exe 冒充 Linux 服务） */
  expectedPlatform?: NodeJS.Platform
  timeoutMs?: number
  limits?: Partial<WorkspaceLimits>
  onWatchEvent?: (event: WorkspaceWatchEvent) => void
  onStateChange?: (state: WorkspaceConnectionState) => void
  /**
   * 自定义子进程启动（B1 WSL：经 wsl.exe 管道启动同一 A2 服务，
   * `serverArgs` 为 `--root/--session/--generation/--build` 参数表）。
   * 缺省直启 `nodePath serverPath ...`（A2 本地管道）。
   */
  spawnChild?: (nodePath: string, serverArgs: string[]) => ChildProcess
}

interface PendingRequest {
  resolve: (response: WorkspaceResponse) => void
  timer: ReturnType<typeof setTimeout>
  method: string
}

function logClient(fields: Record<string, unknown>): void {
  try {
    console.error(`[remote-server-client] ${JSON.stringify(redactWorkspaceLogFields(fields))}`)
  } catch {
    // 日志永不干扰调用
  }
}

export class RemoteServerPipeClient {
  private readonly child: ChildProcess
  private readonly pending = new Map<string, PendingRequest>()
  private readonly watchListeners = new Map<string, (event: WorkspaceWatchEvent) => void>()
  private readonly eventListeners = new Set<(event: WorkspaceWatchEvent) => void>()
  private readonly nextId = createWorkspaceIdGenerator()
  private rest: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  private dead = false
  private state: WorkspaceConnectionState = 'connecting'
  private handshakeValue: WorkspaceServerHandshake | null = null

  private constructor(
    child: ChildProcess,
    private readonly options: RemotePipeClientOptions,
    private readonly limits: WorkspaceLimits,
  ) {
    this.child = child
  }

  /** 启动进程并完成 hello 握手；任一步失败即回收进程并返回错误。 */
  static async launch(options: RemotePipeClientOptions): Promise<Result<RemoteServerPipeClient, AppError>> {
    const limits: WorkspaceLimits = { ...DEFAULT_WORKSPACE_LIMITS, ...options.limits }
    const timeoutMs = options.timeoutMs ?? limits.requestTimeoutMs
    const serverArgs = [
      options.serverPath,
      '--root', options.root,
      '--session', options.session,
      '--generation', options.generation,
      '--build', options.buildId ?? 'dev',
    ]
    const child = options.spawnChild
      ? options.spawnChild(options.nodePath, serverArgs)
      : spawn(options.nodePath, serverArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

    const client = new RemoteServerPipeClient(child, options, limits)
    client.attach()
    const started = Date.now()
    const hello = await client.invokeRaw('hello', {}, timeoutMs)
    if (!hello.ok) {
      client.close()
      return hello
    }
    const handshake = hello.value as WorkspaceServerHandshake
    const compatible = checkHandshakeCompatible(handshake, WORKSPACE_PROTOCOL_MAJOR, WORKSPACE_PROTOCOL_MINOR)
    if (!compatible.ok) {
      logClient({ method: 'hello', durationMs: Date.now() - started, code: compatible.error.code })
      client.close()
      return compatible
    }
    if (!checkNodeVersionCompatible(handshake.nodeVersion, WORKSPACE_MIN_NODE_MAJOR)) {
      logClient({ method: 'hello', durationMs: Date.now() - started, code: 'VERSION_MISMATCH', nodeVersion: handshake.nodeVersion })
      client.close()
      return err({
        code: 'VERSION_MISMATCH',
        message: `远端 Node 版本过低：${handshake.nodeVersion}，要求 Node ${WORKSPACE_MIN_NODE_MAJOR}+（不自动 sudo/下载）`,
      })
    }
    if (options.expectedPlatform && handshake.platform !== options.expectedPlatform) {
      logClient({ method: 'hello', durationMs: Date.now() - started, code: 'CONNECTION_ERROR', platform: handshake.platform })
      client.close()
      return err({
        code: 'CONNECTION_ERROR',
        message: `远端平台不符：期望 ${options.expectedPlatform}，实际 ${handshake.platform}（可能误启动了 Windows node.exe）`,
      })
    }
    client.handshakeValue = handshake
    client.setState('connected')
    logClient({
      method: 'hello',
      durationMs: Date.now() - started,
      code: 'OK',
      protocol: `${handshake.protocolMajor}.${handshake.protocolMinor}`,
      build: handshake.buildId,
      platform: handshake.platform,
      arch: handshake.arch,
      nodeVersion: handshake.nodeVersion,
    })
    return ok(client)
  }

  get handshake(): WorkspaceServerHandshake | null {
    return this.handshakeValue
  }

  get connectionState(): WorkspaceConnectionState {
    return this.state
  }

  get inflight(): number {
    return this.pending.size
  }

  private setState(state: WorkspaceConnectionState): void {
    this.state = state
    try {
      this.options.onStateChange?.(state)
    } catch {
      // 观察者异常不影响连接
    }
  }

  private attach(): void {
    this.child.stdout?.on('data', (chunk: Uint8Array) => this.onStdout(chunk))
    this.child.stderr?.on('data', (chunk: Uint8Array) => {
      const line = Buffer.from(chunk).toString('utf8').trim()
      if (line) console.error(`[remote-server] ${line.slice(0, 2000)}`)
    })
    const onDead = (code: string) => {
      if (this.dead) return
      this.dead = true
      this.setState('disconnected')
      logClient({ code: 'CONNECTION_ERROR', state: code })
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.resolve({
          proto: 'montree-workspace',
          id,
          ok: false,
          error: { code: 'CONNECTION_ERROR', message: '远端服务连接已断开（不回落、不伪装成功）' },
        })
      }
      this.pending.clear()
    }
    this.child.on('exit', () => onDead('exit'))
    this.child.on('error', () => onDead('spawn-error'))
  }

  private onStdout(chunk: Uint8Array): void {
    const combined = new Uint8Array(this.rest.byteLength + chunk.byteLength)
    combined.set(this.rest, 0)
    combined.set(chunk, this.rest.byteLength)
    const decoded = decodeWorkspaceFrames(combined, this.limits.maxFrameBytes)
    if ('kind' in decoded && decoded.kind === 'error') {
      logClient({ code: decoded.error.code, state: 'frame-decode' })
      this.rest = new Uint8Array(0)
      return
    }
    this.rest = decoded.rest
    for (const frame of decoded.frames) {
      if (frame.kind === 'request' || frame.kind === 'invalid') continue
      if (frame.kind === 'event') {
        this.handleFrameEvent(frame.event)
        continue
      }
      const pending = this.pending.get(frame.response.id)
      if (!pending) continue
      this.pending.delete(frame.response.id)
      clearTimeout(pending.timer)
      pending.resolve(frame.response)
    }
  }

  private handleFrameEvent(event: WorkspaceEventFrame): void {
    if (event.session !== this.options.session || event.generation !== this.options.generation) {
      logClient({ code: 'INVALID_STATE', state: 'stale-event' })
      return
    }
    if (event.event !== 'watch') return
    const payload = event.payload as WorkspaceWatchEvent
    try {
      this.options.onWatchEvent?.(payload)
      this.watchListeners.get(payload.subscriptionId)?.(payload)
      for (const listener of this.eventListeners) listener(payload)
    } catch {
      // 观察者异常不影响连接
    }
  }

  private writeFrame(payload: unknown): Result<void, AppError> {
    if (this.dead || !this.child.stdin || this.child.stdin.destroyed) {
      return err({ code: 'CONNECTION_ERROR', message: '远端服务连接已断开' })
    }
    try {
      this.child.stdin.write(Buffer.from(encodeWorkspaceFrame(payload)))
      return ok(undefined)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EPIPE') {
        this.child.kill()
        return err({ code: 'CONNECTION_ERROR', message: '远端服务管道已断开（EPIPE）' })
      }
      return err({ code: 'CONNECTION_ERROR', message: error instanceof Error ? error.message : '写入管道失败' })
    }
  }

  private invokeRaw(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<Result<unknown, AppError>> {
    if (this.dead) {
      return Promise.resolve(err({ code: 'CONNECTION_ERROR', message: '远端服务连接已断开' }))
    }
    if (this.pending.size >= this.limits.maxInflight) {
      return Promise.resolve(err({ code: 'LIMIT_EXCEEDED', message: `并行请求超过上限 ${this.limits.maxInflight}` }))
    }
    const id = this.nextId()
    const started = Date.now()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        logClient({ method, requestId: id, durationMs: Date.now() - started, code: 'CONNECTION_ERROR' })
        // 超时不断开连接；写响应丢失后由调用方核对版本，不盲重放副作用请求
        resolve(err({ code: 'CONNECTION_ERROR', message: `远端请求超时（id=${id}，写操作请先核对版本）` }))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        timer,
        resolve: (response) => {
          logClient({ method, requestId: id, durationMs: Date.now() - started, code: response.ok ? 'OK' : response.error.code })
          if (!response.ok) resolve(err(response.error));
          else resolve(ok(response.value));
        },
      })
      const written = this.writeFrame({
        proto: 'montree-workspace',
        id,
        method,
        session: this.options.session,
        generation: this.options.generation,
        params,
      })
      if (!written.ok) {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(written)
      }
    })
  }

  /** 执行一次 workspace 协议调用；失败一律 Result 错误，不抛异常。 */
  invoke(method: WorkspaceMethod, params?: Record<string, unknown>, timeoutMs?: number): Promise<Result<unknown, AppError>> {
    return this.invokeRaw(method, params ?? {}, timeoutMs ?? this.options.timeoutMs ?? this.limits.requestTimeoutMs)
  }

  /** 发送取消（尽力而为；search/Git 等支持中断，其余以完成态为准）。 */
  cancel(id: string): void {
    this.writeFrame({
      proto: 'montree-workspace',
      id: this.nextId(),
      method: 'cancel',
      session: this.options.session,
      generation: this.options.generation,
      params: { id },
    })
  }

  onSubscription(subscriptionId: string, listener: (event: WorkspaceWatchEvent) => void): () => void {
    this.watchListeners.set(subscriptionId, listener)
    return () => {
      if (this.watchListeners.get(subscriptionId) === listener) this.watchListeners.delete(subscriptionId)
    }
  }

  /**
   * P1 远端宿主传输适配：订阅全部 watch 事件（不限 subscriptionId）。
   * 由 RemoteWorkspaceHost 构造时注册，按传输代际过滤后分发。
   */
  onEvent(listener: (event: WorkspaceWatchEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  close(): void {
    if (this.dead) return
    this.dead = true
    this.setState('disconnected')
    try {
      this.child.kill('SIGTERM')
      setTimeout(() => {
        try {
          if (!this.child.killed) this.child.kill('SIGKILL')
        } catch {
          // 已退出则忽略
        }
      }, 2000).unref?.()
    } catch {
      // 杀进程失败只记录，不抛异常
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({
        proto: 'montree-workspace',
        id,
        ok: false,
        error: { code: 'CANCELLED', message: '连接已关闭' },
      })
    }
    this.pending.clear()
  }
}
