import type {
  AppError,
  ElectronAPI,
  RemoteBrowseResult,
  Result,
  SshConfigHost,
  WslDistroInfo,
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

export const remoteApi = {
  /** 动态获取系统检测到的 WSL 分发版列表（零硬编码） */
  async listWslDistros(): Promise<Result<WslDistroInfo[], AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteListWslDistros()
  },

  /** 获取 WSL 指定分发版的 Linux 用户家目录（$HOME） */
  async getWslHome(distro: string): Promise<Result<string, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteGetWslHome(distro)
  },

  /** 应用内直接浏览 WSL 内部目录结构，返回子文件夹列表，完全规避原生弹窗 */
  async browseWsl(distro: string, dirPath?: string): Promise<Result<RemoteBrowseResult, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteBrowseWsl({ distro, dirPath })
  },

  /** 读取本机 ~/.ssh/config 里的 Host 主机列表 */
  async listSshConfigHosts(): Promise<Result<SshConfigHost[], AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteListSshConfigHosts()
  },
}
