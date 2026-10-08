import type {
  TtsBatchCreatePayload,
  TtsBatchJobStatus,
  TtsCacheStats,
  TtsConfig,
  TtsRemoteModelItem,
  TtsSynthesizePayload,
  TtsSynthesizeResult,
  TtsTestKeyPayload,
  TtsTestKeyResult,
  TtsVoiceInfo,
  TtsStreamChunkPayload,
  TtsStreamProgressPayload,
  TtsStreamEndPayload,
  TtsStreamErrorPayload,
} from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'

function requireElectronAPI() {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE' as const,
      message: 'Electron API 不可用',
    })
  }
  return ok(window.electronAPI)
}

export const ttsApi = {
  async getConfig(): Promise<Result<TtsConfig, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.getTtsConfig !== 'function') {
      return ok({
        enabled: true,
        provider: 'gemini',
        primaryApiKey: '',
        secondaryApiKey: '',
        voiceName: 'Aoede',
        voiceNameMale: 'Puck',
        voiceNameFemale: 'Aoede',
        modelId: 'gemini-2.5-flash',
        azureApiKey: '',
        azureRegion: 'eastasia',
        azureVoice: 'zh-CN-XiaoxiaoNeural',
        localEndpoint: 'http://127.0.0.1:8880/v1',
        localApiKey: '',
        localModel: 'kokoro',
        localVoice: 'zh-female',
        rate: 1.0,
        saveAudioCache: true,
      })
    }
    try {
      return await api.value.getTtsConfig()
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '读取 TTS 配置失败' })
    }
  },

  async saveConfig(config: TtsConfig): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.saveTtsConfig !== 'function') {
      console.warn('[TTS] 当前运行的 Electron 进程未重载 preload API，请重启桌面端以生效')
      return ok(undefined)
    }
    try {
      return await api.value.saveTtsConfig(config)
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '保存 TTS 配置失败' })
    }
  },

  async synthesize(payload: TtsSynthesizePayload): Promise<Result<TtsSynthesizeResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.synthesizeTts !== 'function') {
      return err({
        code: 'API_UNAVAILABLE' as const,
        message: 'TTS 合成服务尚未加载，请重启应用',
      })
    }
    try {
      return await api.value.synthesizeTts(payload)
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || 'TTS 合成调用失败' })
    }
  },

  synthesizeStream(
    payload: TtsSynthesizePayload & { streamId: string },
    callbacks: {
      onChunk?: (chunk: TtsStreamChunkPayload) => void
      onProgress?: (progress: TtsStreamProgressPayload) => void
      onEnd?: (end: TtsStreamEndPayload) => void
      onError?: (err: TtsStreamErrorPayload) => void
    },
  ): {
    cancel: () => Promise<Result<void, AppError>>
    promise: Promise<Result<{ started: boolean; fromCache?: boolean; cachedResult?: TtsSynthesizeResult }, AppError>>
  } {
    const api = requireElectronAPI()
    if (!api.ok) {
      return {
        cancel: async () => ok(undefined),
        promise: Promise.resolve(api),
      }
    }

    const unsubs: Array<() => void> = []

    const cleanup = () => {
      while (unsubs.length) {
        try {
          unsubs.pop()?.()
        } catch {}
      }
    }

    if (callbacks.onProgress && typeof api.value.onTtsStreamProgress === 'function') {
      unsubs.push(api.value.onTtsStreamProgress((progress) => {
        if (progress.streamId === payload.streamId) callbacks.onProgress?.(progress)
      }))
    }

    if (callbacks.onChunk && typeof api.value.onTtsStreamChunk === 'function') {
      unsubs.push(
        api.value.onTtsStreamChunk((chunk) => {
          if (chunk.streamId === payload.streamId) {
            callbacks.onChunk?.(chunk)
          }
        }),
      )
    }

    if (callbacks.onEnd && typeof api.value.onTtsStreamEnd === 'function') {
      unsubs.push(
        api.value.onTtsStreamEnd((end) => {
          if (end.streamId === payload.streamId) {
            cleanup()
            callbacks.onEnd?.(end)
          }
        }),
      )
    }

    if (callbacks.onError && typeof api.value.onTtsStreamError === 'function') {
      unsubs.push(
        api.value.onTtsStreamError((errPayload) => {
          if (errPayload.streamId === payload.streamId) {
            cleanup()
            callbacks.onError?.(errPayload)
          }
        }),
      )
    }

    const cancel = async () => {
      cleanup()
      if (typeof api.value.cancelTtsStream === 'function') {
        return await api.value.cancelTtsStream(payload.streamId)
      }
      return ok(undefined)
    }

    const promise = (async () => {
      try {
        if (typeof api.value.synthesizeTtsStream !== 'function') {
          cleanup()
          return err({
            code: 'API_UNAVAILABLE' as const,
            message: '流式 TTS 合成服务尚未加载，请重启应用',
          })
        }
        const res = await api.value.synthesizeTtsStream(payload)
        if (!res.ok) cleanup()
        return res
      } catch (cause: any) {
        cleanup()
        return err({ code: 'API_UNAVAILABLE' as const, message: cause?.message || 'TTS 流式合成调用失败' })
      }
    })()

    return { cancel, promise }
  },

  async cancelStream(streamId: string): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.cancelTtsStream !== 'function') return ok(undefined)
    try {
      return await api.value.cancelTtsStream(streamId)
    } catch {
      return ok(undefined)
    }
  },

  async testKey(payload: TtsTestKeyPayload): Promise<Result<TtsTestKeyResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.testTtsKey !== 'function') {
      return err({
        code: 'API_UNAVAILABLE' as const,
        message: 'TTS 测试服务尚未加载，请重启应用',
      })
    }
    try {
      return await api.value.testTtsKey(payload)
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '测试 API Key 失败' })
    }
  },

  async getCacheStats(): Promise<Result<TtsCacheStats, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.getTtsCacheStats !== 'function') {
      return ok({ count: 0, totalBytes: 0 })
    }
    try {
      return await api.value.getTtsCacheStats()
    } catch {
      return ok({ count: 0, totalBytes: 0 })
    }
  },

  async clearCache(): Promise<Result<void, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.clearTtsCache !== 'function') {
      return ok(undefined)
    }
    try {
      return await api.value.clearTtsCache()
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '清空缓存失败' })
    }
  },

  async listModels(apiKey?: string): Promise<Result<TtsRemoteModelItem[], AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.listTtsModels !== 'function') {
      return ok([])
    }
    try {
      return await api.value.listTtsModels(apiKey)
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '拉取语音模型列表失败' })
    }
  },

  async listVoices(
    provider?: string,
    apiKey?: string,
    region?: string,
  ): Promise<Result<TtsVoiceInfo[], AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.listTtsVoices !== 'function') {
      return ok([])
    }
    try {
      return await api.value.listTtsVoices(provider, apiKey, region)
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '拉取发音人列表失败' })
    }
  },

  async createBatchJob(
    payload: TtsBatchCreatePayload,
  ): Promise<Result<TtsBatchJobStatus, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.createTtsBatchJob !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: '批量语音服务未加载，请重启应用' })
    }
    try {
      return await api.value.createTtsBatchJob(payload)
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '创建批量语音任务失败' })
    }
  },

  async getBatchJob(
    name: string,
    apiKey?: string,
  ): Promise<Result<TtsBatchJobStatus, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.getTtsBatchJob !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: '批量语音服务未加载，请重启应用' })
    }
    try {
      return await api.value.getTtsBatchJob(name, apiKey)
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '查询批量语音任务失败' })
    }
  },

  async cancelBatchJob(
    name: string,
    apiKey?: string,
  ): Promise<Result<{ name: string; cancelled: boolean }, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    if (typeof api.value.cancelTtsBatchJob !== 'function') {
      return err({ code: 'API_UNAVAILABLE', message: '批量语音服务未加载，请重启应用' })
    }
    try {
      return await api.value.cancelTtsBatchJob(name, apiKey)
    } catch (cause: any) {
      return err({ code: 'API_UNAVAILABLE', message: cause?.message || '取消批量任务失败' })
    }
  },
}
