/**
 * WorkspaceHost 抽象（A1）：工作区业务按宿主分发，而非按路径猜测。
 *
 * - LocalWorkspaceHost：包装现有本机实现（file-service / workspace*.ts /
 *   workspace-watcher 由 bindings 层驱动 / git-service），行为与改前一致。
 * - WSL/SSH 宿主：B/D 阶段落地；当前以 UnavailableWorkspaceHost 显式返回
 *   REMOTE_NOT_CONNECTED，禁止静默回落 UNC、伪装空目录或伪装保存成功（§3.2）。
 * - 分发只看描述符 kind，不做 isWslPath 式路径嗅探；git-service 内部遗留的
 *   WSL 穿透（UNC 路径）是本机兼容行为，B3 起统一由远端宿主执行 Git。
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import type {
  AppError,
  ExportDocumentPayload,
  ExportDocumentResult,
  ExportMarkdownPayload,
  GitCommitOptions,
  GitCommitResult,
  GitPushOptions,
  GitPushResult,
  GitStatusResult,
  OpenDialogOptions,
  OpenDocumentResult,
  OpenFolderResult,
  ReadBinaryResult,
  ReadImageResult,
  Result,
  SaveFilePayload,
  SaveFileResult,
  SavePastedImagePayload,
  SavePastedImageResult,
  WorkspaceDescriptor,
  WorkspaceFsCopyPayload,
  WorkspaceFsCreateDirPayload,
  WorkspaceFsCreateFilePayload,
  WorkspaceFsDeletePayload,
  WorkspaceFsMovePayload,
  WorkspaceFsPathResult,
  WorkspaceFsRenamePayload,
  WorkspaceKind,
  WorkspaceSearchMarkdownPayload,
  WorkspaceSearchMarkdownResult,
} from '@yitom/contracts'
import { err, ok } from '@yitom/contracts'
import {
  exportHtmlDocument,
  exportMarkdownDocument,
  exportPdfDocument,
  openDocumentDialog,
  openFolderDialog,
  readBinaryFileByPath,
  readFileByPath,
  readImageAsDataUrl,
  saveFileDialog,
  savePastedImage,
  scanWorkspaceFolder,
} from './file-service'
import {
  workspaceCopy,
  workspaceCreateDirectory,
  workspaceCreateFile,
  workspaceDelete,
  workspaceMove,
  workspaceRename,
} from './workspace-fs'
import { searchWorkspaceMarkdown, paginateWorkspaceHits } from './workspace-md-search'
import { getGitStatus, gitCommit, gitPush } from './git/git-service'
import { getWindowWorkspaceDescriptor } from './workspace-bindings'

export interface HostTextRead {
  filePath: string
  content: string
  /** A1 本机 revision：内容 sha256（B2 起与 workspace-core size:mtime:hash 收敛）。 */
  revision: string
}

export interface HostWriteTextInput {
  content: string
  /** 携带后先核对磁盘版本，不一致返回 REVISION_CONFLICT（不盲覆盖，T5）。 */
  expectedRevision?: string | null
}

export interface HostWriteTextResult {
  filePath: string
  revision: string
}

/** A1 本机 revision：sha256 hex（非加密用途，仅外部修改冲突检测）。 */
export function computeLocalRevision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

const REMOTE_UNAVAILABLE_MESSAGE =
  '远端宿主尚未落地（B 阶段），未回落 UNC、未伪装成功，请先用本机模式'

