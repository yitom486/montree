import type {
  AiSessionGetPayload,
  AiSessionPutPayload,
  AiSessionRecord,
  AiSessionTouchPayload,
} from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'

function requireElectronAPI() {
  if (!window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE' as const,
      message: 'Electron API 不可用',
    })
  }
  return ok(window.electronAPI)
}

/** AI 会话指针（一书一会话）：行存取，轮转决策在调用方 */
export const aiSessionApi = {
  async get(payload: AiSessionGetPayload): Promise<Result<AiSessionRecord | null, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.getAiSession(payload)
  },

  async put(payload: AiSessionPutPayload): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.putAiSession(payload)
  },

  async touch(payload: AiSessionTouchPayload): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.touchAiSession(payload)
  },
}
