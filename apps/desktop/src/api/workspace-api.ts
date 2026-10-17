import type {
  AppError,
  ElectronAPI,
  ReadImageResult,
  WindowWorkspaceStatus,
  WorkspaceConnectPayload,
  WorkspaceConnectResult,
  WorkspaceHostReadRequest,
  WorkspaceHostReadResult,
  WorkspaceHostSaveAsRequest,
  WorkspaceHostSaveAsResult,
  WorkspaceHostTextRef,
  WorkspaceHostWriteRequest,
  WorkspaceHostWriteResult,
  WorkspaceSearchMarkdownPayload,
  WorkspaceSearchMarkdownResult,
} from '@yitom/contracts'
import { err, isCancelled, ok, type Result } from '@yitom/contracts'
import { isLocalWorkspaceId } from '@yitom/contracts'

function requireElectronAPI(): Result<ElectronAPI, AppError> {
  if (!window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE',
      message: 'Electron API 不可用，请重启应用后重试',
    })
  }
  return ok(window.electronAPI)
}

function requireWorkspaceHostAPI(
  name: 'workspaceReadText' | 'workspaceWriteText' | 'workspaceSaveTextAs' | 'workspaceReadImage',
): Result<ElectronAPI, AppError> {
  const api = requireElectronAPI()
  if (!api.ok) return api
  if (typeof api.value[name] !== 'function') {
    return err({
      code: 'API_UNAVAILABLE',
      message: `工作区宿主 API 未加载（缺少 ${name}）。请完全退出并重新运行 bun run dev`,
    })
  }
  return api
}

/**
 * 工作区连接 + 宿主操作 IPC 薄封装。
 *
 * - 连接面（connect/disconnect/status）：窗口绑定与代际由主进程可信
 *   sender 归属，推送经 workspace-store 的 generation 守卫写回（T6）。
 * - 操作面（B2/B3：readText/writeText/saveTextAs/readImage/search）：
 *   local 传 filePath；远端传 workspaceId + relativePath。有返回值调用
 *   一律 Result；用户取消 CANCELLED；断线 REMOTE_NOT_CONNECTED
 *   （调用方保留 buffer，不误报成功）。
 */
export const workspaceApi = {
  /** 绑定当前窗口到本机工作区宿主（返回描述符/代际/状态） */
  async connect(payload: WorkspaceConnectPayload): Promise<Result<WorkspaceConnectResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.connectWorkspace !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: '工作区连接 API 不可用' })
    }
    return api.value.connectWorkspace(payload)
  },

  /** 解绑当前窗口工作区并停止监听 */
  async disconnect(): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.disconnectWorkspace !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: '工作区连接 API 不可用' })
    }
    return api.value.disconnectWorkspace()
  },

  /** 查询当前窗口工作区绑定状态 */
  async getStatus(): Promise<Result<WindowWorkspaceStatus, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.getWorkspaceStatus !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: '工作区连接 API 不可用' })
    }
    return api.value.getWorkspaceStatus()
  },

  /** 工作区连接状态变化；返回取消订阅 */
  onStatusChanged(
    callback: (status: WindowWorkspaceStatus) => void,
  ): (() => void) | undefined {
    const api = window.electronAPI
    if (!api || typeof api.onWorkspaceStatusChanged !== 'function') return undefined
    return api.onWorkspaceStatusChanged(callback)
  },

  /** 经宿主读文本（返回 revision；保存时携带做冲突检查，T5） */
  async readText(payload: WorkspaceHostReadRequest): Promise<Result<WorkspaceHostReadResult, AppError>> {
    const api = requireWorkspaceHostAPI('workspaceReadText')
    if (!api.ok) return api
    return api.value.workspaceReadText(payload)
  },

  /** 经宿主写文本（expectedRevision 不一致报 REVISION_CONFLICT，不盲覆盖） */
  async writeText(
    payload: WorkspaceHostWriteRequest,
  ): Promise<Result<WorkspaceHostWriteResult, AppError>> {
    const api = requireWorkspaceHostAPI('workspaceWriteText')
    if (!api.ok) return api
    return api.value.workspaceWriteText(payload)
  },

  /** 远端另存为（远端目录选择语义；本机回落对话框流程） */
  async saveTextAs(
    payload: WorkspaceHostSaveAsRequest,
  ): Promise<Result<WorkspaceHostSaveAsResult, AppError>> {
    const api = requireWorkspaceHostAPI('workspaceSaveTextAs')
    if (!api.ok) return api
    return api.value.workspaceSaveTextAs(payload)
  },

  /** 经宿主读图片（相对预览图片经宿主，不拼 UNC） */
  async readImage(payload: WorkspaceHostTextRef): Promise<Result<ReadImageResult, AppError>> {
    const api = requireWorkspaceHostAPI('workspaceReadImage')
    if (!api.ok) return api
    return api.value.workspaceReadImage(payload)
  },

  /**
   * B3 可取消分页搜索：AbortSignal 触发时不再等待、不再写缓存，
   * 调用方凭代际丢弃迟到响应（T6）。取消返回 CANCELLED（不弹错误）。
   */
  searchMarkdownAbortable(
    payload: WorkspaceSearchMarkdownPayload,
    signal?: AbortSignal,
  ): { promise: Promise<Result<WorkspaceSearchMarkdownResult, AppError>>; cancel: () => void } {
    let cancelled = false
    const onAbort = (): void => {
      cancelled = true
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const promise = (async (): Promise<Result<WorkspaceSearchMarkdownResult, AppError>> => {
      try {
        const api = requireElectronAPI()
        if (!api.ok) return api
        if (typeof api.value.searchWorkspaceMarkdown !== 'function') {
          return err({ code: 'API_UNAVAILABLE', message: '工作区检索 API 不可用' })
        }
        if (cancelled || signal?.aborted) {
          return err({ code: 'CANCELLED', message: '检索已取消' })
        }
        const result = await api.value.searchWorkspaceMarkdown(payload)
        if (cancelled || signal?.aborted) {
          return err({ code: 'CANCELLED', message: '检索已取消' })
        }
        return result
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    })()
    return {
      promise,
      cancel: () => {
        cancelled = true
      },
    }
  },
}

export { isCancelled }

/**
 * P1 裸路径 → 宿主引用：窗口已绑定非本机工作区，且路径呈工作区相对形
 * （非盘符/UNC/绝对路径）时走 workspaceId + relativePath，直达远端会话；
 * 其余沿本机 filePath（本机模式零行为变化）。
 */
export function toHostTextRef(
  workspaceId: string | undefined,
  path: string,
): WorkspaceHostReadRequest {
  if (!isLocalWorkspaceId(workspaceId) && workspaceId) {
    const forward = path.replace(/\\/g, '/')
    const absolute =
      forward.startsWith('/') ||
      /^[A-Za-z]:(\/|$)/.test(forward) ||
      /^\\\\/.test(path) ||
      forward.startsWith('//')
    if (!absolute && forward.trim()) {
      return { workspaceId, relativePath: forward.trim() }
    }
  }
  return { filePath: path }
}
