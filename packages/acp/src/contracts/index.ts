/**
 * @yitom/acp-client 核心契约与数据类型
 *
 * 自包含的跨平台 ACP 规范定义，零外部私有包依赖。
 */

// ── 错误与 Result 结果集 ──

export type AppErrorCode =
  | 'CANCELLED'
  | 'API_UNAVAILABLE'
  | 'FILE_READ_ERROR'
  | 'FILE_WRITE_ERROR'
  | 'FILE_NOT_FOUND'
  | 'WORKSPACE_SCAN_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'ACP_SPAWN_ERROR'
  | 'ACP_PROTOCOL_ERROR'
  | 'ACP_NOT_CONNECTED'
  | 'ACP_TIMEOUT'
  | 'BUN_NOT_INSTALLED'
  | 'OCR_TOC_EMPTY'
  | 'OCR_PAGE_EMPTY'
  | 'OCR_FAILED'
  | 'INVALID_ARGUMENT'
  | 'INVALID_STATE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'SYNC_ERROR'
  | 'UNKNOWN'

export interface AppError {
  code: AppErrorCode
  message: string
}

export function isCancelled(error: AppError): boolean {
  return error.code === 'CANCELLED'
}

export function isAppError(value: unknown): value is AppError {
  return (
    value !== null &&
    typeof value === 'object' &&
    'code' in value &&
    'message' in value &&
    typeof (value as AppError).message === 'string'
  )
}

export function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as AppError
  }

  const message = error instanceof Error ? error.message : fallbackMessage
  const code: AppErrorCode =
    error instanceof Error && 'code' in error && (error as unknown as { code: string }).code === 'ENOENT'
      ? 'FILE_NOT_FOUND'
      : 'UNKNOWN'

  return { code, message }
}

export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok
}

// ── ACP 连接与运行时状态 ──

export type AcpConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'awaiting_auth'
  | 'connected'
  | 'error'

export interface AcpRuntimeInfo {
  id: string
  name: string
  description: string
  command: string
  args: string[]
  requiredEnvKeys: string[]
  authHint?: string
}

export interface AcpConnectPayload {
  runtimeId: string
  cwd?: string
  resumeSessionId?: string
  hasLocalHistory?: boolean
}

export const INKDOWN_SETTLE_COMPLETE_KIND = 'inkdown_settle_complete'

export interface AcpAuthMethod {
  id: string
  name?: string
  description?: string
  type?: string
}

export type AcpSessionRestoreMethod = 'resume' | 'load' | 'new'

export interface AcpSessionRestoreAttempt {
  method: 'resume' | 'load'
  ok: boolean
  tries: number
  error?: string
}

export interface AcpPromptCapabilities {
  image?: boolean
  audio?: boolean
  embeddedContext?: boolean
}

export type AcpContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'resource_link'
      uri: string
      name: string
      mimeType?: string
      size?: number
    }
  | {
      type: 'image'
      data: string
      mimeType: string
      uri?: string
    }

export interface AcpConnectReadyResult {
  phase: 'ready'
  runtimeId: string
  sessionId: string
  protocolVersion: number
  agentName?: string
  agentVersion?: string
  configOptions?: AcpConfigOption[]
  loadSessionSupported?: boolean
  resumeSessionSupported?: boolean
  promptCapabilities?: AcpPromptCapabilities
  sessionRestored?: boolean
  restoreMethod?: AcpSessionRestoreMethod
  requestedSessionId?: string
  restoreAttempts?: AcpSessionRestoreAttempt[]
  modelCatalog?: string[]
}

export interface AcpConnectNeedsAuthResult {
  phase: 'needs_auth'
  runtimeId: string
  protocolVersion: number
  agentName?: string
  agentVersion?: string
  authMethods: AcpAuthMethod[]
  loadSessionSupported?: boolean
  resumeSessionSupported?: boolean
  promptCapabilities?: AcpPromptCapabilities
}

