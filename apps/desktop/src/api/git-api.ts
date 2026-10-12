import type {
  AppError,
  ElectronAPI,
  GitCommitOptions,
  GitCommitResult,
  GitPushOptions,
  GitPushResult,
  GitStatusResult,
  Result,
} from '@montree/contracts'
import { err, ok } from '@montree/contracts'

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
}
