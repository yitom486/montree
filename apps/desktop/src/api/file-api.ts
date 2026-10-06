import type { AppError } from '@montree/contracts'
import type {
  ExportDocumentPayload,
  ExportDocumentResult,
  ExportMarkdownPayload,
  OpenDialogOptions,
  OpenDocumentResult,
  OpenFileResult,
  OpenFolderResult,
  ReadBinaryResult,
  ReadImageResult,
  SaveFilePayload,
  SaveFileResult,
  SavePastedImagePayload,
  SavePastedImageResult,
  WorkspaceFsCopyPayload,
  WorkspaceFsCreateDirPayload,
  WorkspaceFsCreateFilePayload,
  WorkspaceFsDeletePayload,
  WorkspaceFsMovePayload,
  WorkspaceFsPathResult,
  WorkspaceFsRenamePayload,
  WorkspaceSearchMarkdownPayload,
  WorkspaceSearchMarkdownResult,
} from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import type { ElectronAPI } from '@montree/contracts'

function requireElectronAPI(): Result<ElectronAPI, AppError> {
  if (!window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE',
      message: 'Electron API 不可用，请重启应用后重试',
    })
  }

  return ok(window.electronAPI)
}

const WORKSPACE_FS_METHODS = [
  'createWorkspaceFile',
  'createWorkspaceDirectory',
  'renameWorkspacePath',
  'deleteWorkspacePath',
  'copyWorkspacePath',
  'moveWorkspacePath',
] as const satisfies ReadonlyArray<keyof ElectronAPI>

function requireWorkspaceFsAPI(): Result<ElectronAPI, AppError> {
  const api = requireElectronAPI()
  if (!api.ok) return api

  const missing = WORKSPACE_FS_METHODS.filter((name) => typeof api.value[name] !== 'function')
  if (missing.length > 0) {
    return err({
      code: 'API_UNAVAILABLE',
      message: `工作区文件 API 未加载（缺少 ${missing.join(', ')}）。请完全退出并重新运行 bun run dev`,
    })
  }

  return api
}

export const fileApi = {
  async openFile(options?: OpenDialogOptions): Promise<Result<OpenDocumentResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.openFile(options)
  },

  async openFolder(options?: OpenDialogOptions): Promise<Result<OpenFolderResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.openFolder(options)
  },

  async scanWorkspace(rootPath: string): Promise<Result<OpenFolderResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.scanWorkspace(rootPath)
  },

  /**
   * P2.2 工作区 Markdown 字面检索（只读）。仅 inspect 链调用，
   * root 取文件树状态，模型碰不到；失败由调用方降级为纯内存结果。
   */
  async searchWorkspaceMarkdown(
    payload: WorkspaceSearchMarkdownPayload,
  ): Promise<Result<WorkspaceSearchMarkdownResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.searchWorkspaceMarkdown !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: '工作区检索 API 不可用' })
    }
    return api.value.searchWorkspaceMarkdown(payload)
  },

  async readFile(filePath: string): Promise<Result<OpenFileResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.readFile(filePath)
  },

  async readBinaryFile(filePath: string): Promise<Result<ReadBinaryResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.readBinaryFile(filePath)
  },

  async readImage(filePath: string): Promise<Result<ReadImageResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.readImage(filePath)
  },

  async saveFile(payload: SaveFilePayload): Promise<Result<SaveFileResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.saveFile(payload)
  },

  async saveFileAs(payload: SaveFilePayload): Promise<Result<SaveFileResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.saveFileAs(payload)
  },

  async savePastedImage(
    payload: SavePastedImagePayload,
  ): Promise<Result<SavePastedImageResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.savePastedImage(payload)
  },

  async createWorkspaceFile(
    payload: WorkspaceFsCreateFilePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    const api = requireWorkspaceFsAPI()
    if (!api.ok) return api
    return api.value.createWorkspaceFile(payload)
  },

  async createWorkspaceDirectory(
    payload: WorkspaceFsCreateDirPayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    const api = requireWorkspaceFsAPI()
    if (!api.ok) return api
    return api.value.createWorkspaceDirectory(payload)
  },

  async renameWorkspacePath(
    payload: WorkspaceFsRenamePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    const api = requireWorkspaceFsAPI()
    if (!api.ok) return api
    return api.value.renameWorkspacePath(payload)
  },

  async deleteWorkspacePath(
    payload: WorkspaceFsDeletePayload,
  ): Promise<Result<void, AppError>> {
    const api = requireWorkspaceFsAPI()
    if (!api.ok) return api
    return api.value.deleteWorkspacePath(payload)
  },

  async copyWorkspacePath(
    payload: WorkspaceFsCopyPayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    const api = requireWorkspaceFsAPI()
    if (!api.ok) return api
    return api.value.copyWorkspacePath(payload)
  },

  async moveWorkspacePath(
    payload: WorkspaceFsMovePayload,
  ): Promise<Result<WorkspaceFsPathResult, AppError>> {
    const api = requireWorkspaceFsAPI()
    if (!api.ok) return api
    return api.value.moveWorkspacePath(payload)
  },

  async exportHtml(
    payload: ExportDocumentPayload,
  ): Promise<Result<ExportDocumentResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.exportHtml(payload)
  },

  async exportPdf(payload: ExportDocumentPayload): Promise<Result<ExportDocumentResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.exportPdf(payload)
  },

  async exportMarkdown(
    payload: ExportMarkdownPayload,
  ): Promise<Result<ExportDocumentResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.exportMarkdown(payload)
  },
}

export const appApi = {
  async getVersion(): Promise<Result<string, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.getVersion()
  },

  getPlatform(): Result<string, AppError> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return ok(api.value.platform)
  },
}
