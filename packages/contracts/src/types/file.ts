/**
 * 文件 / 工作区 / 导出 IPC DTO。
 * 打开结果用 kind 判别：Markdown 带正文，电子书只给路径（内容在阅读器里读）。
 */
import type { DataDocumentKind, DocumentKind, OfficeDocumentKind } from './document'

/** 按路径读文本（已知是 Markdown/纯文本） */
export interface OpenFileResult {
  filePath: string
  content: string
}

/** 打开对话框的结果：文本类含 content；二进制类仅含 filePath 避免占用 IPC 字符串 */
export type OpenDocumentResult =
  | { filePath: string; kind: 'markdown' | 'html' | DataDocumentKind; content: string }
  | { filePath: string; kind: 'pdf' | 'epub' | 'mobi' | OfficeDocumentKind }


export interface ReadBinaryResult {
  filePath: string
  /** IPC 传输后通常为 Uint8Array */
  data: Uint8Array
  hash?: string
}

export interface OpenDialogOptions {
  defaultPath?: string
}

export interface SaveFilePayload {
  filePath?: string
  content: string
  /** Loaded disk text; when supplied, refuse to overwrite external changes. */
  expectedContent?: string
  /** 另存为对话框的初始路径（含文件名） */
  defaultPath?: string
}

export interface SaveFileResult {
  filePath: string
}

export interface ReadImageResult {
  dataUrl: string
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  /** 文件节点专用，用于侧栏图标区分 */
  documentKind?: Exclude<DocumentKind, 'unknown'>
  children?: FileTreeNode[]
}

export interface OpenFolderResult {
  rootPath: string
  tree: FileTreeNode[]
}

export interface SavePastedImagePayload {
  /** Markdown 旁 assets/；与 workspaceRoot 二选一 */
  markdownFilePath?: string
  /** Agent 粘贴：落到 workspace/.montree/agent-pasted/ */
  workspaceRoot?: string
  base64: string
  mimeType: string
}

export interface SavePastedImageResult {
  relativePath: string
  absolutePath: string
}

export interface ExportDocumentPayload {
  html: string
  suggestedName?: string
}

/** 另存为 Markdown / 纯文本（笔记导出、Anki 卡片等） */
export interface ExportMarkdownPayload {
  content: string
  suggestedName?: string
  title?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface ExportDocumentResult {
  filePath: string
}

/** 工作区树操作成功后的绝对路径 */
export interface WorkspaceFsPathResult {
  path: string
}

export interface WorkspaceFsCreateFilePayload {
  workspaceRoot: string
  path: string
  content?: string
}

export interface WorkspaceFsCreateDirPayload {
  workspaceRoot: string
  path: string
}

export interface WorkspaceFsRenamePayload {
  workspaceRoot: string
  fromPath: string
  toPath: string
}

export interface WorkspaceFsDeletePayload {
  workspaceRoot: string
  path: string
}

export interface WorkspaceFsCopyPayload {
  workspaceRoot: string
  fromPath: string
  toPath: string
}

export interface WorkspaceFsMovePayload {
  workspaceRoot: string
  fromPath: string
  toPath: string
}

/**
 * P2.2 工作区 Markdown 字面检索请求。workspaceRoot 来自渲染端文件树状态
 * （与文件树同一来源），模型碰不到；主进程逐文件 assert 在根内。
 * excludePath 为当前打开文件的磁盘路径（其磁盘副本不搜，内存已覆盖）。
 */
export interface WorkspaceSearchMarkdownPayload {
  workspaceRoot: string
  query: string
  excludePath?: string
  /** B2 分页：跳过前 offset 条（默认 0） */
  offset?: number
  /** B2 分页：本页最多取 limit 条（默认全量，上限 100） */
  limit?: number
}

export interface WorkspaceSearchMarkdownHit {
  /** 相对根的 posix 相对路径（永不绝对路径/盘符） */
  filePath: string
  /** 1-based 行号 */
  lineStart: number
  /** 命中行原文（至多 2000 字） */
  line: string
}

export interface WorkspaceSearchMarkdownResult {
  /** 精确命中数（文件×行，上限 100） */
  total: number
  hits: WorkspaceSearchMarkdownHit[]
  /** B2 分页：下一页 offset，无更多时为 null（缺席视为无分页） */
  nextOffset?: number | null
}
