import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { azureProvider, geminiProvider, localProvider, prettyApiError } from 'gemini-tts-studio/server'
import { IPC, err, ok, toAppError, type AppError, type Result } from '@montree/contracts'
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
} from '@montree/contracts'

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  enabled: true,
  provider: 'gemini',
  primaryApiKey: '',
  secondaryApiKey: '',
  voiceName: geminiProvider.defaultVoice || 'Aoede',
  voiceNameMale: 'Puck',
  voiceNameFemale: 'Aoede',
  modelId: geminiProvider.defaultModel || 'gemini-3.8-flash-lite-tts',
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
  if (
    !clean ||
    clean === 'gemini-2.5-flash' ||
    clean === 'gemini-1.5-pro' ||
    clean === 'gemini-1.5-flash' ||
    clean === 'gemini-pro'
  ) {
    return geminiProvider.defaultModel || 'gemini-3.8-flash-lite-tts'
  }
  return clean
}

export function formatFriendlyErrorMessage(raw: unknown): string {
  if (!raw) return '未知错误'
  const str = typeof raw === 'string' ? raw : (raw as Error).message || String(raw)
  const cleaned = prettyApiError(str)
  if (cleaned.includes('This model only supports text output') || cleaned.includes('supports text output')) {
    return '当前模型为纯文本模型，不支持语音输出。已自动为您切换为官方语音模型，请重试。'
  }
  if (cleaned.includes('API key not valid') || cleaned.includes('API_KEY_INVALID')) {
    return 'API Key 格式或内容无效，请检查输入的密钥。'
  }
  return cleaned
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
      const fallbackModel = primaryModel !== 'gemini-3.8-flash-lite-tts' ? 'gemini-3.8-flash-lite-tts' : 'gemini-3.8-flash-tts'
      try {
        return await trySynthesize(fallbackModel)
      } catch (fallbackErr) {
        throw new Error(formatFriendlyErrorMessage(fallbackErr))
      }
    }
    if (primaryModel === 'gemini-3.8-flash-tts' && isRateLimitOrQuotaError(err)) {
      try {
        return await trySynthesize('gemini-3.8-flash-lite-tts')
      } catch (liteErr) {
        throw new Error(formatFriendlyErrorMessage(liteErr))
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
        return err({
          code: 'INVALID_ARGUMENT',
          message: '未配置 Azure Speech Key，请在设置中填入有效密钥后重试',
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
      const localKey = payload.localApiKey?.trim() || config.localApiKey?.trim() || ''
      const localModel = payload.localModel?.trim() || payload.modelId?.trim() || config.localModel?.trim() || 'kokoro'
      const localVoice = payload.localVoice?.trim() || payload.voiceName?.trim() || config.localVoice?.trim() || 'zh-female'

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
    const modelId = resolveTtsModelId(payload.modelId || config.modelId)

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
    const primaryKey = payload.primaryApiKey?.trim() || config.primaryApiKey?.trim() || ''
    const secondaryKey = payload.secondaryApiKey?.trim() || config.secondaryApiKey?.trim() || ''

    if (!primaryKey && !secondaryKey) {
      return err({
        code: 'INVALID_ARGUMENT',
        message: '未配置 Gemini API Key，请在设置中填入有效密钥后重试',
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

function parsePcmRate(mimeType?: string | null): number {
  if (!mimeType) return 24000
  const m = /rate\s*=\s*(\d+)/i.exec(mimeType)
  if (m && m[1]) {
    const rate = parseInt(m[1], 10)
    if (Number.isFinite(rate) && rate >= 8000 && rate <= 96000) return rate
  }
  return 24000
}

function pcmChunksToWavBuffer(chunks: Buffer[], sampleRate = 24000): Buffer {
  const totalPcmBytes = chunks.reduce((acc, cur) => acc + cur.length, 0)
  const wavBuffer = Buffer.alloc(44 + totalPcmBytes)
  wavBuffer.write('RIFF', 0)
  wavBuffer.writeUInt32LE(36 + totalPcmBytes, 4)
  wavBuffer.write('WAVE', 8)
  wavBuffer.write('fmt ', 12)
  wavBuffer.writeUInt32LE(16, 16)
  wavBuffer.writeUInt16LE(1, 20)
  wavBuffer.writeUInt16LE(1, 22)
  wavBuffer.writeUInt32LE(sampleRate, 24)
  wavBuffer.writeUInt32LE(sampleRate * 2, 28)
  wavBuffer.writeUInt16LE(2, 32)
  wavBuffer.writeUInt16LE(16, 34)
  wavBuffer.write('data', 36)
  wavBuffer.writeUInt32LE(totalPcmBytes, 40)

  let offset = 44
  for (const b of chunks) {
    b.copy(wavBuffer, offset)
    offset += b.length
  }
  return wavBuffer
}

const activeStreams = new Map<string, AbortController>()

export async function cancelTtsStream(streamId: string): Promise<Result<void, AppError>> {
  const ctrl = activeStreams.get(streamId)
  if (ctrl) {
    ctrl.abort(new Error('用户取消了流式朗读'))
    activeStreams.delete(streamId)
  }
  return ok(undefined)
}

export async function synthesizeTtsStream(
  sender: Electron.WebContents,
  payload: TtsSynthesizePayload & { streamId: string },
): Promise<Result<{ started: boolean; fromCache?: boolean; cachedResult?: TtsSynthesizeResult }, AppError>> {
  const streamId = payload.streamId
  if (!streamId) {
    return err({ code: 'INVALID_ARGUMENT', message: 'streamId 不能为空' })
  }

  try {
    const configRes = await readTtsConfig()
    const config = configRes.ok ? configRes.value : DEFAULT_TTS_CONFIG
    const activeProvider = payload.provider || config.provider || 'gemini'
    const text = payload.text.trim()
    if (!text) {
      return err({ code: 'INVALID_ARGUMENT', message: '朗读文本不能为空' })
    }
    const rate = payload.rate ?? config.rate ?? 1.0

    const voiceName =
      activeProvider === 'azure'
        ? payload.voiceName?.trim() || config.azureVoice?.trim() || 'zh-CN-XiaoxiaoNeural'
        : activeProvider === 'local'
          ? payload.localVoice?.trim() || config.localVoice?.trim() || 'zh-female'
          : payload.voiceName?.trim() || config.voiceName || 'Aoede'
    const modelId =
      activeProvider === 'local'
        ? payload.localModel?.trim() || config.localModel?.trim() || 'kokoro'
        : activeProvider === 'azure'
          ? 'azure'
          : resolveTtsModelId(payload.modelId || config.modelId)

    const cacheKey = buildCacheKey({ text, voiceName, modelId, rate })
    const cacheDir = getCacheDirPath()
    const cacheFilePath = join(cacheDir, `${cacheKey}.wav`)

    // 1. 本地磁盘缓存命中
    if (config.saveAudioCache) {
      try {
        const cachedBuf = await readFile(cacheFilePath)
        if (cachedBuf.byteLength > 0) {
          const cachedBase64 = cachedBuf.toString('base64')
          if (!sender.isDestroyed()) {
            sender.send(IPC.TTS_STREAM_END, {
              streamId,
              totalChunks: 1,
              audioBase64: cachedBase64,
              mimeType: 'audio/wav',
              fromCache: true,
              keyUsed: 'primary',
            })
          }
          return ok({
            started: true,
            fromCache: true,
            cachedResult: {
              audioBase64: cachedBase64,
              mimeType: 'audio/wav',
              fromCache: true,
              keyUsed: 'primary',
            },
          })
        }
      } catch {}
    }

    // 2. 非 Gemini 厂商（Azure / Local）单次合成并推送完成
    if (activeProvider !== 'gemini') {
      const singleRes = await synthesizeTts(payload)
      if (!singleRes.ok) {
        if (!sender.isDestroyed()) {
          sender.send(IPC.TTS_STREAM_ERROR, {
            streamId,
            error: singleRes.error.message,
            canFallbackToSystem: true,
          })
        }
        return singleRes as any
      }
      if (!sender.isDestroyed()) {
        sender.send(IPC.TTS_STREAM_END, {
          streamId,
          totalChunks: 1,
          audioBase64: singleRes.value.audioBase64,
          mimeType: singleRes.value.mimeType,
          fromCache: singleRes.value.fromCache,
          keyUsed: singleRes.value.keyUsed,
        })
      }
      return ok({ started: true, fromCache: false, cachedResult: singleRes.value })
    }

    // 3. Gemini 实时流式合成
    const abortCtrl = new AbortController()
    activeStreams.set(streamId, abortCtrl)

    const primaryKey = payload.primaryApiKey?.trim() || config.primaryApiKey?.trim() || ''
    const secondaryKey = payload.secondaryApiKey?.trim() || config.secondaryApiKey?.trim() || ''

    if (!primaryKey && !secondaryKey) {
      activeStreams.delete(streamId)
      return err({
        code: 'INVALID_ARGUMENT',
        message: '未配置 Gemini API Key，请在设置中填入有效密钥后重试',
      })
    }

    const inCooldown = primaryCooldownUntil > Date.now()
    let chosenKey = primaryKey
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

    // 异步执行消费循环，避免阻塞主进程 IPC handle 返回
    void (async () => {
      const streamPcmBuffers: Buffer[] = []
      let detectedMime = 'audio/L16;codec=pcm;rate=24000'
      let chunkIndex = 0

      const executeStreamWithKeyAndModel = async (k: string, m: string) => {
        if (!geminiProvider.synthesizeStream) {
          throw new Error('geminiProvider.synthesizeStream 不可用')
        }
        return await geminiProvider.synthesizeStream(
          {
            text,
            voiceName,
            model: m,
          },
          k.trim(),
          ({ audioBase64, mimeType }: { audioBase64: string; mimeType: string }) => {
            if (abortCtrl.signal.aborted || sender.isDestroyed()) return
            if (audioBase64) {
              const buf = Buffer.from(audioBase64, 'base64')
              streamPcmBuffers.push(buf)
              sender.send(IPC.TTS_STREAM_CHUNK, {
                streamId,
                chunkIndex: chunkIndex++,
                audioBase64,
                mimeType: mimeType || detectedMime,
              })
            }
            if (mimeType) detectedMime = mimeType
          },
          { signal: abortCtrl.signal },
        )
      }

      try {
        try {
          await executeStreamWithKeyAndModel(chosenKey, modelId)
        } catch (firstErr: any) {
          if (abortCtrl.signal.aborted) return

          // 若配置为 gemini-3.8-flash-tts 且被免费层限额（429 / 10次/天超额），无缝尝试 flash-lite-tts
          if (modelId === 'gemini-3.8-flash-tts' && isRateLimitOrQuotaError(firstErr)) {
            console.warn('[TTS] gemini-3.8-flash-tts 达到免费额度配额限制，自动切换至 gemini-3.8-flash-lite-tts')
            await executeStreamWithKeyAndModel(chosenKey, 'gemini-3.8-flash-lite-tts')
          } else if (keyUsed === 'primary' && secondaryKey && isRateLimitOrQuotaError(firstErr)) {
            primaryCooldownUntil = Date.now() + 60_000
            keyUsed = 'secondary'
            try {
              await executeStreamWithKeyAndModel(secondaryKey, modelId)
            } catch (secErr: any) {
              if (modelId === 'gemini-3.8-flash-tts' && isRateLimitOrQuotaError(secErr)) {
                await executeStreamWithKeyAndModel(secondaryKey, 'gemini-3.8-flash-lite-tts')
              } else {
                throw secErr
              }
            }
          } else {
            throw firstErr
          }
        }

        if (abortCtrl.signal.aborted || sender.isDestroyed()) return

        if (streamPcmBuffers.length === 0) {
          throw new Error('Gemini 流式合成未收到任何有效音频分片')
        }

        const sampleRate = parsePcmRate(detectedMime) || 24000
        const finalWavBuffer = pcmChunksToWavBuffer(streamPcmBuffers, sampleRate)
        const finalBase64 = finalWavBuffer.toString('base64')

        if (config.saveAudioCache) {
          try {
            await mkdir(cacheDir, { recursive: true })
            await writeFile(cacheFilePath, finalWavBuffer)
          } catch (cacheErr) {
            console.warn('[TTS] 写入本地音频缓存失败:', cacheErr)
          }
        }

        sender.send(IPC.TTS_STREAM_END, {
          streamId,
          totalChunks: chunkIndex,
          audioBase64: finalBase64,
          mimeType: 'audio/wav',
          fromCache: false,
          keyUsed,
        })
      } catch (err: any) {
        if (abortCtrl.signal.aborted || sender.isDestroyed()) return
        console.warn('[TTS] 流式合成失败:', err)
        sender.send(IPC.TTS_STREAM_ERROR, {
          streamId,
          error: formatFriendlyErrorMessage(err),
          canFallbackToSystem: true,
        })
      } finally {
        activeStreams.delete(streamId)
      }
    })()

    return ok({ started: true, fromCache: false })
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

export async function listTtsModels(
  apiKey?: string,
): Promise<Result<TtsRemoteModelItem[], AppError>> {
  try {
    let key = (apiKey || '').trim()
    if (!key) {
      const cfgRes = await readTtsConfig()
      if (cfgRes.ok) {
        key = cfgRes.value.primaryApiKey?.trim() || cfgRes.value.secondaryApiKey?.trim() || ''
      }
    }

    if (!key) {
      return err({ code: 'INVALID_ARGUMENT', message: '请先填写 Gemini API Key' })
    }

    const res = await geminiProvider.listModels(key)
    const rawList = res?.models || []
    const mapped: TtsRemoteModelItem[] = rawList.map((m: any) => ({
      id: m.id,
      name: m.displayName || m.name,
      description: m.description,
      isRecommended: Boolean(m.isTtsRecommended),
      tier: m.tier || 'standard',
    }))

    return ok(mapped)
  } catch (cause) {
    return err(toAppError(cause, '拉取 Google 云端语音模型列表失败'))
  }
}

export async function listTtsVoices(
  provider = 'gemini',
  apiKey?: string,
  region?: string,
): Promise<Result<TtsVoiceInfo[], AppError>> {
  try {
    let key = (apiKey || '').trim()
    if (!key) {
      const cfgRes = await readTtsConfig()
      if (cfgRes.ok) {
        key = provider === 'azure'
          ? (cfgRes.value.azureApiKey?.trim() || '')
          : (cfgRes.value.primaryApiKey?.trim() || cfgRes.value.secondaryApiKey?.trim() || '')
      }
    }

    let list: any[] = []
    if (provider === 'gemini') {
      list = await geminiProvider.listVoices(key)
    } else if (provider === 'azure') {
      list = await azureProvider.listVoices(key, region || 'eastasia')
    } else if (provider === 'local') {
      list = await localProvider.listVoices(key)
    }

    const mapped: TtsVoiceInfo[] = (list || []).map((v) => ({
      id: v.id,
      name: v.name || v.id,
      gender: v.gender || 'neutral',
      description: v.description || v.tone || '',
    }))

    return ok(mapped)
  } catch (cause) {
    return err(toAppError(cause, '拉取语音发音人列表失败'))
  }
}

export async function createTtsBatchJob(
  payload: TtsBatchCreatePayload,
): Promise<Result<TtsBatchJobStatus, AppError>> {
  try {
    let key = (payload.apiKey || '').trim()
    if (!key) {
      const cfgRes = await readTtsConfig()
      if (cfgRes.ok) {
        key = cfgRes.value.primaryApiKey?.trim() || cfgRes.value.secondaryApiKey?.trim() || ''
      }
    }
    if (!key) {
      return err({ code: 'INVALID_ARGUMENT', message: '请先填写 Gemini API Key' })
    }

    if (!geminiProvider.createBatchJob) {
      return err({ code: 'API_UNAVAILABLE', message: '当前 Provider 不支持 Batch 批量接口' })
    }

    const activeModel = payload.model?.trim() || geminiProvider.defaultModel || 'gemini-3.8-flash-tts'
    const activeVoice = payload.voiceName?.trim() || geminiProvider.defaultVoice || 'Aoede'

    const res = await geminiProvider.createBatchJob(key, {
      model: activeModel,
      voiceName: activeVoice,
      displayName: payload.displayName || `batch-${Date.now()}`,
      speechMetadata: '',
      languageCode: '',
      items: payload.items.map((it, idx) => ({
        text: it.text,
        voiceName: it.voiceName || activeVoice,
        speechMetadata: it.speechMetadata || '',
        languageCode: '',
        key: it.key || String(idx),
      })),
    })

    return ok(res as TtsBatchJobStatus)
  } catch (cause) {
    return err(toAppError(cause, '创建批量语音任务失败'))
  }
}

export async function getTtsBatchJob(
  name: string,
  apiKey?: string,
): Promise<Result<TtsBatchJobStatus, AppError>> {
  try {
    let key = (apiKey || '').trim()
    if (!key) {
      const cfgRes = await readTtsConfig()
      if (cfgRes.ok) {
        key = cfgRes.value.primaryApiKey?.trim() || cfgRes.value.secondaryApiKey?.trim() || ''
      }
    }
    if (!key) {
      return err({ code: 'INVALID_ARGUMENT', message: '请先填写 Gemini API Key' })
    }

    if (!geminiProvider.getBatchJob) {
      return err({ code: 'API_UNAVAILABLE', message: '当前 Provider 不支持 Batch 批量查询' })
    }

    const res = await geminiProvider.getBatchJob(key, name)
    return ok(res as TtsBatchJobStatus)
  } catch (cause) {
    return err(toAppError(cause, '查询批量语音任务失败'))
  }
}

export async function cancelTtsBatchJob(
  name: string,
  apiKey?: string,
): Promise<Result<{ name: string; cancelled: boolean }, AppError>> {
  try {
    let key = (apiKey || '').trim()
    if (!key) {
      const cfgRes = await readTtsConfig()
      if (cfgRes.ok) {
        key = cfgRes.value.primaryApiKey?.trim() || cfgRes.value.secondaryApiKey?.trim() || ''
      }
    }
    if (!key) {
      return err({ code: 'INVALID_ARGUMENT', message: '请先填写 Gemini API Key' })
    }

    if (!geminiProvider.cancelBatchJob) {
      return err({ code: 'API_UNAVAILABLE', message: '当前 Provider 不支持取消 Batch 任务' })
    }

    const res = await geminiProvider.cancelBatchJob(key, name)
    return ok(res)
  } catch (cause) {
    return err(toAppError(cause, '取消批量语音任务失败'))
  }
}