export type AcpConnectResult = AcpConnectReadyResult | AcpConnectNeedsAuthResult

export interface AcpAuthenticatePayload {
  methodId: string
}

export interface AcpLoadSessionPayload {
  sessionId: string
  cwd?: string
  secondary?: boolean
}

export interface AcpConfigOptionValue {
  value: string
  name: string
  description?: string
}

export interface AcpConfigOption {
  configId: string
  name: string
  description?: string
  category?: string
  type: 'select' | 'boolean' | string
  currentValue?: string | boolean | number
  options?: AcpConfigOptionValue[]
}

export interface AcpSetConfigOptionPayload {
  sessionId: string
  configId: string
  value: string | boolean | number
}

export interface AcpSetConfigOptionResult {
  configOptions: AcpConfigOption[]
}

export interface AcpSessionNewPayload {
  cwd?: string
  toolScope?: 'full' | 'toc'
}

export interface AcpSessionNewResult {
  sessionId: string
  configOptions?: AcpConfigOption[]
}

export interface AcpPromptPayload {
  sessionId: string
  prompt: AcpContentBlock[]
}

export interface AcpPromptResult {
  stopReason: string
}

export interface AcpCancelPayload {
  sessionId: string
}

export type AcpToolCallStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | string

export type AcpToolCallKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'other'
  | string

export interface AcpSessionUpdateEvent {
  sessionId: string
  update: Record<string, unknown>
}

export interface AcpStatusChangedEvent {
  status: AcpConnectionStatus
  runtimeId?: string
  sessionId?: string | null
  errorMessage?: string
}

export interface AcpPermissionRequestEvent {
  requestId: number
  sessionId?: string
  toolCall?: Record<string, unknown>
  options?: unknown[]
  rawParams: Record<string, unknown>
  summary?: string
}

export type AcpPermissionOutcome =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' }

export interface AcpPermissionResponsePayload {
  requestId: number
  outcome: AcpPermissionOutcome
}

export interface InkdownSnapshotArgs {
  path?: string
  range?: [number, number]
  query?: string
  limit?: number
  flatIndex?: number
  title?: string
  note?: string
  excerpt?: string
  kind?: 'highlight' | 'note' | 'auto'
  filter?: 'all' | 'highlights' | 'bookmarks'
  chapters?: Array<{
    flatIndex: number
    title: string
    reason: string
  }>
  marks?: Array<{
    excerpt: string
    note?: string
    flatIndex?: number
    kind?: 'highlight' | 'note' | 'auto'
  }>
  op?: string
  fingerprint?: string
  entries?: unknown
  entry?: unknown
  index?: number
  [key: string]: unknown
}

export type InkdownSnapshotResource =
  | InkdownVirtualResource
  | 'search'
  | 'selection'
  | 'chapter'
  | 'marks'
  | 'highlights'
  | 'create-bookmark'
  | 'create-note'
  | 'propose-note'
  | 'propose-mark'
  | 'suggest-chapters'
  | 'toc-draft-read'
  | 'toc-draft-write'
  | 'content-audit'

export interface AcpSnapshotRequestEvent {
  requestId: number
  resource: InkdownSnapshotResource
  args?: InkdownSnapshotArgs
}

export type AcpSnapshotResponsePayload =
  | { requestId: number; ok: true; content: string }
  | { requestId: number; ok: false; message: string }

export const INKDOWN_VIRTUAL_DIR = '.inkdown/agent'

export const INKDOWN_VIRTUAL_RESOURCES = [
  'focused.json',
  'toc.json',
  'chapter.txt',
  'viewport.txt',
] as const

export type InkdownVirtualResource = (typeof INKDOWN_VIRTUAL_RESOURCES)[number]

function toPosix(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '')
}

function stripWorkspacePrefix(path: string, workspaceRoot: string): string {
  const root = toPosix(workspaceRoot)
  if (!root) return path
  if (path === root) return ''
  if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return path.slice(root.length + 1)
  }
  return path
}

