import { app } from 'electron'
import {
  APP_TITLE,
  findBuiltinAcpRuntime,
} from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import type {
  AcpConnectResult,
} from '@montree/contracts'
import type {
  AcpRuntimeInfo,
} from '@montree/contracts'
import {
  methods,
  type InitializeResponse,
} from '@agentclientprotocol/sdk'
import { getAcpRuntime } from "@yitom/acp-client"
import { resolveAgentCwd } from './agent-sandbox-cwd'
import { parseAcpConfigOptions } from "@yitom/acp-client"
import { registerAcpClientHandlers } from './client-handlers'
import { buildAcpProxySpawnEnv, readAcpProxySettings } from './acp-proxy-service'
import { runConnectAuthGate } from "@yitom/acp-client"
import {
  parseLoadSessionSupported,
  parseMcpHttpSupported,
  parsePromptCapabilities,
  parseResumeSessionSupported,
} from "@yitom/acp-client"
import {
  startMontreeMcpServer,
  stopMontreeMcpServer,
} from './mcp/montree-mcp-server'
import { restoreOrCreateAcpSession } from './session-open'
import { connectSdkClient, sdkRequest } from './sdk-client'
import { getLiveAcpProcess, getAcpEarlyExitStderrDetail, isSpawnedAcpProcessAlive, spawnAcpProcess, withAcpEarlyExitDetail, type SpawnedAcpProcess } from './process-manager'
import { ensureBunForCommand } from '../bun-runtime'
import { buildCursorMissingCliMessage, getCursorCatalogIds } from './runtimes/cursor'
import { acpState, PROTOCOL_VERSION, armSuppressSettle, disarmSuppressSettle, setStatus } from './acp-state'
import {
  emitSessionUpdate,
  handlePermissionRequest,
  handleSnapshotRequest,
  parseAuthMethods,
  requireAgent,
  safeCanSkipInteractiveAuth,
  safeGetAdapter,
  safeOrderAuthMethods,
  safeProbeAuth,
  toProtocolError,
} from './acp-bridges'

/**
 * 多运行时模板解析（防御性）：
 * 约定接口 `findBuiltinAcpRuntime(id) -> { command, args }` 为唯一真相源。
 * 优先走 `@yitom/acp-client` 注册表（其内部同样委托该函数），若其滞后则直读 contracts 回落。
 * 下游 contracts 展开 8 模板前，未知 id 在此直接判错，不触达 spawn。
 */
// TODO(下游 contracts 未就绪): 8 运行时模板
// （codex+claude+gemini+copilot+opencode+cursor-cli+deepseek+agy）落地后，本函数零改动直接生效。
function resolveRuntimeTemplate(runtimeId: string): AcpRuntimeInfo | undefined {
  const normalized = runtimeId?.trim() ?? ''
  if (!normalized) return undefined
  try {
    const viaRegistry = getAcpRuntime(normalized)
    if (viaRegistry?.command) return viaRegistry
  } catch {
    // 注册表滞后时忽略，走 contracts 直读
  }
  try {
    const direct = findBuiltinAcpRuntime(normalized)
    if (direct?.command) return direct
  } catch {
    // contracts 未就绪时返回 undefined，由调用方判错
  }
  return undefined
}

/**
 * 给温进程绑定单次退出监听。每次复用都刷新闭包里的代际，
 * 旧监听先摘掉，保证同时只有一个有效监听。
 */
function watchProcessExit(handle: SpawnedAcpProcess, gen: number): void {
  if (acpState.exitWatch) {
    acpState.exitWatch.handle.child.off('exit', acpState.exitWatch.listener)
    acpState.exitWatch = null
  }
  const listener = () => {
    if (gen !== acpState.connectGeneration) return
    if (
      acpState.status === 'connected' ||
      acpState.status === 'connecting' ||
      acpState.status === 'awaiting_auth'
    ) {
      void disconnectAcp('Agent 进程已退出')
    }
  }
  handle.child.once('exit', listener)
  acpState.exitWatch = { handle, listener }
}

