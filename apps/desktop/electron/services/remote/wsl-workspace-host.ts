import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import {
  err,
  ok,
  type AppError,
  type RemoteBrowseResult,
  type RemoteServerConnectionInfo,
  type Result,
  type WorkspaceConnectionState,
  type WorkspaceListDirectoryResult,
  type WorkspaceMethod,
  type WorkspaceServerManifest,
  type WorkspaceStatResult,
} from '@montree/contracts'
import type { RemoteWorkspaceTransport } from '../remote-workspace-host'
import { RemoteServerPipeClient } from './remote-server-client'
import {
  resolveRemoteServerBundlePath,
  resolveRemoteServerManifestPath,
} from './remote-server-paths'
import {
  checkProbeNodeUsable,
  formatNodeMissingHelp,
  installRemoteServerViaPipe,
  planWslConnection,
  type WslConnectPlan,
  type WslRunner,
} from './wsl-bootstrap'
import { getLinuxParentPath } from './remote-service'

/**
 * WSL 工作区宿主（B1）：复用 A2 服务栈（`@montree/remote-server`
 * bundle + `RemoteServerPipeClient`），传输启动器换成 wsl.exe 管道。
 *
 * - Remote 模式浏览/stat 在 Ubuntu 服务内原生执行；Windows 不用
 *   UNC/9P 访问该工作区（UNC 旧入口见 remote-service.ts 兼容边界）。
 * - 安装经管道 temp→校验→原子启用，目标目录从远端 home 动态得出、
 *   按 buildId 存放；启动清理 banner、探测登录 shell、拒绝 Windows node。
 * - 连接/窗口租约管理服务：断开清理本连接进程，不全局 pkill。
 * - 代际隔离：每次 connect/disconnect 递增，旧响应不覆盖新状态。
 * - 未连接/断线/版本不兼容/远端 Node 缺失一律明确错误；禁静默回落。
 */

export interface WslWorkspaceHostDeps {
  runner?: WslRunner
  spawnFn?: (command: string, args: string[]) => ChildProcess
  /**
   * 本地服务产物覆盖（单测/验收注入；缺省走正统
   * remote-server-paths 的 resources/remote-server 定位 + 校验）。
   */
  serverAssets?: { bundlePath: string; manifestPath: string }
  readAssetBytes?: (filePath: string) => Buffer
  /** 期望远端平台（缺省 linux；loopback 单测可覆写为本机平台） */
  expectedPlatform?: NodeJS.Platform
  /**
   * 连接规划覆盖（单测注入；缺省用 planWslConnection 做发行版 + root
   * 选择与远端探测，loopback 用本地根时注入假规划）。
   */
  planConnection?: (
    distro: string,
    linuxRoot: string | undefined,
    runner?: WslRunner,
  ) => Promise<{ ok: true; plan: WslConnectPlan } | { ok: false; code: string; message: string }>
  onLog?: (line: string) => void
}

/** 远端绝对路径判定：POSIX 绝对；loopback 另允许本机盘符根。 */
function isRemoteAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:\//.test(p)
}

/** 远端绝对路径 → 工作区相对 POSIX（协议只传相对路径，见 root-guard）。 */
export function toWorkspaceRelative(
  linuxRoot: string,
  target: string,
): { ok: true; rel: string } | { ok: false; error: AppError } {
  const root = linuxRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  const abs = target.trim().replace(/\\/g, '/')
  // WSL 产品路径为 POSIX 绝对；loopback 单测允许本机盘符根（服务端仍做真实路径约束）
  if (!isRemoteAbsolute(abs)) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: '远端路径须为 Ubuntu 内绝对路径' } }
  }
  const rel = posix.relative(root, abs.replace(/\/+$/, '') || '/')
  if (rel === '..' || rel.startsWith('../')) {
    return { ok: false, error: { code: 'FORBIDDEN', message: '路径超出工作区根范围' } }
  }
  return { ok: true, rel: rel === '' ? '' : rel }
}