function isVirtualResource(value: string): value is InkdownVirtualResource {
  return (INKDOWN_VIRTUAL_RESOURCES as readonly string[]).includes(value)
}

export function parseInkdownVirtualPath(
  filePath: string,
  workspaceRoot: string,
): InkdownVirtualResource | null {
  const relative = stripWorkspacePrefix(toPosix(filePath.trim()), workspaceRoot).replace(
    /^\.\//,
    '',
  )
  if (!relative.startsWith(`${INKDOWN_VIRTUAL_DIR}/`)) return null

  const resource = relative.slice(INKDOWN_VIRTUAL_DIR.length + 1)
  return isVirtualResource(resource) ? resource : null
}

export function isInkdownVirtualDirPath(filePath: string, workspaceRoot: string): boolean {
  const relative = stripWorkspacePrefix(toPosix(filePath.trim()), workspaceRoot).replace(
    /^\.\//,
    '',
  )
  return relative === INKDOWN_VIRTUAL_DIR || relative.startsWith(`${INKDOWN_VIRTUAL_DIR}/`)
}

export interface AcpAuthPreflightResult {
  codexHome: string
  hasCodexHome: boolean
  hasAuthFile: boolean
  hasApiKeyEnv: boolean
  looksLoggedIn: boolean
}

export interface AcpAuthPreflightPayload {
  runtimeId?: string
}

export type CodexAuthPreflight = AcpAuthPreflightResult

export interface AcpProviderConfig {
  name?: string
  baseUrl: string
  model: string
  wireApi: 'chat' | 'responses'
}

export interface AcpProviderSavePayload extends AcpProviderConfig {
  apiKey: string
}

export interface AcpProviderStatus {
  configured: boolean
  name?: string
  baseUrl?: string
  model?: string
  wireApi?: 'chat' | 'responses'
  hasApiKey: boolean
}

export interface AcpProxySettings {
  enabled: boolean
  host: string
  port: number
}

// ── 运行时适配器常量与包名 ──

export const CODEX_ACP_NPM_PACKAGE = '@agentclientprotocol/codex-acp' as const
export const CLAUDE_ACP_NPM_PACKAGE = '@agentclientprotocol/claude-agent-acp' as const
export const DEEPSEEK_DSH_NPM_PACKAGE = '@deepseek-ai/dsh' as const
export const AGY_ACP_NPM_PACKAGE = '@yitom/agy-acp-map' as const
export const LEGACY_ZED_CODEX_ACP_NPM_PACKAGE = '@zed-industries/codex-acp' as const
export const DEFAULT_ACP_RUNTIME_ID = 'codex-acp'

function isWindowsPlatform(): boolean {
  const proc = (globalThis as { process?: { platform?: string } }).process
  return proc?.platform === 'win32'
}

