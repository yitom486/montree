/**
 * 本地工作区宿主身份（A1）。
 *
 * 与 `types/workspace.ts`（A2 远端协议共享类型，他人并行落地中）的分工：
 * 本文件只放**本机模式可独立回归**所需的身份与纯函数——本地描述符工厂、
 * 文档键规则（local 沿用裸路径，远端按 workspaceId 命名空间隔离）、
 * 可信窗口绑定状态。不定义远端协议帧/握手/manifest（见 workspace.ts）。
 *
 * 纯模块：无 node: 依赖（lint:deps R2），渲染/主进程均可 import。
 */
import type { AppError } from '../core/errors'
import type {
  DocumentRef,
  WorkspaceConnectionState,
  WorkspaceDescriptor,
  WorkspaceKind,
} from './workspace'

/** 本机工作区固定身份（单窗口单本机工作区；远端 id 由 B/D 阶段分配）。 */
export const LOCAL_WORKSPACE_ID = 'local' as const

export function isLocalWorkspaceId(workspaceId?: string | null): boolean {
  return !workspaceId || workspaceId === LOCAL_WORKSPACE_ID
}

/** 取路径末段（不依赖 node:path，供 contracts 纯函数使用）。 */
function baseNameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

/** 构造本机工作区描述符（target 置空；远端绝对 root 永不进 renderer 拼接）。 */
export function makeLocalWorkspaceDescriptor(rootPath: string): WorkspaceDescriptor {
  const trimmed = rootPath.trim()
  return {
    id: LOCAL_WORKSPACE_ID,
    kind: 'local',
    target: '',
    rootLabel: trimmed,
    displayName: baseNameOf(trimmed) || trimmed,
  }
}

/**
 * 构造 WSL 远端工作区描述符（纯函数；发行版/远端根由调用方经动态探测得出）。
 * id 形如 `wsl:Ubuntu:/home/u/blog`（见 workspace.ts），同一 id 在会话表内
 * 共享同一远端宿主连接，多窗口按 refcount 共用（T7）。
 */
export function makeWslWorkspaceDescriptor(distro: string, linuxRoot: string): WorkspaceDescriptor {
  const name = distro.trim()
  const root = linuxRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return {
    id: `wsl:${name}:${root}`,
    kind: 'wsl',
    target: name,
    rootLabel: root,
    displayName: baseNameOf(root) || root,
  }
}

/**
 * 归一化工作区相对 POSIX 路径：反斜杠转正斜杠，去掉前导 `./` 与 `/`，
 * 折叠重复斜杠。空串保持空串（调用方判定根）。
 */
export function normalizeWorkspaceRelativePath(input: string): string {
  const posix = input.replace(/\\/g, '/').trim()
  const collapsed = posix.replace(/\/+/g, '/')
  const withoutDot = collapsed.replace(/^(\.\/)+/, '')
  return withoutDot.replace(/^\/+/, '')
}

/** 构造文档身份（同一 relativePath 在不同 workspaceId 下是不同文档）。 */
export function makeDocumentRef(workspaceId: string, relativePath: string): DocumentRef {
  return {
    workspaceId: workspaceId.trim() || LOCAL_WORKSPACE_ID,
    relativePath: normalizeWorkspaceRelativePath(relativePath),
  }
}

/**
 * 文档缓存键：local 沿用裸相对路径/绝对路径（历史行为零变化），
 * 非 local 加 `workspaceId::` 前缀防串（T7：两工作区同相对路径隔离）。
 */
export function documentRefKey(ref: DocumentRef): string {
  if (isLocalWorkspaceId(ref.workspaceId)) return ref.relativePath
  return `${ref.workspaceId}::${ref.relativePath}`
}

/** 解析 documentRefKey；非法返回 null（不抛，调用方降级处理）。 */
export function parseDocumentRefKey(key: string): DocumentRef | null {
  if (!key) return null
  const sep = key.indexOf('::')
  if (sep <= 0) return { workspaceId: LOCAL_WORKSPACE_ID, relativePath: key }
  return {
    workspaceId: key.slice(0, sep),
    relativePath: key.slice(sep + 2),
  }
}

export function isSameDocumentRef(a: DocumentRef, b: DocumentRef): boolean {
  return a.workspaceId === b.workspaceId && a.relativePath === b.relativePath
}

/**
 * 通用作用域键（draft 草稿、fileStates、document-tool registry 共用同一规则）：
 * local/空沿用裸键（回归零变化），其余加 `workspaceId::` 前缀。
 */
export function scopeDocumentKey(key: string, workspaceId?: string): string {
  if (isLocalWorkspaceId(workspaceId)) return key
  return `${workspaceId}::${key}`
}

/** 主进程可信窗口绑定快照（main 以 event.sender 归属窗口，不信任 renderer 传参）。 */
export interface WindowWorkspaceStatus {
  workspaceId: string
  kind: WorkspaceKind
  state: WorkspaceConnectionState
  /** 连接代际：每次绑定/重连自增，旧响应与旧 watch 事件不得覆盖新状态。 */
  generation: number
  rootLabel: string
  error?: AppError
}

/** 工作区磁盘变化事件（workspace:changed 载荷；代际用于丢弃旧工作区事件）。 */
export interface WorkspaceChangedEvent {
  rootPath: string
  workspaceId: string
  generation: number
  /** B3：变化涉及的工作区相对目录（缺席/截断时调用方回落全量重扫） */
  dirs?: string[]
  truncatedDirs?: boolean
}

/** 本机连接请求（A1 仅 local；wsl/ssh 由 B/D 阶段扩展，当前显式拒绝）。 */
export interface WorkspaceConnectPayload {
  rootPath: string
}

export interface WorkspaceConnectResult {
  descriptor: WorkspaceDescriptor
  generation: number
  status: WindowWorkspaceStatus
}
