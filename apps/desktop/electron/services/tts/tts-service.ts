import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { azureProvider, geminiProvider, localProvider } from 'gemini-tts-studio/server'
import { err, ok, toAppError, type AppError, type Result } from '@montree/contracts'
import type {
  TtsCacheStats,
  TtsConfig,
  TtsSynthesizePayload,
  TtsSynthesizeResult,
  TtsTestKeyPayload,
  TtsTestKeyResult,
} from '@montree/contracts'

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  enabled: true,
  provider: 'gemini',
  primaryApiKey: '',
  secondaryApiKey: '',
  voiceName: 'Aoede',
  voiceNameMale: 'Puck',
  voiceNameFemale: 'Aoede',
  modelId: 'gemini-3.8-flash-tts',
  azureApiKey: '',
  azureRegion: 'eastasia',
  azureVoice: 'zh-CN-XiaoxiaoNeural',
  localEndpoint: 'http://127.0.0.1:8880/v1',
  localApiKey: '',
  localModel: 'kokoro',
  localVoice: 'zh-female',
  rate: 1.0,
  saveAudioCache: true,
  filterFootnotesAndCitations: true,
  filterLinksAndTechnicalMarkup: true,
}

let primaryCooldownUntil = 0

function getConfigFilePath(): string {
  return join(app.getPath('userData'), 'tts-config.json')
}

function getCacheDirPath(): string {
  return join(app.getPath('userData'), 'tts-cache')
}

export function resolveTtsModelId(modelId?: string): string {
  const clean = (modelId || '').trim()
  if (!clean || clean.includes('gemini-2.5') || clean.includes('gemini-1.5') || !clean.includes('gemini-')) {
    return 'gemini-3.8-flash-tts'
  }
  return clean
}

