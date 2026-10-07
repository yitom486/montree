import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TTS_CONFIG,
  formatFriendlyErrorMessage,
  isRateLimitOrQuotaError,
  resolveTtsModelId,
} from './tts-service'

describe('tts-service', () => {
  it('应当提供合理的默认 TTS 配置', () => {
    expect(DEFAULT_TTS_CONFIG.enabled).toBe(true)
    expect(DEFAULT_TTS_CONFIG.provider).toBe('gemini')
    expect(DEFAULT_TTS_CONFIG.voiceName).toBe('Aoede')
    expect(DEFAULT_TTS_CONFIG.voiceNameMale).toBe('Puck')
    expect(DEFAULT_TTS_CONFIG.voiceNameFemale).toBe('Aoede')
    expect(DEFAULT_TTS_CONFIG.modelId).toBe('gemini-3.8-flash-lite-tts')
    expect(DEFAULT_TTS_CONFIG.saveAudioCache).toBe(true)
  })

  it('应当自动将纯文本模型纠正为语音专属模型', () => {
    expect(resolveTtsModelId('gemini-2.5-flash')).toBe('gemini-3.8-flash-lite-tts')
    expect(resolveTtsModelId('gemini-1.5-pro')).toBe('gemini-3.8-flash-lite-tts')
    expect(resolveTtsModelId('')).toBe('gemini-3.8-flash-lite-tts')
    expect(resolveTtsModelId('gemini-2.0-flash')).toBe('gemini-2.0-flash')
    expect(resolveTtsModelId('gemini-3.8-flash-tts')).toBe('gemini-3.8-flash-tts')
  })

  it('应当将底层复杂或 JSON 报错转化为友好清晰的中文提示', () => {
    const rawJson = '{"error":{"code":400,"message":"This model only supports text output.","status":"INVALID_ARGUMENT"}}'
    expect(formatFriendlyErrorMessage(rawJson)).toContain('当前模型为纯文本模型，不支持语音输出')

    const authJson = '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'
    expect(formatFriendlyErrorMessage(authJson)).toContain('API Key 格式或内容无效')
  })

  it('应当准确识别 Google 429、配额耗尽与限流错误', () => {
    expect(isRateLimitOrQuotaError({ status: 429 })).toBe(true)
    expect(isRateLimitOrQuotaError({ code: 429 })).toBe(true)
    expect(isRateLimitOrQuotaError({ code: 'RESOURCE_EXHAUSTED' })).toBe(true)
    expect(isRateLimitOrQuotaError(new Error('Quota exceeded for quota metric...'))).toBe(true)
    expect(isRateLimitOrQuotaError(new Error('429 Too Many Requests'))).toBe(true)
    expect(isRateLimitOrQuotaError(new Error('rate limit reached: 15 RPM'))).toBe(true)

    // 非 429 错误不应误报
    expect(isRateLimitOrQuotaError(new Error('Invalid API key'))).toBe(false)
    expect(isRateLimitOrQuotaError(new Error('Network timeout'))).toBe(false)
    expect(isRateLimitOrQuotaError(null)).toBe(false)
  })
})
