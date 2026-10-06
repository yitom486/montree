import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import type { ElectronAPI } from '@montree/contracts'
import type {
  AcpAuthPreflightPayload,
  AcpAuthPreflightResult,
  AcpAuthenticatePayload,
  AcpCancelPayload,
  AcpConnectPayload,
  AcpConnectResult,
  AcpLoadSessionPayload,
  AcpPermissionRequestEvent,
  AcpPermissionResponsePayload,
  AcpSnapshotRequestEvent,
  AcpSnapshotResponsePayload,
  AcpPromptPayload,
  AcpPromptResult,
  AcpRuntimeInfo,
  AcpSessionNewPayload,
  AcpSessionNewResult,
  AcpSessionUpdateEvent,
  AcpSetConfigOptionPayload,
  AcpSetConfigOptionResult,
  AcpProviderSavePayload,
  AcpProviderStatus,
  AcpProxySettings,
  AcpStatusChangedEvent,
  AgyCliStatus,
} from '@montree/contracts'

function requireElectronAPI(): Result<ElectronAPI, AppError> {
  if (!window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE',
      message: 'Electron API 不可用，请重启应用后重试',
    })
  }
  return ok(window.electronAPI)
}

/** preload 未热更新时，旧 electronAPI 缺少 ACP 方法；避免 TypeError 炸整页 */
function hasAcpBridge(api: ElectronAPI): boolean {
  return (
    typeof api.onAcpPermissionRequest === 'function' &&
    typeof api.onAcpSessionUpdate === 'function' &&
    typeof api.onAcpStatusChanged === 'function' &&
    typeof api.acpConnect === 'function'
  )
}

function requireAcpBridge(): Result<ElectronAPI, AppError> {
  const api = requireElectronAPI()
  if (!api.ok) return api
  if (!hasAcpBridge(api.value)) {
    return err({
      code: 'API_UNAVAILABLE',
      message: 'ACP 桥接未就绪（请完全重启 bun run dev，勿仅刷新页面）',
    })
  }
  return api
}

export const acpApi = {
  async listRuntimes(): Promise<Result<AcpRuntimeInfo[], AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    return api.value.listAcpRuntimes()
  },

  async authPreflight(
    payload?: AcpAuthPreflightPayload,
  ): Promise<Result<AcpAuthPreflightResult, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    if (typeof api.value.acpAuthPreflight !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'ACP auth preflight 未就绪（请完全重启 bun run dev）',
      })
    }
    return api.value.acpAuthPreflight(payload)
  },

  async connect(payload: AcpConnectPayload): Promise<Result<AcpConnectResult, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    return api.value.acpConnect(payload)
  },

  async authenticate(
    payload: AcpAuthenticatePayload,
  ): Promise<Result<Extract<AcpConnectResult, { phase: 'ready' }>, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    if (typeof api.value.acpAuthenticate !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'ACP authenticate 未就绪（请完全重启 bun run dev）',
      })
    }
    return api.value.acpAuthenticate(payload)
  },

  async loadSession(payload: AcpLoadSessionPayload): Promise<Result<AcpSessionNewResult, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    if (typeof api.value.acpLoadSession !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'ACP loadSession 未就绪（请完全重启 bun run dev）',
      })
    }
    return api.value.acpLoadSession(payload)
  },

  async disconnect(): Promise<Result<void, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    return api.value.acpDisconnect()
  },

  async sessionNew(payload: AcpSessionNewPayload): Promise<Result<AcpSessionNewResult, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    return api.value.acpSessionNew(payload)
  },

  async prompt(payload: AcpPromptPayload): Promise<Result<AcpPromptResult, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    return api.value.acpPrompt(payload)
  },

  async cancel(payload: AcpCancelPayload): Promise<Result<void, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    return api.value.acpCancel(payload)
  },

  async setConfigOption(
    payload: AcpSetConfigOptionPayload,
  ): Promise<Result<AcpSetConfigOptionResult, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    return api.value.acpSetConfigOption(payload)
  },

  async getProvider(): Promise<Result<AcpProviderStatus, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    if (typeof api.value.getAcpProvider !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: '自定义 API 配置接口未就绪（请完全重启 bun run dev）',
      })
    }
    return api.value.getAcpProvider()
  },

  async saveProvider(
    payload: AcpProviderSavePayload,
  ): Promise<Result<AcpProviderStatus, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    if (typeof api.value.saveAcpProvider !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: '自定义 API 配置接口未就绪（请完全重启 bun run dev）',
      })
    }
    return api.value.saveAcpProvider(payload)
  },

  async clearProvider(): Promise<Result<void, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    if (typeof api.value.clearAcpProvider !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: '自定义 API 配置接口未就绪（请完全重启 bun run dev）',
      })
    }
    return api.value.clearAcpProvider()
  },

  async getProxySettings(): Promise<Result<AcpProxySettings, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    if (typeof api.value.getAcpProxySettings !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'ACP 代理设置接口未就绪（请完全重启 bun run dev）',
      })
    }
    return api.value.getAcpProxySettings()
  },

  async saveProxySettings(
    payload: AcpProxySettings,
  ): Promise<Result<AcpProxySettings, AppError>> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    if (typeof api.value.saveAcpProxySettings !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'ACP 代理设置接口未就绪（请完全重启 bun run dev）',
      })
    }
    return api.value.saveAcpProxySettings(payload)
  },

  respondPermission(payload: AcpPermissionResponsePayload): Result<void, AppError> {
    const api = requireAcpBridge()
    if (!api.ok) return api
    api.value.acpRespondPermission(payload)
    return ok(undefined)
  },

  onSessionUpdate(callback: (event: AcpSessionUpdateEvent) => void): () => void {
    const api = requireAcpBridge()
    if (!api.ok) return () => undefined
    return api.value.onAcpSessionUpdate(callback)
  },

  onStatusChanged(callback: (event: AcpStatusChangedEvent) => void): () => void {
    const api = requireAcpBridge()
    if (!api.ok) return () => undefined
    return api.value.onAcpStatusChanged(callback)
  },

  onPermissionRequest(
    callback: (event: AcpPermissionRequestEvent & { summary?: string }) => void,
  ): () => void {
    const api = requireAcpBridge()
    if (!api.ok) return () => undefined
    return api.value.onAcpPermissionRequest(callback)
  },

  onSnapshotRequest(callback: (event: AcpSnapshotRequestEvent) => void): () => void {
    const api = requireAcpBridge()
    if (!api.ok || typeof api.value.onAcpSnapshotRequest !== 'function') return () => undefined
    return api.value.onAcpSnapshotRequest(callback)
  },

  respondSnapshot(payload: AcpSnapshotResponsePayload): void {
    const api = requireAcpBridge()
    if (!api.ok || typeof api.value.acpRespondSnapshot !== 'function') return
    api.value.acpRespondSnapshot(payload)
  },

  async probeAgyCli(): Promise<Result<AgyCliStatus, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.probeAgyCli !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'Antigravity CLI 探测接口未就绪（请完全重启应用）',
      })
    }
    return api.value.probeAgyCli()
  },

  async installAgyCli(): Promise<Result<AgyCliStatus, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.installAgyCli !== 'function') {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'Antigravity CLI 安装接口未就绪（请完全重启应用）',
      })
    }
    return api.value.installAgyCli()
  },
}