async function openSessionAfterAuth(
  cwd: string,
  options?: { keepAliveOnFailure?: boolean },
): Promise<Result<Extract<AcpConnectResult, { phase: 'ready' }>, AppError>> {
  const a = requireAgent(true)
  if (!a.ok) return err(a.error)
  if (!acpState.runtimeId) {
    return err({ code: 'ACP_NOT_CONNECTED', message: '运行时未知' })
  }

  const resumeId = acpState.pendingResumeSessionId?.trim() || null

  try {
    const opened = await restoreOrCreateAcpSession({
      request: (method, params) => sdkRequest<unknown, unknown>(a.value, method, params),
      cwd,
      resumeSessionId: resumeId,
      resumeSupported: acpState.resumeSessionSupported,
      loadSupported: acpState.loadSessionSupported,
      mcpServers: acpState.montreeMcp
        ? [
            {
              type: 'http',
              name: 'montree',
              url: acpState.montreeMcp.url,
              headers: [{ name: 'Authorization', value: `Bearer ${acpState.montreeMcp.authToken}` }],
            },
          ]
        : [],
      onSuppressUpdates: (suppress) => {
        acpState.suppressSessionUpdates = suppress
      },
    })

    acpState.sessionId = opened.sessionId
    acpState.workspaceRoot = cwd
    acpState.pendingResumeSessionId = null
    // cursor 在 load 响应返回后异步重放历史 updates（落在请求期压制之外）：
    // load 恢复成功即 arm 滑动定居窗口（即使请求期已结束），重放由 emitSessionUpdate 丢弃。
    // 空线程例外：本地无实质消息时仅监视不限流，让回放重建时间线，收尾照常冻结。
    if (opened.restoreMethod === 'load') {
      armSuppressSettle(Date.now(), {
        monitorOnly: acpState.pendingHasLocalHistory === false,
      })
    }
    acpState.pendingHasLocalHistory = null
    setStatus('connected')

    // Cursor 横杠 canonical 目录：成功建会话后附带拉取（`agent models` 同源，超时 6s 上限）。
    // 失败吞掉记 dev 日志，不阻断连接；耗时计入连接，可接受。经 AcpConnectResult.modelCatalog 带回渲染。
    let modelCatalog: string[] | undefined
    try {
      const rid = acpState.runtimeId ?? ''
      if (rid === 'cursor-cli' || rid === 'cursor') {
        const catalog = getCursorCatalogIds()
        if (catalog && catalog.length > 0) modelCatalog = catalog
      }
    } catch (error) {
      console.debug('[acp] cursor model catalog 拉取失败，继续连接', error)
    }

    return ok({
      phase: 'ready',
      runtimeId: acpState.runtimeId,
      sessionId: opened.sessionId,
      protocolVersion: acpState.cachedProtocolVersion,
      agentName: acpState.cachedAgentName,
      agentVersion: acpState.cachedAgentVersion,
      configOptions: parseAcpConfigOptions(opened.configOptions),
      loadSessionSupported: acpState.loadSessionSupported,
      resumeSessionSupported: acpState.resumeSessionSupported,
      promptCapabilities: acpState.cachedPromptCapabilities,
      sessionRestored: opened.sessionRestored,
      restoreMethod: opened.restoreMethod,
      requestedSessionId: opened.requestedSessionId,
      restoreAttempts:
        opened.restoreAttempts.length > 0 ? opened.restoreAttempts : undefined,
      ...(modelCatalog ? { modelCatalog } : {}),
    })
  } catch (error) {
    if (!options?.keepAliveOnFailure) {
      await disconnectAcp()
    }
    return err(toProtocolError(error, '创建或恢复会话失败'))
  }
}