function sha256hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export class WslWorkspaceHost {
  private generation = 0
  private distro: string | null = null
  private linuxRoot: string | null = null
  private connectionId: string | null = null
  private session: string | null = null
  /** 启动远端服务时的会话代际（server 事件 generation 回显即此值，远端宿主据此过滤）。 */
  private sessionGeneration: string | null = null
  private client: RemoteServerPipeClient | null = null
  private state: WorkspaceConnectionState = 'disconnected'
  private lastError: { code: string; message: string } | null = null
  private readonly deps: WslWorkspaceHostDeps

  constructor(deps: WslWorkspaceHostDeps = {}) {
    this.deps = deps
  }

  private log(message: string): void {
    this.deps.onLog?.(`[wsl-host] ${message}`)
  }

  /** 是否已连接指定发行版（旧 UNC 入口的兼容边界检查）。 */
  isConnectedTo(distro: string): boolean {
    return this.state === 'connected' && this.client !== null && this.distro === distro
  }

  /** 当前连接根（未连接返回 null；调用方不得据此拼 UNC，只做同根复用判定）。 */
  connectedRoot(): string | null {
    return this.state === 'connected' ? this.linuxRoot : null
  }

  /** 启动会话代际（远端宿主构造用；未连接返回 null）。 */
  getSessionGeneration(): string | null {
    return this.state === 'connected' && this.client ? this.sessionGeneration : null
  }

  /**
   * P1/P2 生产接线：把本连接的管道客户端适配为远端宿主传输。
   * 未连接返回 null（调用方报 REMOTE_NOT_CONNECTED，不回落）。
   * 所有权随适配转移语义由调用方管理：会话释放时由会话表关闭传输，
   * 窗口注册表不再持有已转移的连接（见 register-handlers）。
   */
  getTransport(): RemoteWorkspaceTransport | null {
    const client = this.client
    if (this.state !== 'connected' || !client) return null
    return {
      invoke: async <T,>(
        method: string,
        params: Record<string, unknown>,
        timeoutMs?: number,
      ): Promise<{ ok: true; result: T } | { ok: false; code: string; message: string }> => {
        const res = await client.invoke(method as WorkspaceMethod, params, timeoutMs)
        if (res.ok) return { ok: true as const, result: res.value as T }
        return { ok: false as const, code: res.error.code, message: res.error.message }
      },
      onEvent: (listener) => client.onEvent(listener),
      isConnected: () => this.client === client && this.state === 'connected',
    }
  }

  status(): RemoteServerConnectionInfo | null {
    if (!this.connectionId || !this.linuxRoot) return null
    return {
      connectionId: this.connectionId,
      root: this.linuxRoot,
      state: this.client ? this.client.connectionState : this.state,
      generation: `gen-${this.generation}`,
      handshake: this.client?.handshake ?? null,
      ...(this.lastError ? { errorCode: this.lastError.code, errorMessage: this.lastError.message } : {}),
    }
  }

  private fail(code: string, message: string): { code: string; message: string } {
    this.state = 'error'
    this.lastError = { code, message }
    this.log(`error code=${code} message=${message.slice(0, 200)}`)
    return this.lastError
  }

  /** 建连：探测→校验 Node→定位产物→管道安装→经 wsl.exe 启动→A2 握手。 */
  async connect(distro: string, linuxRoot?: string): Promise<Result<RemoteServerConnectionInfo, AppError>> {
    const gen = ++this.generation
    this.disposeClient()
    this.state = 'connecting'
    this.lastError = null
    this.distro = distro
    this.linuxRoot = null
    this.connectionId = `wsl:${distro}:${gen}`
    this.log(`connect distro=${distro} root=${linuxRoot ?? '(home)'} id=${this.connectionId}`)

    const planFn = this.deps.planConnection ?? planWslConnection
    const plan = await planFn(distro, linuxRoot, this.deps.runner)
    if (gen !== this.generation) return err({ code: 'REMOTE_NOT_CONNECTED', message: '连接已被新请求取代' })
    if (!plan.ok) {
      const e = this.fail(plan.code, plan.message)
      return err({ code: e.code as AppError['code'], message: e.message })
    }

    const nodeCheck = checkProbeNodeUsable(plan.plan.probe)
    if (!nodeCheck.ok) {
      const help = nodeCheck.code === 'REMOTE_NODE_MISSING' ? `\n${formatNodeMissingHelp(distro)}` : ''
      const e = this.fail(nodeCheck.code, `${nodeCheck.message}${help}`)
      return err({ code: e.code as AppError['code'], message: e.message })
    }
    this.log(`probe home=${plan.plan.home} shell=${plan.plan.probe.loginShell} node=${nodeCheck.nodePath}`)

    const assets = await this.loadServerAssets()
    if (gen !== this.generation) return err({ code: 'REMOTE_NOT_CONNECTED', message: '连接已被新请求取代' })
    if (!assets.ok) {
      const e = this.fail(assets.code, assets.message)
      return err({ code: e.code as AppError['code'], message: e.message })
    }

    const installed = await installRemoteServerViaPipe({
      distro,
      home: plan.plan.home,
      buildId: assets.manifest.buildId,
      bundleName: assets.manifest.entry,
      bundleBytes: assets.bundleBytes,
      bundleSha256: sha256hex(assets.bundleBytes),
      manifestName: 'manifest.json',
      manifestBytes: assets.manifestBytes,
      manifestSha256: sha256hex(assets.manifestBytes),
      runner: this.deps.runner,
    })
    if (gen !== this.generation) return err({ code: 'REMOTE_NOT_CONNECTED', message: '连接已被新请求取代' })
    if (!installed.ok) {
      const e = this.fail(installed.code, installed.message)
      return err({ code: e.code as AppError['code'], message: e.message })
    }
    this.log(`installed dir=<home>/.cache/montree/remote-server/${assets.manifest.buildId}`)

    const session = `sess-${randomUUID()}`
    const sessionGen = `gen-${gen}`
    const spawnFn = this.deps.spawnFn ?? ((command: string, args: string[]) =>
      spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }))
    const serverPath = `${installed.installDir}/${assets.manifest.entry}`
    let launched: Awaited<ReturnType<typeof RemoteServerPipeClient.launch>>
    try {
      launched = await RemoteServerPipeClient.launch({
        nodePath: nodeCheck.nodePath,
        serverPath,
        root: plan.plan.linuxRoot,
        session,
        generation: sessionGen,
        buildId: assets.manifest.buildId,
        expectedPlatform: this.deps.expectedPlatform ?? 'linux',
        spawnChild: (nodePath, serverArgs) =>
          spawnFn('wsl.exe', ['-d', distro, '--exec', nodePath, ...serverArgs]),
      })
    } catch (e) {
      const e2 = this.fail('REMOTE_CONNECTION_FAILED', `远端服务启动异常: ${e instanceof Error ? e.message : String(e)}`)
      return err({ code: e2.code as AppError['code'], message: e2.message })
    }
    if (gen !== this.generation) {
      if (launched.ok) launched.value.close()
      return err({ code: 'REMOTE_NOT_CONNECTED', message: '连接已被新请求取代' })
    }
    if (!launched.ok) {
      const e = this.fail(launched.error.code, launched.error.message)
      return err({ code: e.code as AppError['code'], message: e.message })
    }

    this.client = launched.value
    this.linuxRoot = plan.plan.linuxRoot
    this.session = session
    this.sessionGeneration = sessionGen
    this.state = 'connected'
    this.lastError = null
    const info = this.status()
    if (info?.handshake) {
      this.log(
        `handshake ok platform=${info.handshake.platform} arch=${info.handshake.arch} node=${info.handshake.nodeVersion} protocol=${info.handshake.protocolMajor}.${info.handshake.protocolMinor} build=${info.handshake.buildId}`,
      )
    }
    return ok(info ?? {
      connectionId: this.connectionId,
      root: plan.plan.linuxRoot,
      state: 'connected' as const,
      generation: sessionGen,
      handshake: null,
    })
  }

  /** 远端目录浏览（Ubuntu 原生；失败明确报错，不回落 UNC/空树）。 */
  async browseDirectory(dirPath?: string): Promise<Result<RemoteBrowseResult, AppError>> {
    const started = Date.now()
    if (this.state !== 'connected' || !this.client || !this.distro || !this.linuxRoot) {
      const message = 'WSL 远端未连接：请先连接后再浏览（不回落 UNC，不伪装空目录）'
      this.log(`browse 耗时=${Date.now() - started}ms 错误=REMOTE_NOT_CONNECTED`)
      return err({ code: 'REMOTE_NOT_CONNECTED', message })
    }
    const target = (dirPath?.trim().replace(/\\/g, '/') || this.linuxRoot).trim()
    const rel = toWorkspaceRelative(this.linuxRoot, target)
    if (!rel.ok) return err(rel.error)
    const res = await this.client.invoke('listDirectory', { path: rel.rel })
    if (!res.ok) {
      this.log(`browse path=${target} 耗时=${Date.now() - started}ms 错误=${res.error.code}`)
      if (res.error.code === 'CONNECTION_ERROR') this.fail(res.error.code, res.error.message)
      return err(res.error)
    }
    const value = res.value as WorkspaceListDirectoryResult
    if (!value || !Array.isArray(value.entries)) {
      return err({ code: 'PROTOCOL_ERROR', message: '远端浏览返回形状非法' })
    }
    this.log(`browse path=${target} 耗时=${Date.now() - started}ms entries=${value.entries.length}`)
    return ok({
      distro: this.distro,
      currentPath: target,
      parentPath: getLinuxParentPath(target),
      entries: value.entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory, size: e.size, mtimeMs: e.mtimeMs })),
    })
  }

  /** 远端 stat（Ubuntu 原生执行）。 */
  async statPath(filePath: string): Promise<Result<WorkspaceStatResult, AppError>> {
    const started = Date.now()
    if (this.state !== 'connected' || !this.client || !this.linuxRoot) {
      this.log(`stat 耗时=${Date.now() - started}ms 错误=REMOTE_NOT_CONNECTED`)
      return err({ code: 'REMOTE_NOT_CONNECTED', message: 'WSL 远端未连接：请先连接后再查询' })
    }
    const rel = toWorkspaceRelative(this.linuxRoot, filePath)
    if (!rel.ok) return err(rel.error)
    if (!rel.rel) return err({ code: 'INVALID_ARGUMENT', message: 'stat 需要文件路径' })
    const res = await this.client.invoke('stat', { path: rel.rel })
    if (!res.ok) {
      this.log(`stat path=${filePath} 耗时=${Date.now() - started}ms 错误=${res.error.code}`)
      if (res.error.code === 'CONNECTION_ERROR') this.fail(res.error.code, res.error.message)
      return err(res.error)
    }
    this.log(`stat path=${filePath} 耗时=${Date.now() - started}ms`)
    return ok(res.value as WorkspaceStatResult)
  }

  disconnect(): void {
    this.generation++
    this.disposeClient()
    this.state = 'disconnected'
    this.lastError = null
    this.distro = null
    this.linuxRoot = null
    this.connectionId = null
    this.session = null
    this.sessionGeneration = null
    this.log('disconnect')
  }

  private disposeClient(): void {
    // 只清理本连接启动的进程，不全局 pkill
    try {
      this.client?.close()
    } catch {
      // ignore
    }
    this.client = null
  }

  private async loadServerAssets(): Promise<
    | { ok: true; manifest: WorkspaceServerManifest; bundleBytes: Buffer; manifestBytes: Buffer }
    | { ok: false; code: string; message: string }
  > {
    const readBytes = this.deps.readAssetBytes ?? ((p: string) => readFileSync(p))
    let bundlePath: string
    let manifestPath: string
    if (this.deps.serverAssets) {
      bundlePath = this.deps.serverAssets.bundlePath
      manifestPath = this.deps.serverAssets.manifestPath
    } else {
      // 正统定位（开发期仓库资源目录/打包后 resources/remote-server）
      bundlePath = resolveRemoteServerBundlePath()
      manifestPath = resolveRemoteServerManifestPath()
    }
    let bundleBytes: Buffer
    let manifestBytes: Buffer
    try {
      bundleBytes = readBytes(bundlePath)
      manifestBytes = readBytes(manifestPath)
    } catch (e) {
      return {
        ok: false,
        code: 'REMOTE_INSTALL_FAILED',
        message: `远端服务产物缺失：请先运行 bun run build:remote-server（${e instanceof Error ? e.message : String(e)}）`,
      }
    }
    let manifest: WorkspaceServerManifest
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8')) as WorkspaceServerManifest
    } catch {
      return { ok: false, code: 'REMOTE_INSTALL_FAILED', message: '远端服务 manifest 解析失败' }
    }
    const entry = manifest.files.find((f) => f.path === manifest.entry)
    if (!entry) return { ok: false, code: 'REMOTE_INSTALL_FAILED', message: '远端服务 manifest 缺少入口校验项' }
    if (sha256hex(bundleBytes) !== entry.sha256 || bundleBytes.length !== entry.size) {
      return { ok: false, code: 'REMOTE_INSTALL_FAILED', message: '远端服务产物校验失败（可能构建过期或被篡改），请重跑 bun run build:remote-server' }
    }
    return { ok: true, manifest, bundleBytes, manifestBytes }
  }
}