export const BUILTIN_ACP_RUNTIMES: readonly AcpRuntimeInfo[] = [
  {
    id: 'codex-acp',
    name: 'ChatGPT',
    description:
      '通过 bunx 启动官方 @agentclientprotocol/codex-acp；可复用本机 ~/.codex（ChatGPT / API Key）',
    authHint:
      '复用本机 ~/.codex 登录（auth.json 或 OPENAI_API_KEY / CODEX_API_KEY）；未登录按下方 Agent 认证方式完成登录',
    command: 'bunx',
    args: ['-y', `${CODEX_ACP_NPM_PACKAGE}@latest`],
    requiredEnvKeys: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  },
  {
    id: 'claude',
    name: 'Claude',
    description:
      '通过 bunx 启动官方 @agentclientprotocol/claude-agent-acp；可复用本机 Claude Code 登录态（~/.claude.json）或 ANTHROPIC_API_KEY',
    authHint:
      '复用本机 Claude Code 登录（~/.claude.json / ~/.claude/.credentials.json 或 ANTHROPIC_API_KEY）；未登录先跑 claude login',
    command: 'bunx',
    args: ['-y', `${CLAUDE_ACP_NPM_PACKAGE}@latest`],
    requiredEnvKeys: ['ANTHROPIC_API_KEY'],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: '启动本机 Gemini CLI（--acp）；复用 Gemini CLI 登录态（~/.gemini/）',
    authHint:
      '复用本机 Gemini CLI 登录（~/.gemini/oauth_creds.json 或 GEMINI_API_KEY / GOOGLE_API_KEY）；未登录先在本机终端跑 gemini 完成登录',
    command: isWindowsPlatform() ? 'gemini.cmd' : 'gemini',
    args: ['--acp'],
    requiredEnvKeys: [],
  },
  {
    id: 'copilot',
    name: 'Copilot',
    description: '启动本机 Copilot CLI（--acp --stdio）；复用 Copilot CLI 的 GitHub 登录态',
    authHint:
      '复用本机 Copilot CLI 的 GitHub 登录（~/.copilot/config.json 或 COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN）；未登录先跑 copilot login',
    command: isWindowsPlatform() ? 'copilot.cmd' : 'copilot',
    args: ['--acp', '--stdio'],
    requiredEnvKeys: [],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description:
      '启动本机 opencode（acp）；复用 `opencode auth login` 写入 auth.json（~/.local/share/opencode/auth.json）的各 provider 凭证',
    authHint:
      '已登录（%LOCALAPPDATA%\\opencode\\auth.json 或 ~/.local/share/opencode/auth.json）则直接连接；否则先跑 opencode auth login',
    command: isWindowsPlatform() ? 'opencode.exe' : 'opencode',
    args: ['acp'],
    requiredEnvKeys: [],
  },
  {
    id: 'cursor-cli',
    name: 'Cursor',
    description:
      '启动 Cursor 官方 CLI（agent acp）；复用本机 Cursor 登录态（未登录可运行 `agent login`）。安装路径探测（%LOCALAPPDATA%\\cursor-agent / ~/.local/bin/agent）见主进程 cursor 适配器',
    authHint:
      '复用本机 Cursor 登录态（或 CURSOR_API_KEY / CURSOR_AUTH_TOKEN）；未登录先跑 agent login',
    command: isWindowsPlatform() ? 'agent.cmd' : 'agent',
    args: ['acp'],
    requiredEnvKeys: [],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description:
      '通过 bunx 启动 @deepseek-ai/dsh（--profile acp）；无 ACP 登录，靠 harness 自身凭证（DEEPSEEK_API_KEY / harness 配置）；模型经 session 到达，无需额外动作',
    authHint:
      '无 ACP 登录，靠 harness 自身凭证（DEEPSEEK_API_KEY / harness 配置）；未配置先导出 DEEPSEEK_API_KEY；模型经 session 到达，无需额外动作；若官方最新 dsh 存在坏依赖（如 rc.3 缺失），可设 DSH_PACKAGE pin 旧版',
    command: 'bunx',
    args: ['-y', `${DEEPSEEK_DSH_NPM_PACKAGE}@latest`, '--profile', 'acp'],
    requiredEnvKeys: ['DEEPSEEK_API_KEY'],
  },
  {
    id: 'agy',
    name: 'agy',
    description:
      '经 bunx 直调官方桥 JS 入口（免安装，跨平台；版本跟随 bunx 解析）',
    authHint: '复用 Antigravity CLI 本地登录态；未登录先在本机终端完成 agy 登录后再连接',
    command: 'bunx',
    args: ['-y', `${AGY_ACP_NPM_PACKAGE}@latest`],
    requiredEnvKeys: [],
  },
] as const

export function findBuiltinAcpRuntime(id: string): AcpRuntimeInfo | undefined {
  return BUILTIN_ACP_RUNTIMES.find((item) => item.id === id)
}
