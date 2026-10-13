/**
 * 远端工作区协议共享类型（A2）。
 *
 * 注意：B2 分支曾误覆盖本文件，现已按仓内全部引用点重建——
 * `workspace-identity.ts`（WorkspaceKind/WorkspaceDescriptor/DocumentRef/
 * WorkspaceConnectionState）、`workspace-core/protocol.ts`（协议版本/方法/
 * 握手）、`remote-server/methods.ts`（文件/搜索/Git 结果）、`remote-server/
 * watch.ts`（监听事件）、`remote-server/server.ts`（握手 limits/并发）、
 * `electron-api.types.ts`（RemoteServer* 接入载荷）。A2 分支请核对
 * §标“待核对”的默认值与载荷形状；行为以服务端实现为准。
 */

/* ================================================================
 * 工作区身份（A1 共用：workspace-identity.ts 由此取类型）
 * ================================================================ */

/** 工作区宿主种类：本机 / WSL / SSH */
export type WorkspaceKind = 'local' | 'wsl' | 'ssh'

/** 主进程与渲染进程之间的连接状态（显式机，不静默退回） */
export type WorkspaceConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

/**
 * 工作区描述：同一 relativePath 在不同工作区是不同文档。
 * 远端绝对 root 永不进 renderer 拼接（target/rootLabel 仅展示与日志用）。
 */
export interface WorkspaceDescriptor {
  /** 全局唯一：本机固定 `local`，远端形如 `wsl:Ubuntu:/home/u/blog` */
  id: string
  kind: WorkspaceKind
  /** 连接目标：WSL 为发行版，SSH 为配置别名；本机置空 */
  target: string
  /** 根展示标签（本机为绝对根，远端为 Ubuntu 内绝对根，不拼 UNC） */
  rootLabel: string
  displayName?: string
}

/** 工作区内文档身份：workspaceId + 工作区相对 POSIX 路径 */
export interface DocumentRef {
  workspaceId: string
  /** POSIX 相对路径（归一化见 workspace-identity.ts） */
  relativePath: string
}

/* ================================================================
 * 协议版本与方法（workspace-core/protocol.ts 消费）
 * ================================================================ */

/** 远端工作区协议主版本（major 不一致即拒绝连接） */
export const WORKSPACE_PROTOCOL_MAJOR = 1 as const
/** 远端工作区协议次版本（minor 仅向前兼容） */
export const WORKSPACE_PROTOCOL_MINOR = 0 as const
/** 远端服务要求的最低 Node 主版本（B 期明确依赖 Node 22+，不自动 sudo/下载） */
export const WORKSPACE_MIN_NODE_MAJOR = 22 as const

/** A2 服务能力（握手协商；未知能力客户端忽略，服务端保持运行） */
export type WorkspaceCapability = 'fs' | 'watch' | 'search' | 'git' | 'resource'

/**
 * 已知 workspace 协议方法（服务端未知方法可解释失败并保持运行）。
 * 待核对：A2 原始成员集合以服务端分发为准，此处按实现还原。
 */
export type WorkspaceMethod =
  | 'hello'
  | 'ping'
  | 'listDirectory'
  | 'stat'
  | 'readText'
  | 'writeText'
  | 'mkdir'
  | 'createFile'
  | 'rename'
  | 'delete'
  | 'copy'
  | 'move'
  | 'readResource'
  | 'searchMarkdown'
  | 'gitStatus'
  | 'gitDiff'
  | 'gitBranch'
  | 'gitCommit'
  | 'gitPush'
  | 'watch'
  | 'unwatch'
  | 'cancel'

/** 握手成功后的远端服务身份（main 与 server 均记脱敏日志） */
export interface WorkspaceServerHandshake {
  protocolMajor: number
  protocolMinor: number
  buildId: string
  nodeVersion: string
  platform: string
  arch: string
  capabilities: string[]
  limits: WorkspaceLimits
}

/* ================================================================
 * 集中限额（服务端与客户端同一份默认值；B 阶段明确阈值）
 * ================================================================ */

export interface WorkspaceLimits {
  /**
   * 单协议帧上限（字节）。必须大于 maxTextBytes + JSON 开销，
   * 否则满额正文读取的响应帧会被解码端丢弃。
   */
  maxFrameBytes: number
  /** 正文读写上限（字节） */
  maxTextBytes: number
  /** 小型预览资源上限（字节；大文件 range 通道为 E 阶段） */
  maxResourceBytes: number
  /** 检索最多扫描文件数 */
  searchMaxFiles: number
  /** 检索单文件上限（字节，超则跳过该文件） */
  searchMaxFileBytes: number
  /** 检索命中上限 */
  searchMaxHits: number
  /** 服务端并发上限（背压，超限排队） */
  maxConcurrent: number
  /** 客户端最大并行请求数（超限直接 LIMIT_EXCEEDED，不排队） */
  maxInflight: number
  /** 单请求超时（毫秒；push 另取更长） */
  requestTimeoutMs: number
}

/**
 * 默认限额。待核对：search* 沿本机 workspace-md-search 语义
 *（200 文件/256KB/100 命中）；其余为重建时的合理初值，A2 请确认。
 */
