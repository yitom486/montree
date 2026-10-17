import type {
  AppError,
  ElectronAPI,
  GitBranchInfo,
  GitCommitOptions,
  GitCommitResult,
  GitDiffResult,
  GitPushOptions,
  GitPushResult,
  GitStatusResult,
  Result,
} from '@yitom/contracts'
import { err, ok } from '@yitom/contracts'

function requireElectronAPI(): Result<ElectronAPI, AppError> {
  if (!window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE',
      message: 'Electron API 不可用，请重启应用后重试',
    })
  }

  return ok(window.electronAPI)
}

export const gitApi = {
  /** 查询指定目录 Git 仓库状态（支持 Windows 与 WSL 自动穿透） */
  async getStatus(cwd: string): Promise<Result<GitStatusResult, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.gitStatus(cwd)
  },

  /** 推送到远程仓库（自动复用 WSL 或本机的 SSH/凭据） */
  async push(
    cwd: string,
    options: GitPushOptions = {},
  ): Promise<Result<GitPushResult, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.gitPush({ cwd, ...options })
  },

  /** 提交当前修改 */
  async commit(
    cwd: string,
    options: GitCommitOptions,
  ): Promise<Result<GitCommitResult, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.gitCommit({ cwd, ...options })
  },

  /** B3：读取未暂存/已暂存 diff（过长截断并标记） */
  async getDiff(
    cwd: string,
    file?: string,
    staged = false,
  ): Promise<Result<GitDiffResult, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    if (typeof apiResult.value.gitDiff !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: 'Git diff API 不可用' })
    }
    return apiResult.value.gitDiff({ cwd, file, staged })
  },

  /** B3：列出分支与当前分支 */
  async listBranches(cwd: string): Promise<Result<GitBranchInfo, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    if (typeof apiResult.value.gitBranches !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: 'Git 分支 API 不可用' })
    }
    return apiResult.value.gitBranches(cwd)
  },
}
