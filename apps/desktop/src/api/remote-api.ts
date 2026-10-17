import type {
  AppError,
  ElectronAPI,
  RemoteBrowseResult,
  RemoteOpenWslWorkspacePayload,
  RemoteOpenWslWorkspaceResult,
  RemoteServerConnectPayload,
  RemoteServerConnectionInfo,
  RemoteServerInvokePayload,
  RemoteWslConnectPayload,
  RemoteWslStatPayload,
  Result,
  SshConfigHost,
  WorkspaceMethod,
  WorkspaceStatResult,
  WslDistroInfo,
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

  /**
   * 经 wsl.exe 管道安装/启动 Ubuntu 远端服务并完成握手。
   * 浏览前须先连接；断线/版本不兼容/远端 Node 缺失返回明确错误。
   */
  async connectWsl(payload: RemoteWslConnectPayload): Promise<Result<RemoteServerConnectionInfo, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteConnectWsl(payload)
  },

  /** 断开 WSL 远端连接并清理本连接启动的服务进程 */
  async disconnectWsl(): Promise<Result<void, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteDisconnectWsl()
  },

  /** 查询当前 WSL 远端连接状态（含握手信息与代际） */
  async wslStatus(): Promise<Result<RemoteServerConnectionInfo | null, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteWslStatus()
  },

  /**
   * 浏览 WSL 目录（B1 起经 Ubuntu 远端服务原生执行，不走 Windows UNC；
   * 未连接返回 REMOTE_NOT_CONNECTED，不回落、不伪装空目录）。
   */
  async browseWsl(distro: string, dirPath?: string): Promise<Result<RemoteBrowseResult, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteBrowseWsl({ distro, dirPath })
  },

  /** 查询远端文件/目录 stat（Ubuntu 服务原生执行） */
  async statWsl(payload: RemoteWslStatPayload): Promise<Result<WorkspaceStatResult, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteWslStat(payload)
  },

  /**
   * P1 打开远端工作区（连接选中根→注册远端宿主→绑定本窗口→返回初始树）。
   * 成功后调用方写回工作区身份与文件树，不再走本机重扫。
   */
  async openWslWorkspace(
    payload: RemoteOpenWslWorkspacePayload,
  ): Promise<Result<RemoteOpenWslWorkspaceResult, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteOpenWslWorkspace(payload)
  },

  /** 读取本机 ~/.ssh/config 里的 Host 主机列表 */
  async listSshConfigHosts(): Promise<Result<SshConfigHost[], AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteListSshConfigHosts()
  },

  /** 启动本地管道远端服务并完成版本握手（A2） */
  async serverConnect(
    payload: RemoteServerConnectPayload,
  ): Promise<Result<RemoteServerConnectionInfo, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteServerConnect(payload)
  },

  /** 经已连接服务执行一次 workspace 协议调用（A2） */
  async serverInvoke(
    payload: RemoteServerInvokePayload & { method: WorkspaceMethod },
  ): Promise<Result<unknown, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteServerInvoke(payload)
  },

  /** 断开指定连接并回收服务进程 */
  async serverDisconnect(connectionId: string): Promise<Result<void, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteServerDisconnect(connectionId)
  },

  /** 查询本地管道连接状态（含握手信息） */
  async serverStatus(connectionId: string): Promise<Result<RemoteServerConnectionInfo, AppError>> {
    const apiResult = requireElectronAPI()
    if (!apiResult.ok) return apiResult
    return apiResult.value.remoteServerStatus(connectionId)
  },
}