export const DEFAULT_WORKSPACE_LIMITS: WorkspaceLimits = {
  maxFrameBytes: 16 * 1024 * 1024,
  maxTextBytes: 8 * 1024 * 1024,
  maxResourceBytes: 5 * 1024 * 1024,
  searchMaxFiles: 200,
  searchMaxFileBytes: 256 * 1024,
  searchMaxHits: 100,
  maxConcurrent: 4,
  maxInflight: 16,
  requestTimeoutMs: 30_000,
}

/* ================================================================
 * 文件/搜索/Git 方法结果（remote-server/methods.ts 构造）
 * ================================================================ */

export interface WorkspaceEntry {
  name: string
  isDirectory: boolean
  size?: number
  mtimeMs?: number
}

export interface WorkspaceListDirectoryResult {
  dirPath: string
  entries: WorkspaceEntry[]
}

export interface WorkspaceStatResult {
  name: string
  isDirectory: boolean
  size: number
  mtimeMs: number
  path: string
  /** 不透明版本 token（`size:mtimeMs:hash`，见 workspace-core/revision） */
  revision: string
}

/** 文本读结果：内容、原始编码/换行信息与 revision（B2 保存携带 expectedRevision） */
export interface WorkspaceReadTextResult {
  content: string
  encoding: 'utf8' | 'utf16le'
  newline: 'lf' | 'crlf'
  hasBom: boolean
  revision: string
}

export interface WorkspaceWriteTextResult {
  revision: string
}

/** 同宿主文件变更返回的相对根 POSIX 路径（与 file.ts 绝对路径版区分命名） */
export interface WorkspaceRelativePathResult {
  path: string
}

/** 小型预览资源字节读取（base64；调用方按 maxResourceBytes 预算使用） */
export interface WorkspaceResourceResult {
  base64: string
  byteLength: number
  truncated: boolean
}

export interface WorkspaceSearchHit {
  /** 相对根的 posix 相对路径（永不绝对路径/盘符） */
  filePath: string
  /** 1-based 行号 */
  lineStart: number
  /** 命中行原文（至多 2000 字） */
  line: string
}

export interface WorkspaceSearchResult {
  /** 精确命中数（文件×行，上限 searchMaxHits） */
  total: number
  hits: WorkspaceSearchHit[]
}

/* ================================================================
 * 原生监听事件（remote-server/watch.ts 产生，400ms 合并）
 * ================================================================ */

export type WorkspaceWatchChangeKind = 'created' | 'modified' | 'deleted'

export interface WorkspaceWatchChange {
  /** 工作区相对 POSIX 路径 */
  path: string
  kind: WorkspaceWatchChangeKind
}

export interface WorkspaceWatchEvent {
  subscriptionId: string
  /** 产生事件时的连接代际；与当前代际不同即过期丢弃 */
  generation: string
  changes: WorkspaceWatchChange[]
}

/* ================================================================
 * 服务接入载荷（remote-server:* IPC，A2 本地管道接入；B1 WSL 复用同一服务）
 * ================================================================ */

/** 远端 bundle manifest（随产物分发，main 启动前校验 buildId/协议版本/sha256） */
export interface WorkspaceServerManifestFile {
  path: string
  sha256: string
  size: number
}

export interface WorkspaceServerManifest {
  name: string
  buildId: string
  protocolMajor: number
  protocolMinor: number
  nodeMin: string
  entry: string
  files: WorkspaceServerManifestFile[]
}

/**
 * 建立远端服务连接。transport 省略即 A2 本地管道（root 为本机绝对路径）；
 * B1 WSL 传 transport:'wsl' + distro/linuxRoot。
 */
export interface RemoteServerConnectPayload {
  transport?: 'local' | 'wsl' | 'ssh'
  /** WSL 发行版（transport=wsl） */
  distro?: string
  /** SSH 配置别名（transport=ssh，D 阶段） */
  host?: string
  /** 远端工作区根（Ubuntu 内绝对路径，不经 UNC；本地管道时忽略） */
  linuxRoot?: string
  sessionId?: string
  /** A2 本地管道：本机待托管目录（绝对路径） */
  root?: string
  /** 期望远端平台；与握手上报不一致时拒绝（防 Windows node.exe 冒充） */
  expectedPlatform?: NodeJS.Platform
  /** 调用超时毫秒（缺省用协议限额） */
  timeoutMs?: number
}

export interface RemoteServerConnectionInfo {
  connectionId: string
  /** A2 本地管道的托管根；B1 WSL/SSH 连接无此字段（由 distro/linuxRoot 定位） */
  root?: string
  state: WorkspaceConnectionState
  /** 连接代际（每次连接独立，旧响应/旧事件不得覆盖新状态） */
  generation: string
  handshake?: WorkspaceServerHandshake | null
  errorCode?: string
  errorMessage?: string
}

/** 经已建立连接调用 workspace 方法（重连不盲重放有副作用请求） */
export interface RemoteServerInvokePayload {
  connectionId: string
  method: string
  params?: Record<string, unknown>
  timeoutMs?: number
}