export interface WorkspaceHost {
  readonly kind: WorkspaceKind
  openDocument: (options?: OpenDialogOptions) => Promise<Result<OpenDocumentResult, AppError>>
  openFolder: (options?: OpenDialogOptions) => Promise<Result<OpenFolderResult, AppError>>
  scanWorkspace: (rootPath: string) => Promise<Result<OpenFolderResult, AppError>>
  readText: (filePath: string) => Promise<Result<HostTextRead, AppError>>
  writeText: (
    filePath: string,
    input: HostWriteTextInput,
  ) => Promise<Result<HostWriteTextResult, AppError>>
  saveFile: (payload: SaveFilePayload) => Promise<Result<SaveFileResult, AppError>>
  saveFileAs: (payload: SaveFilePayload) => Promise<Result<SaveFileResult, AppError>>
  createFile: (
    payload: WorkspaceFsCreateFilePayload,
  ) => Promise<Result<WorkspaceFsPathResult, AppError>>
  createDirectory: (
    payload: WorkspaceFsCreateDirPayload,
  ) => Promise<Result<WorkspaceFsPathResult, AppError>>
  renamePath: (payload: WorkspaceFsRenamePayload) => Promise<Result<WorkspaceFsPathResult, AppError>>
  deletePath: (payload: WorkspaceFsDeletePayload) => Promise<Result<void, AppError>>
  copyPath: (payload: WorkspaceFsCopyPayload) => Promise<Result<WorkspaceFsPathResult, AppError>>
  movePath: (payload: WorkspaceFsMovePayload) => Promise<Result<WorkspaceFsPathResult, AppError>>
  searchMarkdown: (
    payload: WorkspaceSearchMarkdownPayload,
  ) => Promise<Result<WorkspaceSearchMarkdownResult, AppError>>
  gitStatus: (cwd: string) => Promise<GitStatusResult>
  gitPush: (
    payload: { cwd: string } & GitPushOptions,
  ) => Promise<Result<GitPushResult, AppError>>
  gitCommit: (
    payload: { cwd: string } & GitCommitOptions,
  ) => Promise<Result<GitCommitResult, AppError>>
  readBinary: (filePath: string) => Promise<Result<ReadBinaryResult, AppError>>
  readImage: (filePath: string) => Promise<Result<ReadImageResult, AppError>>
  savePastedImage: (
    payload: SavePastedImagePayload,
  ) => Promise<Result<SavePastedImageResult, AppError>>
  exportHtml: (payload: ExportDocumentPayload) => Promise<Result<ExportDocumentResult, AppError>>
  exportPdf: (payload: ExportDocumentPayload) => Promise<Result<ExportDocumentResult, AppError>>
  exportMarkdown: (
    payload: ExportMarkdownPayload,
  ) => Promise<Result<ExportDocumentResult, AppError>>
}

/** 本机宿主：逐项委托既有实现，语义与 A1 前完全一致（回归由既有单测覆盖）。 */
export class LocalWorkspaceHost implements WorkspaceHost {
  readonly kind: WorkspaceKind = 'local'

  openDocument(options?: OpenDialogOptions): Promise<Result<OpenDocumentResult, AppError>> {
    return openDocumentDialog(options)
  }

  openFolder(options?: OpenDialogOptions): Promise<Result<OpenFolderResult, AppError>> {
    return openFolderDialog(options)
  }

  scanWorkspace(rootPath: string): Promise<Result<OpenFolderResult, AppError>> {
    return scanWorkspaceFolder(rootPath)
  }

  async readText(filePath: string): Promise<Result<HostTextRead, AppError>> {
    const result = await readFileByPath(filePath)
    if (!result.ok) return result
    return ok({
      filePath: result.value.filePath,
      content: result.value.content,
      revision: computeLocalRevision(result.value.content),
    })
  }

