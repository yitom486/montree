import type {
  TtsCacheStats,
  TtsConfig,
  TtsSynthesizePayload,
  TtsSynthesizeResult,
  TtsTestKeyPayload,
  TtsTestKeyResult,
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
}
