import type { RendererErrorPayload } from '@montree/contracts'
import type { AppUpdateStatus } from '@montree/contracts'
import { ok, err, isOk, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'

function getElectronAPI() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

export const appApi = {
  toggleDevTools(): void {
    getElectronAPI()?.toggleDevTools()
  },

  async logRendererError(payload: RendererErrorPayload): Promise<void> {
    const api = getElectronAPI()
    if (!api) return
    await api.logRendererError(payload)
  },

  async getErrorLogPath(): Promise<Result<string, AppError>> {
    const api = getElectronAPI()
    if (!api) {
      return ok('')
    }
    return api.getErrorLogPath()
  },

  setVerboseLogs(enabled: boolean): void {
    getElectronAPI()?.setVerboseLogs(enabled)
  },

  newWindow(): void {
    getElectronAPI()?.newWindow()
  },

  /** 取走一个待处理的外部打开文件；非 Electron 环境或无待处理时返回 null */
  async takePendingExternalFile(): Promise<string | null> {
    const api = getElectronAPI()
    if (!api?.takePendingExternalFile) return null
    return api.takePendingExternalFile()
  },

  async openExternal(url: string): Promise<Result<void, AppError>> {
    const api = getElectronAPI()
    if (!api?.openExternal) {
      return err({ code: 'API_UNAVAILABLE', message: '外部链接 API 不可用' })
    }
    return api.openExternal(url)
  },

  async checkAppUpdate(): Promise<AppUpdateStatus | null> {
    const api = getElectronAPI()
    if (!api?.checkAppUpdate) return null
    return api.checkAppUpdate()
  },

  async downloadAppUpdate(): Promise<AppUpdateStatus | null> {
    const api = getElectronAPI()
    if (!api?.downloadAppUpdate) return null
    return api.downloadAppUpdate()
  },

  async installAppUpdate(): Promise<Result<void, AppError>> {
    const api = getElectronAPI()
    if (!api?.installAppUpdate) {
      return err({ code: 'API_UNAVAILABLE', message: '更新 API 不可用' })
    }
    return api.installAppUpdate()
  },

  async getAppUpdateStatus(): Promise<AppUpdateStatus | null> {
    const api = getElectronAPI()
    if (!api?.getAppUpdateStatus) return null
    const result = await api.getAppUpdateStatus()
    return isOk(result) ? result.value : null
  },

  onAppUpdateStatus(callback: (status: AppUpdateStatus) => void): (() => void) | undefined {
    return getElectronAPI()?.onAppUpdateStatus(callback)
  },

  /** preload 是否已注入（渲染进程直调 window.electronAPI 的唯一判空出口） */
  isAvailable(): boolean {
    return getElectronAPI() !== undefined
  },

  /** 通过「新建窗口」打开时为 true，不恢复工作区/上次文件 */
  isFreshWindow(): boolean {
    return getElectronAPI()?.isFreshWindow ?? false
  },

  /** 根据路径/脏标记更新窗口标题 */
  updateTitle(payload: { filePath?: string; isDirty: boolean }): void {
    getElectronAPI()?.updateTitle(payload)
  },

  /** 同步文档是否未保存（关窗确认用） */
  setDirty(dirty: boolean): void {
    getElectronAPI()?.setDirty(dirty)
  },

  /** 回复主进程的关窗请求：继续关闭或取消 */
  confirmClose(decision: 'proceed' | 'cancel'): void {
    getElectronAPI()?.confirmClose(decision)
  },

  /** 退出应用 */
  quit(): void {
    getElectronAPI()?.quit()
  },

  /** 监听主进程「请关闭窗口」；返回取消订阅 */
  onRequestClose(callback: () => void): (() => void) | undefined {
    return getElectronAPI()?.onRequestClose(callback)
  },

  /** 监听主进程全局快捷键动作；返回取消订阅 */
  onGlobalAction(callback: (action: string) => void): (() => void) | undefined {
    return getElectronAPI()?.onGlobalAction?.(callback)
  },

  /** E2E 门控：foliate 统一阅读器（仅测试进程注入） */
  isE2EFoliateReader(): boolean {
    return getElectronAPI()?.e2eFoliateReader === true
  },

  /** E2E 门控：PDF 结构化解析 WASM 钩子（仅测试进程注入） */
  isE2EPdfStructure(): boolean {
    return getElectronAPI()?.e2ePdfStructure === true
  },

  /** 开始监听工作区磁盘变化 */
  watchWorkspace(rootPath: string): void {
    getElectronAPI()?.watchWorkspace(rootPath)
  },

  /** 停止监听工作区 */
  unwatchWorkspace(): void {
    getElectronAPI()?.unwatchWorkspace?.()
  },

  /** 工作区文件变化时回调；返回取消订阅 */
  onWorkspaceChanged(callback: (payload: { rootPath: string }) => void): (() => void) | undefined {
    return getElectronAPI()?.onWorkspaceChanged(callback)
  },

  /** 判断是否运行在 Electron 桌面环境中 */
  isElectron(): boolean {
    return Boolean(getElectronAPI())
  },

  /** 当前运行平台（win32 / darwin / linux） */
  getPlatform(): string {
    return getElectronAPI()?.platform ?? (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows') ? 'win32' : 'linux')
  },

  /** 最小化当前窗口 */
  minimizeWindow(): void {
    getElectronAPI()?.minimizeWindow?.()
  },

  /** 切换最大化 / 还原当前窗口 */
  toggleMaximizeWindow(): void {
    getElectronAPI()?.toggleMaximizeWindow?.()
  },

  /** 关闭当前窗口（走保存确认） */
  closeWindow(): void {
    getElectronAPI()?.closeWindow?.()
  },

  /** 获取当前窗口是否最大化 */
  async isWindowMaximized(): Promise<boolean> {
    const api = getElectronAPI()
    if (!api?.isWindowMaximized) return false
    return api.isWindowMaximized()
  },

  /** 监听窗口最大化状态变更；返回取消订阅 */
  onWindowMaximizeChanged(callback: (isMaximized: boolean) => void): (() => void) | undefined {
    return getElectronAPI()?.onWindowMaximizeChanged?.(callback)
  },
}