  async writeText(
    filePath: string,
    input: HostWriteTextInput,
  ): Promise<Result<HostWriteTextResult, AppError>> {
    try {
      if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
        let current: string
        try {
          current = await readFile(filePath, 'utf-8')
        } catch {
          return err({ code: 'FILE_NOT_FOUND', message: '文件不存在，无法核对版本后保存' })
        }
        if (computeLocalRevision(current) !== input.expectedRevision) {
          return err({
            code: 'REVISION_CONFLICT',
            message: '文件已被其他程序修改，请重新打开后再保存',
          })
        }
      }
      await writeFile(filePath, input.content, 'utf-8')
      return ok({ filePath, revision: computeLocalRevision(input.content) })
    } catch (error) {
      return err({
        code: 'FILE_WRITE_ERROR',
        message: error instanceof Error ? error.message : '保存文件失败',
      })
    }
  }

  saveFile(payload: SaveFilePayload): Promise<Result<SaveFileResult, AppError>> {
    return saveFileDialog(payload)
  }

  saveFileAs(payload: SaveFilePayload): Promise<Result<SaveFileResult, AppError>> {
    return saveFileDialog({ ...payload, filePath: undefined })
  }

  createFile(
    payload: WorkspaceFsCreateFilePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return workspaceCreateFile(payload)
  }

  createDirectory(
    payload: WorkspaceFsCreateDirPayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return workspaceCreateDirectory(payload)
  }

  renamePath(
    payload: WorkspaceFsRenamePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return workspaceRename(payload)
  }

  deletePath(payload: WorkspaceFsDeletePayload): Promise<Result<void, AppError>> {
    return workspaceDelete(payload)
  }

  copyPath(payload: WorkspaceFsCopyPayload): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return workspaceCopy(payload)
  }

  movePath(payload: WorkspaceFsMovePayload): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return workspaceMove(payload)
  }

  async searchMarkdown(
    payload: WorkspaceSearchMarkdownPayload,
  ): Promise<Result<WorkspaceSearchMarkdownResult, AppError>> {
    const found = searchWorkspaceMarkdown({
      root: payload.workspaceRoot,
      query: payload.query,
      excludePath: typeof payload.excludePath === 'string' ? payload.excludePath : null,
    })
    // B3 分页：与远端宿主同一切片语义（offset/limit/nextOffset）
    const { hits, nextOffset } = paginateWorkspaceHits(found.hits, payload.offset, payload.limit)
    return ok({ total: found.total, hits, nextOffset })
  }

  gitStatus(cwd: string): Promise<GitStatusResult> {
    return getGitStatus(cwd)
  }

  gitPush(payload: { cwd: string } & GitPushOptions): Promise<Result<GitPushResult, AppError>> {
    return gitPush(payload.cwd, payload)
  }

  gitCommit(
    payload: { cwd: string } & GitCommitOptions,
  ): Promise<Result<GitCommitResult, AppError>> {
    return gitCommit(payload.cwd, payload)
  }

  readBinary(filePath: string): Promise<Result<ReadBinaryResult, AppError>> {
    return readBinaryFileByPath(filePath)
  }

  readImage(filePath: string): Promise<Result<ReadImageResult, AppError>> {
    return readImageAsDataUrl(filePath)
  }

  savePastedImage(
    payload: SavePastedImagePayload,
  ): Promise<Result<SavePastedImageResult, AppError>> {
    return savePastedImage(payload)
  }

  // 导出经本机对话框/打印管线，远端另存为由 B2 接宿主（此处不实现、不伪装）。
  exportHtml(payload: ExportDocumentPayload): Promise<Result<ExportDocumentResult, AppError>> {
    return exportHtmlDocument(payload)
  }

  exportPdf(payload: ExportDocumentPayload): Promise<Result<ExportDocumentResult, AppError>> {
    return exportPdfDocument(payload)
  }

  exportMarkdown(
    payload: ExportMarkdownPayload,
  ): Promise<Result<ExportDocumentResult, AppError>> {
    return exportMarkdownDocument(payload)
  }
}

/** 远端占位宿主：所有业务显式失败，不碰本机 fs（T3：无 UNC I/O）。 */
export class UnavailableWorkspaceHost implements WorkspaceHost {
  constructor(readonly kind: WorkspaceKind) {}

  private unavailable(): Result<never, AppError> {
    return err({ code: 'REMOTE_NOT_CONNECTED', message: REMOTE_UNAVAILABLE_MESSAGE })
  }

  async openDocument(_options?: OpenDialogOptions): Promise<Result<OpenDocumentResult, AppError>> {
    return this.unavailable()
  }

  async openFolder(_options?: OpenDialogOptions): Promise<Result<OpenFolderResult, AppError>> {
    return this.unavailable()
  }

  async scanWorkspace(_rootPath: string): Promise<Result<OpenFolderResult, AppError>> {
    return this.unavailable()
  }

  async readText(_filePath: string): Promise<Result<HostTextRead, AppError>> {
    return this.unavailable()
  }

  async writeText(
    _filePath: string,
    _input: HostWriteTextInput,
  ): Promise<Result<HostWriteTextResult, AppError>> {
    return this.unavailable()
  }

  async saveFile(_payload: SaveFilePayload): Promise<Result<SaveFileResult, AppError>> {
    return this.unavailable()
  }

  async saveFileAs(_payload: SaveFilePayload): Promise<Result<SaveFileResult, AppError>> {
    return this.unavailable()
  }

