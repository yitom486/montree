/**
 * 工作区文件操作 IPC 载荷（B2）。
 *
 * 与 `workspace.ts`（A2 协议共享类型）/ `workspace-identity.ts`（A1 身份）的分工：
 * 本文件只放 B2 渲染↔主进程之间的**宿主相对操作**载荷——调用方传
 * DocumentRef（workspaceId + 相对路径），远端绝对 root 永不进 renderer。
 * local 宿主首次 attach 需带 rootPath；远端由主进程连接状态持有 root。
 */
import type { WorkspaceWriteTextResult } from './workspace'

/** 跨宿主 copy/move 拒绝文案（用户显式导入/导出是独立语义） */
export const CROSS_WORKSPACE_MOVE_MESSAGE =
  '跨工作区复制/移动不支持，请用导出到本机后再导入目标工作区'

/**
 * 同宿主断言：跨宿主 copy/move 明确不支持，不得用 Windows cp 偷渡。
 * 纯函数；返回 false 时调用方以 UNSUPPORTED_OPERATION 失败。
 */
export function assertSameWorkspaceId(fromWorkspaceId: string, toWorkspaceId: string): boolean {
  return fromWorkspaceId === toWorkspaceId
}

/**
 * 远端事件代际过滤（渲染端用）：事件自带 generation 且与当前代际不同即过期。
 * 任一缺失视为有效（兼容无代际的本机旧推送；严格版见主进程 workspace-bindings）。
 */
export function isStaleGenerationEvent(
  eventGeneration: string | number | undefined,
  currentGeneration: string | number | undefined,
): boolean {
  if (eventGeneration === undefined || currentGeneration === undefined) return false
  return eventGeneration !== currentGeneration
}

/** 宿主相对读文本（open/readText 经宿主，返回 revision 供保存冲突检查） */
export interface WorkspaceReadTextRequest {
  workspaceId: string
  relativePath: string
  /** local 宿主首次 attach 用（渲染端工作区根）；远端由主进程连接持有 */
  rootPath?: string
}

/** 宿主相对写文本（携带 expectedRevision；冲突报 REVISION_CONFLICT，不盲覆盖） */
export interface WorkspaceWriteTextRequest extends WorkspaceReadTextRequest {
  content: string
  expectedRevision?: string
}

/**
 * 远端另存为：Remote 模式选择远端目录，不弹 Windows 对话框。
 * dirRelativePath 省略时为工作区根；fileName 不得含路径分隔符（主进程校验）。
 */
export interface WorkspaceSaveTextAsRequest {
  workspaceId: string
  rootPath?: string
  dirRelativePath?: string
  fileName: string
  content: string
}

export interface WorkspaceSaveTextAsResult {
  relativePath: string
  revision: WorkspaceWriteTextResult['revision']
}

/** 宿主相对读图片（相对预览图片经宿主，不拼 UNC、不走 renderer 文件接口） */
export interface WorkspaceReadImageRequest extends WorkspaceReadTextRequest {}

/* ================================================================
 * B2 IPC 引用形状（workspace:* 通道）：local 传本机绝对 filePath，
 * wsl/ssh 传 DocumentRef（workspaceId + 相对路径）。
 * ================================================================ */

/** 宿主文本引用：二选一（同时给出时 workspaceId/relativePath 优先） */
export interface WorkspaceHostTextRef {
  /** 本机绝对路径（local 语义） */
  filePath?: string
  /** 远端工作区 id（wsl/ssh 语义，需配 relativePath） */
  workspaceId?: string
  /** 远端工作区相对路径（wsl/ssh 语义） */
  relativePath?: string
}

export interface WorkspaceHostReadRequest extends WorkspaceHostTextRef {}

export interface WorkspaceHostWriteRequest extends WorkspaceHostTextRef {
  content: string
  expectedRevision?: string
}

/** 经宿主读文本结果（含 revision，保存冲突检查用） */
export interface WorkspaceHostReadResult {
  filePath: string
  content: string
  revision: string
}

export interface WorkspaceHostWriteResult {
  filePath: string
  revision: string
}

/** B2 远端另存为 IPC：local 沿用 filePath；远端用 workspaceId + 远端目录/文件名 */
export interface WorkspaceHostSaveAsRequest extends WorkspaceHostTextRef {
  content: string
  /** 远端目录相对路径（省略为工作区根） */
  dirRelativePath?: string
  /** 远端新文件名（不得含路径分隔符） */
  fileName?: string
}

export interface WorkspaceHostSaveAsResult {
  filePath: string
  revision: string
}