export async function connectAcp(payload: {
  runtimeId: string
  cwd?: string
  resumeSessionId?: string
  /** 渲染端激活线程是否有本地实质消息（空线程例外用，缺省按非空处理） */
  hasLocalHistory?: boolean
}): Promise<Result<AcpConnectResult, AppError>> {
  // spawn 模板一律取自 findBuiltinAcpRuntime（经 resolveRuntimeTemplate），
  // 禁写死 codex bunx；command/args 缺失即判错，不触达 spawn。
  let runtime = resolveRuntimeTemplate(payload.runtimeId)
  if (!runtime || !runtime.command || !Array.isArray(runtime.args)) {
    return err({ code: 'ACP_SPAWN_ERROR', message: `未知运行时: ${payload.runtimeId}` })
  }

  const gen = ++acpState.connectGeneration
  // 新连接开始即 disarm：旧 load 的定居窗口到此结束，后续 updates 均为新连接的真实增量
  disarmSuppressSettle()
  console.info('[acp] connect start', {
    gen,
    runtimeId: payload.runtimeId,
    resumeSessionId: payload.resumeSessionId,
  })

  // 常驻复用：同 runtime 有存活温进程时跳过冷启动（省掉解压 + 导包）。
  // 温进程是否健康由后面的
  // initialize 握手验证；若握手失败，catch 会杀掉毒进程，下次点击走冷启动自愈。
  const warmHandle = getLiveAcpProcess(runtime.id)
  if (warmHandle) {
    // 剥离旧会话状态但保温进程：旧 SDK 连接只关闭，不断 stdio。
    await disconnectAcp()
    acpState.processHandle = warmHandle
  } else {
    await disconnectAcp(undefined, { killProcess: true })
    // 给旧进程/stdio 一点时间收尾，降低连接竞态
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  if (gen !== acpState.connectGeneration) {
    return err({ code: 'ACP_PROTOCOL_ERROR', message: '连接已被更新的请求取代' })
  }

  acpState.runtimeId = runtime.id
  acpState.pendingResumeSessionId = payload.resumeSessionId?.trim() || null
  // 空线程提示直达 openSessionAfterAuth 的 arm 决策（缺省 null = 未知，按非空照常压制）
  acpState.pendingHasLocalHistory =
    typeof payload.hasLocalHistory === 'boolean' ? payload.hasLocalHistory : null
  setStatus('connecting')

  const adapter = safeGetAdapter(runtime.id)

  // 预 spawn 接线：adapter 自报 CLI 未安装（resolveSpawnCommand → null）时
  // 直接回带安装指引的 ACP_SPAWN_ERROR，不触达 spawn。
  // 背景：无 agent.cmd 的用户机上裸 spawn 会让 cmd 报“不是内部或外部命令”，
  // 子进程秒退，UI 只剩一句看不懂的 connection closed。
  // 其余 runtime 抛错仍按缺省处理（防御性回落），不断连接。
  if (adapter.resolveSpawnCommand) {
    let resolved: { command: string; args: string[] } | null | undefined
    try {
      resolved = adapter.resolveSpawnCommand()
    } catch (error) {
      console.warn('[acp] resolveSpawnCommand 异常，沿用模板命令', error)
      resolved = undefined
    }
    if (resolved === null) {
      const message =
        runtime.id === 'cursor-cli' || runtime.id === 'cursor'
          ? buildCursorMissingCliMessage()
          : `Agent CLI 未安装（${runtime.id}）：请先安装对应 CLI 后重试`
      setStatus('error', message)
      return err({ code: 'ACP_SPAWN_ERROR', message })
    }
    if (resolved?.command) {
      runtime = { ...runtime, command: resolved.command, args: resolved.args }
    }
  }

  // 预检判停（缺 key 等，仿 resolveSpawnCommand 的可选 + 缺省兼容做法）：
  // adapter 自报阻断文案（resolveSpawnBlocker → 非空字符串）时直接回带
  // ACP_SPAWN_ERROR，不触达 spawn。抛错按放行处理（防御性回落），不断连接。
  if (adapter.resolveSpawnBlocker) {
    let blocker: string | null | undefined
    try {
      blocker = adapter.resolveSpawnBlocker()
    } catch (error) {
      console.warn('[acp] resolveSpawnBlocker 异常，继续连接', error)
      blocker = undefined
    }
    if (typeof blocker === 'string' && blocker.trim()) {
      setStatus('error', blocker)
      return err({ code: 'ACP_SPAWN_ERROR', message: blocker })
    }
  }

  // 启动前钩子：各 runtime 自理副作用（如凭据桥接同步 refresh_token）。
  // 防御性：下游 adapter 未就绪/抛错时不阻断连接。
  if (adapter.beforeSpawn) {
    try {
      await adapter.beforeSpawn()
    } catch (error) {
      console.warn('[acp] beforeSpawn 异常，继续连接', error)
    }
  }

  const bunCheck = await ensureBunForCommand(runtime.command)
  if (!bunCheck.ok) {
    setStatus('error', bunCheck.error.message)
    return bunCheck
  }
  if (gen !== acpState.connectGeneration) {
    return err({ code: 'ACP_PROTOCOL_ERROR', message: '连接已被更新的请求取代' })
  }

  const { cwd } = resolveAgentCwd(payload.cwd)
  acpState.workspaceRoot = cwd

  // 代理环境变量：优先委托 adapter.getSpawnEnv，未声明/抛错则走通用 acp-proxy
  const proxySettings = await readAcpProxySettings()
  let proxyResult: { env: NodeJS.ProcessEnv; envRemove: string[] }
  try {
    proxyResult = adapter.getSpawnEnv
      ? adapter.getSpawnEnv(proxySettings)
      : buildAcpProxySpawnEnv(proxySettings)
  } catch (error) {
    console.warn('[acp] getSpawnEnv 异常，回落通用代理 env', error)
    proxyResult = buildAcpProxySpawnEnv(proxySettings)
  }

  // 自定义供应商模式（Codex 等）：隔离 CODEX_HOME + 注入 Key；非 codex 走空 env
  let customProviderEnv: NodeJS.ProcessEnv = {}
  if (adapter.getCustomProvider) {
    try {
      const custom = await adapter.getCustomProvider()
      customProviderEnv = custom?.customEnv ?? {}
    } catch (error) {
      console.warn('[acp] getCustomProvider 异常，忽略自定义供应商', error)
    }
  }

  try {
    // 冷启动才做 runtime 级副作用；温进程复用路径跳过，追求毫秒级重连。
    if (!warmHandle && adapter.onColdStart) {
      try {
        await adapter.onColdStart()
      } catch (error) {
        console.warn('[acp] onColdStart 异常，继续冷启动', error)
      }
    }
    if (warmHandle) {
      // 温进程复用：跳过 spawn，直接用原子进程 stdio 建新 SDK 连接并走握手
      acpState.processHandle = warmHandle
      watchProcessExit(warmHandle, gen)
    } else {
    acpState.processHandle = spawnAcpProcess({
      runtime,
      cwd,
      env: {
        ...customProviderEnv,
        ...proxyResult.env,
      },
      envRemove: proxyResult.envRemove,
      onExit: () => {
        if (gen !== acpState.connectGeneration) return
        if (
          acpState.status === 'connected' ||
          acpState.status === 'connecting' ||
          acpState.status === 'awaiting_auth'
        ) {
          void disconnectAcp('Agent 进程已退出')
        }
      },
    })
    }

    if (gen !== acpState.connectGeneration) {
      acpState.processHandle.kill()
      acpState.processHandle = null
      return err({ code: 'ACP_PROTOCOL_ERROR', message: '连接已被更新的请求取代' })
    }

    const child = acpState.processHandle.child
    if (!child.stdout || !child.stdin) {
      acpState.processHandle.kill()
      acpState.processHandle = null
      setStatus('error', '子进程 stdio 不可用')
      return err({ code: 'ACP_SPAWN_ERROR', message: '子进程 stdio 不可用' })
    }

    // SDK 长驻连接：client({ name: 'montree' }).connect()，持有 ClientConnection。
    // 回调经 onRequest/onNotification 注册；stdio 经 toWeb→ndJsonStream 桥接。
    // SDK 调用沿用直迁形态，仅增参 runtimeId 供日志/隔离（sdk-client 签名向后兼容）。
    const created = connectSdkClient(
      child,
      (sdk) => {
        registerAcpClientHandlers(sdk, {
          getWorkspaceRoot: () => acpState.workspaceRoot,
          terminals: acpState.terminalManager,
          readSnapshot: handleSnapshotRequest,
          onPermission: ({ sessionId: permSessionId, params }) =>
            handlePermissionRequest(permSessionId, params),
          onSessionUpdate: (params) => emitSessionUpdate(params),
        })
      },
      runtime.id,
    )
    acpState.sdkApp = created.app
    acpState.sdkConn = created.connection
    acpState.sdkStream = created.streamHandle

    // _meta.parameterizedModelPicker=true（对齐 Zed 1.8.2-pre，根因见 zed-industries/zed#57571）：
    // cursor-agent 依此标记决定模型下发形状——声明后返回朴素模型值 + 独立 fast/thinking 配置项；
    // 不声明则只给爆炸开的 variant 串（改写即 Invalid params）。
    // session.configOptions.boolean 解锁按 boolean 门控下发选项的 Agent
    // （对齐参考实现；未知字段按标准应被其余 Agent 忽略）。
    // _meta 是 ACP 标准扩展点，未知字段应被其余 Agent 忽略（codex 等仅多收一个字段）。
    const initResult = await sdkRequest<InitializeResponse, Record<string, unknown>>(
      acpState.sdkConn.agent,
      methods.agent.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: true,
          session: { configOptions: { boolean: {} } },
          _meta: { parameterizedModelPicker: true },
        },
        clientInfo: {
          name: 'montree',
          title: APP_TITLE,
          version: app.getVersion(),
        },
      },
    )

    const negotiated =
      typeof initResult.protocolVersion === 'number' ? initResult.protocolVersion : PROTOCOL_VERSION
    if (negotiated !== PROTOCOL_VERSION) {
      // 协议对不上：该进程服务不了我们，杀掉避免温复用毒进程
      await disconnectAcp(`协议版本不兼容: Agent=${negotiated}`, { killProcess: true })
      return err({
        code: 'ACP_PROTOCOL_ERROR',
        message: `协议版本不兼容（需要 ${PROTOCOL_VERSION}，得到 ${negotiated}）`,
      })
    }

    acpState.cachedProtocolVersion = negotiated

    const agentInfo = initResult.agentInfo ?? undefined
    acpState.cachedAgentName = typeof agentInfo?.name === 'string' ? agentInfo.name : undefined
    acpState.cachedAgentVersion = typeof agentInfo?.version === 'string' ? agentInfo.version : undefined

    const caps = (initResult.agentCapabilities ?? {}) as unknown as Record<string, unknown>
    acpState.loadSessionSupported = parseLoadSessionSupported(caps)
    acpState.resumeSessionSupported = parseResumeSessionSupported(caps)
    acpState.cachedPromptCapabilities = parsePromptCapabilities(caps)

    // codex 不会主动走 fs/read_text_file，只有 MCP 工具能让它拉到我们的内存数据
    if (parseMcpHttpSupported(caps)) {
      acpState.montreeMcp = await startMontreeMcpServer({ readSnapshot: handleSnapshotRequest })
    } else {
      acpState.montreeMcp = null
      console.warn('[acp-mcp] Agent 未声明 mcpCapabilities.http，Montree 工具不可用')
    }

    // preflight/auth gate 一律走 adapter.probeAuth（防御性回落中性结果）；
    // authMethods 排序走 adapter.orderAuthMethods（可选）。
    let authMethods = parseAuthMethods(initResult.authMethods)
    authMethods = safeOrderAuthMethods(adapter, authMethods)

    const preflight = safeProbeAuth(adapter)
    let openedWithoutAuth: Extract<AcpConnectResult, { phase: 'ready' }> | null = null
    // keychain 化兜底：adapter 未声明 tryDirectSessionFirst 视为 false（防御性读取）。
    let tryDirectSessionFirst = false
    try {
      tryDirectSessionFirst =
        (adapter as { tryDirectSessionFirst?: unknown }).tryDirectSessionFirst === true
    } catch {
      tryDirectSessionFirst = false
    }
    const gate = await runConnectAuthGate(authMethods, preflight, {
      // 本地已有凭据（如 ~/.codex）时，一律优先直接建立会话（session/new）
      preferDirectSession: true,
      tryDirectSessionFirst,
      authenticate: async (methodId) => {
        await sdkRequest<unknown, Record<string, unknown>>(acpState.sdkConn!.agent, methods.agent.authenticate, {
          methodId,
        })
      },
      tryOpenSessionWithoutAuth: async () => {
        const direct = await openSessionAfterAuth(cwd, { keepAliveOnFailure: true })
        if (direct.ok) {
          openedWithoutAuth = direct.value
          return true
        }
        return false
      },
    })

    if (gate.outcome === 'needs_auth') {
      setStatus('awaiting_auth')
      return ok({
        phase: 'needs_auth',
        runtimeId: runtime.id,
        protocolVersion: negotiated,
        agentName: acpState.cachedAgentName,
        agentVersion: acpState.cachedAgentVersion,
        authMethods: gate.methods,
        loadSessionSupported: acpState.loadSessionSupported,
        resumeSessionSupported: acpState.resumeSessionSupported,
        promptCapabilities: acpState.cachedPromptCapabilities,
      })
    }

    if (gate.outcome === 'session_without_auth' && openedWithoutAuth) {
      return ok(openedWithoutAuth)
    }

    return await openSessionAfterAuth(cwd)
  } catch (error) {
    if (gen !== acpState.connectGeneration) {
      return err({ code: 'ACP_PROTOCOL_ERROR', message: '连接已被更新的请求取代' })
    }
    // 连接失败自诊断（去窗口化）：进程已死且连接失败时，一律把 stderr 尾部
    // 拼进失败错误供 UI 显示，替代裸 `ACP connection closed`。
    // dsh 自解析依赖慢退曾因旧 3s 窗口漏归因，故慢退/长会话失败同样带尾；
    // 先快照再 disconnect（disconnect 会杀毒进程并清空句柄），
    // killProcess 路径不受影响。
    const failedHandle = acpState.processHandle
    const earlyDetail = getAcpEarlyExitStderrDetail(failedHandle)
    // 未知异常：进程状态不可信，杀掉避免下次复用毒进程
    await disconnectAcp(undefined, { killProcess: true })
    const protoError = toProtocolError(error, '连接 ACP Agent 失败')
    const messageWithTail = withAcpEarlyExitDetail(protoError.message, earlyDetail)
    const finalError = { ...protoError, message: messageWithTail }
    setStatus('error', finalError.message)
    return err(finalError)
  }
}