  async createFile(
    _payload: WorkspaceFsCreateFilePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return this.unavailable()
  }

  async createDirectory(
    _payload: WorkspaceFsCreateDirPayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return this.unavailable()
  }

  async renamePath(
    _payload: WorkspaceFsRenamePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return this.unavailable()
  }

  async deletePath(_payload: WorkspaceFsDeletePayload): Promise<Result<void, AppError>> {
    return this.unavailable()
  }

  async copyPath(
    _payload: WorkspaceFsCopyPayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return this.unavailable()
  }

  async movePath(
    _payload: WorkspaceFsMovePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    return this.unavailable()
  }

  async searchMarkdown(
    _payload: WorkspaceSearchMarkdownPayload,
  ): Promise<Result<WorkspaceSearchMarkdownResult, AppError>> {
    return this.unavailable()
  }

  async gitStatus(_cwd: string): Promise<GitStatusResult> {
    return { isRepo: false, branch: null, ahead: 0, behind: 0, hasUpstream: false, files: [], totalChanges: 0 }
  }

  async gitPush(
    _payload: { cwd: string } & GitPushOptions,
  ): Promise<Result<GitPushResult, AppError>> {
    return this.unavailable()
  }

  async gitCommit(
    _payload: { cwd: string } & GitCommitOptions,
  ): Promise<Result<GitCommitResult, AppError>> {
    return this.unavailable()
  }

  async readBinary(_filePath: string): Promise<Result<ReadBinaryResult, AppError>> {
    return this.unavailable()
  }

  async readImage(_filePath: string): Promise<Result<ReadImageResult, AppError>> {
    return this.unavailable()
  }

  async savePastedImage(
    _payload: SavePastedImagePayload,
  ): Promise<Result<SavePastedImageResult, AppError>> {
    return this.unavailable()
  }

  async exportHtml(
    _payload: ExportDocumentPayload,
  ): Promise<Result<ExportDocumentResult, AppError>> {
    return this.unavailable()
  }

  async exportPdf(
    _payload: ExportDocumentPayload,
  ): Promise<Result<ExportDocumentResult, AppError>> {
    return this.unavailable()
  }

  async exportMarkdown(
    _payload: ExportMarkdownPayload,
  ): Promise<Result<ExportDocumentResult, AppError>> {
    return this.unavailable()
  }
}

export const localWorkspaceHost = new LocalWorkspaceHost()
const wslUnavailableHost = new UnavailableWorkspaceHost('wsl')
const sshUnavailableHost = new UnavailableWorkspaceHost('ssh')

/**
 * P1 远端会话解析器：由 register-handlers 在启动时注入
 * (`getRemoteHost` 会话表)。缺省 null 时 wsl/ssh 走 unavailable，
 * 显式报 REMOTE_NOT_CONNECTED（§3.2，不回落）。
 * 注入而非直接 import 会话表，避免 services 间运行时循环依赖。
 */
let remoteHostResolver: ((workspaceId: string) => WorkspaceHost | null) | null = null

export function setRemoteHostResolver(
  resolver: ((workspaceId: string) => WorkspaceHost | null) | null,
): void {
  remoteHostResolver = resolver
}

/** 仅测试使用：恢复无解析器状态。 */
export function resetRemoteHostResolverForTest(): void {
  remoteHostResolver = null
}

/** 按描述符 kind 分发宿主；未绑定/缺描述符一律走本机（本机模式回归）。 */
export function resolveWorkspaceHost(descriptor?: WorkspaceDescriptor | null): WorkspaceHost {
  if (descriptor?.kind === 'wsl' || descriptor?.kind === 'ssh') {
    const remote = remoteHostResolver?.(descriptor.id) ?? null
    if (remote) return remote
    return descriptor.kind === 'wsl' ? wslUnavailableHost : sshUnavailableHost
  }
  return localWorkspaceHost
}

/** IPC 处理器入口：以可信 webContentsId 取宿主（不信任 renderer 传参）。 */
export function getWorkspaceHostForWindow(webContentsId: number): WorkspaceHost {
  return resolveWorkspaceHost(getWindowWorkspaceDescriptor(webContentsId))
}