/** 主进程单例（B1 兼容边界与单测入口；生产 IPC 一律走按窗口注册表，不共享）。 */
export const wslWorkspaceHost = new WslWorkspaceHost()

/**
 * P2 按窗口归属的 WSL 连接注册表：一个窗口一个宿主实例，关闭/断开只
 * 影响本窗口。sender 销毁时的清理与会话释放由 register-handlers 负责
 * （本表只做存取，不持有 WebContents）。
 */
const wslHostsByWindow = new Map<number, WslWorkspaceHost>()

/** 取调用窗口的 WSL 宿主（无则按缺省依赖创建；单测可预置带 deps 实例）。 */
export function getWslHostForWindow(webContentsId: number): WslWorkspaceHost {
  let host = wslHostsByWindow.get(webContentsId)
  if (!host) {
    host = new WslWorkspaceHost()
    wslHostsByWindow.set(webContentsId, host)
  }
  return host
}

/** 只读取调用窗口的 WSL 宿主（无则返回 null，不创建；状态/统计类只读入口用）。 */
export function peekWslHostForWindow(webContentsId: number): WslWorkspaceHost | null {
  return wslHostsByWindow.get(webContentsId) ?? null
}

/** 释放调用窗口的 WSL 宿主（只清理本连接进程，不碰其他窗口）。 */
export function disposeWslHostForWindow(webContentsId: number): void {
  const host = wslHostsByWindow.get(webContentsId)
  if (!host) return
  wslHostsByWindow.delete(webContentsId)
  host.disconnect()
}

/**
 * 把已建连宿主从窗口注册表取走（所有权转移给远端会话表时用，
 * 不 disconnect，会话释放时再关闭传输）。
 */
export function takeWslHostForWindow(webContentsId: number): WslWorkspaceHost | null {
  const host = wslHostsByWindow.get(webContentsId) ?? null
  if (host) wslHostsByWindow.delete(webContentsId)
  return host
}

/** 仅测试使用：断开并清空全表。 */
export function resetWslHostRegistryForTest(): void {
  for (const host of wslHostsByWindow.values()) host.disconnect()
  wslHostsByWindow.clear()
}