export async function authenticateAcp(payload: {
  methodId: string
  force?: boolean
}): Promise<Result<Extract<AcpConnectResult, { phase: 'ready' }>, AppError>> {
  const a = requireAgent(true)
  if (!a.ok) return err(a.error)
  const cwd = resolveAgentCwd(acpState.workspaceRoot).cwd

  const adapter = safeGetAdapter(acpState.runtimeId ?? '')
  // 认证守门员逻辑：官方 ACP 收到 authenticate 请求时无脑拉起系统浏览器；
  // 若本地已持有有效 Token，直接复用已有凭据建立会话，杜绝弹出系统浏览器
  if (safeCanSkipInteractiveAuth(adapter, payload.methodId, payload.force)) {
    console.info('[acp] 认证守门员生效：本地凭据已就绪，跳过交互式 authenticate，直接建立会话')
    return await openSessionAfterAuth(cwd)
  }

  try {
    await sdkRequest<unknown, Record<string, unknown>>(a.value, methods.agent.authenticate, {
      methodId: payload.methodId,
    })
    return await openSessionAfterAuth(cwd)
  } catch (error) {
    return err(toProtocolError(error, '认证失败'))
  }
}

export async function disconnectAcp(
  reason?: string,
  opts?: { killProcess?: boolean },
): Promise<Result<void, AppError>> {
  acpState.terminalManager.releaseAll()

  // SDK 长驻连接关闭：在途请求一并取消（无待决 Map，直返 bridge 结果）
  try {
    acpState.sdkConn?.close()
  } catch {
    // 忽略竞态关闭
  }
  acpState.sdkConn = null
  acpState.sdkApp = null

  // 摘桥接：只吃掉垫层，保住温进程 stdio 给下次复用
  try {
    acpState.sdkStream?.dispose()
  } catch {
    // 忽略竞态关闭
  }
  acpState.sdkStream = null

  if (acpState.processHandle) {
    // 已死句柄一律回收；存活进程默认保温（killProcess=false），下次同 runtime
    // 连接直接复用，省掉冷启动。只有明确可疑或 App 退出时才整树杀掉。
    if (opts?.killProcess || !isSpawnedAcpProcessAlive(acpState.processHandle)) {
      if (acpState.exitWatch?.handle === acpState.processHandle) {
        acpState.processHandle.child.off('exit', acpState.exitWatch.listener)
        acpState.exitWatch = null
      }
      acpState.processHandle.kill()
      acpState.processHandle = null
    }
  }

  await stopMontreeMcpServer()
  acpState.montreeMcp = null
  acpState.tocMcp = null

  acpState.sessionId = null
  acpState.runtimeId = null
  acpState.workspaceRoot = null
  acpState.loadSessionSupported = false
  acpState.resumeSessionSupported = false
  acpState.cachedPromptCapabilities = {}
  acpState.pendingResumeSessionId = null
  acpState.pendingHasLocalHistory = null
  acpState.suppressSessionUpdates = false
  disarmSuppressSettle()
  acpState.cachedAgentName = undefined
  acpState.cachedAgentVersion = undefined
  setStatus('disconnected', reason)
  return ok(undefined)
}