export function formatFriendlyErrorMessage(raw: unknown): string {
  if (!raw) return '未知错误'
  const str = typeof raw === 'string' ? raw : (raw as Error).message || String(raw)

  // 1. 尝试提取嵌套的 JSON 结构（如 {"error": {"code": 400, "message": "..."}}）
  try {
    const match = str.match(/\{[\s\S]*"error"[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      const msg = parsed?.error?.message || ''
      const code = parsed?.error?.code
      const status = parsed?.error?.status

      if (msg.includes('This model only supports text output') || msg.includes('supports text output')) {
        return '当前模型为纯文本模型，不支持语音输出。已自动为您切换为官方语音模型 gemini-3.8-flash-tts，请重试。'
      }
      if (code === 400 && msg.includes('API key not valid')) {
        return 'API Key 格式或内容无效，请检查输入的密钥。'
      }
      if (code === 403 || status === 'PERMISSION_DENIED') {
        return 'API Key 权限受限或当前项目未开启 Generative Language API。'
      }
      if (code === 429 || status === 'RESOURCE_EXHAUSTED' || msg.includes('Quota')) {
        return '已触发 Google API 频率限制或配额耗尽（429）。建议配置备用 Key 启用自动容灾。'
      }
      if (msg) {
        return msg
      }
    }
  } catch {}

  // 2. 纯文本特征匹配
  if (str.includes('This model only supports text output') || str.includes('supports text output')) {
    return '当前模型为纯文本模型，不支持语音输出。推荐使用官方语音模型 gemini-3.8-flash-tts。'
  }
  if (str.includes('API key not valid') || str.includes('API_KEY_INVALID')) {
    return 'API Key 无效，请核对后重新填写。'
  }
  if (str.includes('RESOURCE_EXHAUSTED') || str.includes('429') || str.toLowerCase().includes('quota')) {
    return 'API 配额超限或触发调用频率限制（429）。'
  }
  if (str.includes('ENOTFOUND') || str.includes('ECONNREFUSED') || str.includes('ETIMEDOUT') || str.includes('fetch failed')) {
    return '网络连接失败，请检查网络代理与网络通畅情况。'
  }

  return str
}

export async function readTtsConfig(): Promise<Result<TtsConfig, AppError>> {
  try {
    const filePath = getConfigFilePath()
    const content = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<TtsConfig>
    return ok({
      ...DEFAULT_TTS_CONFIG,
      ...parsed,
      modelId: resolveTtsModelId(parsed.modelId),
    })
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
      return ok({ ...DEFAULT_TTS_CONFIG })
    }
    return err(toAppError(cause, '读取 TTS 语音配置失败'))
  }
}

export async function writeTtsConfig(config: TtsConfig): Promise<Result<void, AppError>> {
  try {
    const filePath = getConfigFilePath()
    await mkdir(app.getPath('userData'), { recursive: true })
    const sanitizedConfig = {
      ...config,
      modelId: resolveTtsModelId(config.modelId),
    }
    await writeFile(filePath, `${JSON.stringify(sanitizedConfig, null, 2)}\n`, 'utf-8')
    return ok(undefined)
  } catch (cause) {
    return err(toAppError(cause, '保存 TTS 语音配置失败'))
  }
}

export function isRateLimitOrQuotaError(error: unknown): boolean {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  const status = String((error as { status?: unknown })?.status ?? '')
  const code = String((error as { code?: unknown })?.code ?? '')
  return (
    status === '429' ||
    code === '429' ||
    code === 'RESOURCE_EXHAUSTED' ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('rate limit')
  )
}

function buildCacheKey(payload: {
  text: string
  voiceName: string
  modelId: string
  rate: number
}): string {
  const normText = payload.text.trim()
  const raw = `${normText}::${payload.voiceName}::${payload.modelId}::${payload.rate}`
  return createHash('sha256').update(raw).digest('hex')
}

async function invokeGeminiTTS(params: {
  apiKey: string
  text: string
  voiceName: string
  modelId: string
}): Promise<{ audioBase64: string; mimeType: string }> {
  const { apiKey, text, voiceName } = params
  if (!apiKey.trim()) {
    throw new Error('未配置 Gemini API Key')
  }

  const cleanText = text.trim()
  const cleanVoice = voiceName.trim() || 'Aoede'
  const primaryModel = resolveTtsModelId(params.modelId)

  const trySynthesize = async (model: string) => {
    const chunks: string[] = []
    let detectedMime = 'audio/L16;codec=pcm;rate=24000'
    try {
      if (geminiProvider.synthesizeStream) {
        const res = await geminiProvider.synthesizeStream(
          {
            text: cleanText,
            voiceName: cleanVoice,
            model,
          },
          apiKey.trim(),
          ({ audioBase64, mimeType }: { audioBase64: string; mimeType: string }) => {
            if (audioBase64) chunks.push(audioBase64)
            if (mimeType) detectedMime = mimeType
          },
        )
        if (res?.mimeType) detectedMime = res.mimeType
      } else {
        throw new Error('当前 geminiProvider 未提供 synthesizeStream')
      }
    } catch {
      const single = await geminiProvider.synthesize(
        {
          text: cleanText,
          voiceName: cleanVoice,
          model,
        },
        apiKey.trim(),
      )
      return {
        audioBase64: single.audioBuffer ? single.audioBuffer.toString('base64') : '',
        mimeType: single.mimeType || 'audio/wav',
      }
    }

    if (chunks.length === 0) {
      throw new Error('Gemini TTS 未返回任何音频数据')
    }

    // 将收集到的 base64 PCM 分片拼装为标准 24kHz 单声道 WAV 格式
    const bytesList = chunks.map((b) => Buffer.from(b, 'base64'))
    const totalPcmBytes = bytesList.reduce((acc, cur) => acc + cur.length, 0)
    const wavBuffer = Buffer.alloc(44 + totalPcmBytes)
    wavBuffer.write('RIFF', 0)
    wavBuffer.writeUInt32LE(36 + totalPcmBytes, 4)
    wavBuffer.write('WAVE', 8)
    wavBuffer.write('fmt ', 12)
    wavBuffer.writeUInt32LE(16, 16)
    wavBuffer.writeUInt16LE(1, 20)
    wavBuffer.writeUInt16LE(1, 22)
    wavBuffer.writeUInt32LE(24000, 24)
    wavBuffer.writeUInt32LE(48000, 28)
    wavBuffer.writeUInt16LE(2, 32)
    wavBuffer.writeUInt16LE(16, 34)
    wavBuffer.write('data', 36)
    wavBuffer.writeUInt32LE(totalPcmBytes, 40)

    let offset = 44
    for (const b of bytesList) {
      b.copy(wavBuffer, offset)
      offset += b.length
    }

    return {
      audioBase64: wavBuffer.toString('base64'),
      mimeType: 'audio/wav',
    }
  }

  try {
    return await trySynthesize(primaryModel)
  } catch (err: any) {
    const errMsg = String(err?.message || err)
    if (errMsg.includes('This model only supports text output') || errMsg.includes('supports text output')) {
      const fallbackModel = primaryModel !== 'gemini-3.8-flash-tts' ? 'gemini-3.8-flash-tts' : 'gemini-2.0-flash'
      try {
        return await trySynthesize(fallbackModel)
      } catch (fallbackErr) {
        throw new Error(formatFriendlyErrorMessage(fallbackErr))
      }
    }
    throw new Error(formatFriendlyErrorMessage(err))
  }
}

export async function synthesizeTts(
  payload: TtsSynthesizePayload,
): Promise<Result<TtsSynthesizeResult, AppError>> {
  try {
    const configRes = await readTtsConfig()
    const config = configRes.ok ? configRes.value : DEFAULT_TTS_CONFIG
    const activeProvider = payload.provider || config.provider || 'gemini'

    if (activeProvider === 'system' || activeProvider === 'default') {
      return ok({
        audioBase64: '',
        mimeType: 'audio/wav',
        fromCache: false,
        keyUsed: 'system',
      })
    }

    const text = payload.text.trim()
    if (!text) {
      return err({ code: 'INVALID_ARGUMENT', message: '朗读文本不能为空' })
    }

    const rate = payload.rate ?? config.rate ?? 1.0

    // ==================== 1. 微软 Azure Speech TTS ====================
    if (activeProvider === 'azure') {
      const azureKey = payload.azureApiKey?.trim() || config.azureApiKey?.trim() || ''
      const azureRegion = payload.azureRegion?.trim() || config.azureRegion?.trim() || 'eastasia'
      const azureVoice = payload.voiceName?.trim() || config.azureVoice?.trim() || 'zh-CN-XiaoxiaoNeural'

      if (!azureKey) {
        return ok({
          audioBase64: '',
          mimeType: 'audio/wav',
          fromCache: false,
          keyUsed: 'system',
        })
      }

      const cacheKey = buildCacheKey({ text, voiceName: `${azureRegion}:${azureVoice}`, modelId: 'azure', rate })
      const cacheDir = getCacheDirPath()
      const cacheFilePath = join(cacheDir, `${cacheKey}.wav`)

      if (config.saveAudioCache) {
        try {
          const cachedBuf = await readFile(cacheFilePath)
          if (cachedBuf.byteLength > 0) {
            return ok({
              audioBase64: cachedBuf.toString('base64'),
              mimeType: 'audio/wav',
              fromCache: true,
              keyUsed: 'primary',
            })
          }
        } catch {}
      }

      const res = await azureProvider.synthesize(
        {
          text,
          voiceName: azureVoice,
          region: azureRegion,
          speed: rate,
        },
        azureKey,
      )

      const audioBuf = res.audioBuffer
      if (config.saveAudioCache && audioBuf && audioBuf.byteLength > 0) {
        try {
          await mkdir(cacheDir, { recursive: true })
          await writeFile(cacheFilePath, audioBuf)
        } catch {}
      }

      return ok({
        audioBase64: audioBuf ? audioBuf.toString('base64') : '',
        mimeType: res.mimeType || 'audio/wav',
        fromCache: false,
        keyUsed: 'primary',
      })
    }

    // ==================== 2. 本地 OpenAI 兼容 TTS ====================
    if (activeProvider === 'local') {
      const endpoint = payload.localEndpoint?.trim() || config.localEndpoint?.trim() || 'http://127.0.0.1:8880/v1'
      const localKey = config.localApiKey?.trim() || ''
      const localModel = payload.modelId?.trim() || config.localModel?.trim() || 'kokoro'
      const localVoice = payload.voiceName?.trim() || config.localVoice?.trim() || 'zh-female'

      const res = await localProvider.synthesize(
        {
          text,
          voiceName: localVoice,
          model: localModel,
          endpoint,
          speed: rate,
        },
        localKey,
      )

      return ok({
        audioBase64: res.audioBuffer ? res.audioBuffer.toString('base64') : '',
        mimeType: res.mimeType || 'audio/wav',
        fromCache: false,
        keyUsed: 'primary',
      })
    }

    // ==================== 3. Google Gemini TTS ====================
    const voiceName = payload.voiceName || config.voiceName || 'Aoede'
    const modelId = payload.modelId || config.modelId || 'gemini-2.5-flash'

    const cacheKey = buildCacheKey({ text, voiceName, modelId, rate })
    const cacheDir = getCacheDirPath()
    const cacheFilePath = join(cacheDir, `${cacheKey}.wav`)

    // 1. 本地磁盘缓存检查
    if (config.saveAudioCache) {
      try {
        const cachedBuf = await readFile(cacheFilePath)
        if (cachedBuf.byteLength > 0) {
          return ok({
            audioBase64: cachedBuf.toString('base64'),
            mimeType: 'audio/wav',
            fromCache: true,
          })
        }
      } catch {}
    }

    // 2. 双 API Key 智能容灾与冷却调度
    const primaryKey = config.primaryApiKey?.trim() || ''
    const secondaryKey = config.secondaryApiKey?.trim() || ''

    if (!primaryKey && !secondaryKey) {
      return ok({
        audioBase64: '',
        mimeType: 'audio/wav',
        fromCache: false,
        keyUsed: 'system',
      })
    }

    const inCooldown = primaryCooldownUntil > Date.now()
    let chosenKey: string
    let keyUsed: 'primary' | 'secondary' = 'primary'

    if (payload.forceKeyType === 'secondary' && secondaryKey) {
      chosenKey = secondaryKey
      keyUsed = 'secondary'
    } else if (payload.forceKeyType === 'primary' && primaryKey) {
      chosenKey = primaryKey
      keyUsed = 'primary'
    } else if (inCooldown && secondaryKey) {
      chosenKey = secondaryKey
      keyUsed = 'secondary'
    } else if (primaryKey) {
      chosenKey = primaryKey
      keyUsed = 'primary'
    } else {
      chosenKey = secondaryKey
      keyUsed = 'secondary'
    }

    let audioData: { audioBase64: string; mimeType: string }
    let cooldownActivated = false

    try {
      audioData = await invokeGeminiTTS({
        apiKey: chosenKey,
        text,
        voiceName,
        modelId,
      })
      if (!inCooldown && keyUsed === 'primary') {
        primaryCooldownUntil = 0
      }
    } catch (firstErr) {
      if (keyUsed === 'primary' && secondaryKey && isRateLimitOrQuotaError(firstErr)) {
        primaryCooldownUntil = Date.now() + 60_000
        cooldownActivated = true
        keyUsed = 'secondary'
        try {
          audioData = await invokeGeminiTTS({
            apiKey: secondaryKey,
            text,
            voiceName,
            modelId,
          })
        } catch (secondErr) {
          return err(toAppError(secondErr, '主备 API Key 均请求失败'))
        }
      } else {
        return err(toAppError(firstErr, 'Gemini 语音合成失败'))
      }
    }

    // 3. 首次拉取落盘持久化
    if (config.saveAudioCache && audioData.audioBase64) {
      try {
        await mkdir(cacheDir, { recursive: true })
        const buf = Buffer.from(audioData.audioBase64, 'base64')
        await writeFile(cacheFilePath, buf)
      } catch (cacheErr) {
        console.warn('[TTS] 写入本地音频缓存失败:', cacheErr)
      }
    }

    return ok({
      audioBase64: audioData.audioBase64,
      mimeType: audioData.mimeType,
      fromCache: false,
      keyUsed,
      cooldownActivated,
    })
  } catch (cause) {
    const friendlyMsg = formatFriendlyErrorMessage(cause)
    return err({ code: 'UNKNOWN', message: friendlyMsg })
  }
}

export async function testTtsKey(
  payload: TtsTestKeyPayload,
): Promise<Result<TtsTestKeyResult, AppError>> {
  const startTime = Date.now()
  try {
    const key = payload.key?.trim()
    const provider = payload.provider || 'gemini'
    const testText = payload.text?.trim() || '你好，语音朗读测试成功。'

    if (provider === 'azure') {
      if (!key) {
        return err({ code: 'INVALID_ARGUMENT', message: 'Azure Speech Key 不能为空' })
      }
      const region = payload.region?.trim() || 'eastasia'
      const voiceName = payload.voiceName?.trim() || 'zh-CN-XiaoxiaoNeural'
      const res = await azureProvider.synthesize(
        {
          text: testText,
          voiceName,
          region,
        },
        key,
      )
      const latencyMs = Date.now() - startTime
      return ok({
        latencyMs,
        audioBase64: res.audioBuffer ? res.audioBuffer.toString('base64') : '',
        mimeType: res.mimeType || 'audio/wav',
      })
    }

    if (provider === 'local') {
      const endpoint = payload.endpoint?.trim() || 'http://127.0.0.1:8880/v1'
      const res = await localProvider.synthesize(
        {
          text: testText,
          endpoint,
          model: payload.modelId?.trim() || 'kokoro',
          voiceName: payload.voiceName?.trim() || 'zh-female',
        },
        key || '',
      )
      const latencyMs = Date.now() - startTime
      return ok({
        latencyMs,
        audioBase64: res.audioBuffer ? res.audioBuffer.toString('base64') : '',
        mimeType: res.mimeType || 'audio/wav',
      })
    }

    // 默认测试 Gemini API Key
    if (!key) {
      return err({ code: 'INVALID_ARGUMENT', message: 'Gemini API Key 不能为空' })
    }
    const voiceName = payload.voiceName?.trim() || 'Aoede'
    const modelId = resolveTtsModelId(payload.modelId)

    const result = await invokeGeminiTTS({
      apiKey: key,
      text: testText,
      voiceName,
      modelId,
    })

    const latencyMs = Date.now() - startTime
    return ok({
      latencyMs,
      audioBase64: result.audioBase64,
      mimeType: result.mimeType,
    })
  } catch (cause) {
    const friendlyMsg = formatFriendlyErrorMessage(cause)
    return err({ code: 'UNKNOWN', message: friendlyMsg })
  }
}

export async function getTtsCacheStats(): Promise<Result<TtsCacheStats, AppError>> {
  try {
    const cacheDir = getCacheDirPath()
    let count = 0
    let totalBytes = 0

    try {
      const files = await readdir(cacheDir)
      for (const file of files) {
        if (file.endsWith('.wav')) {
          const info = await stat(join(cacheDir, file))
          count++
          totalBytes += info.size
        }
      }
    } catch (cause: any) {
      if (cause?.code !== 'ENOENT') {
        throw cause
      }
    }

    return ok({ count, totalBytes })
  } catch (cause) {
    return err(toAppError(cause, '获取 TTS 缓存信息失败'))
  }
}

export async function clearTtsCache(): Promise<Result<void, AppError>> {
  try {
    const cacheDir = getCacheDirPath()
    try {
      const files = await readdir(cacheDir)
      for (const file of files) {
        if (file.endsWith('.wav')) {
          await unlink(join(cacheDir, file)).catch(() => {})
        }
      }
    } catch (cause: any) {
      if (cause?.code !== 'ENOENT') {
        throw cause
      }
    }
    return ok(undefined)
  } catch (cause) {
    return err(toAppError(cause, '清理 TTS 本地缓存失败'))
  }
}
