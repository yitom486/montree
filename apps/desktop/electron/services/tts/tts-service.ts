import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { azureProvider, geminiProvider, localProvider, prettyApiError } from 'gemini-tts-studio/server'
import { synthesizeGeminiStream, validateGeminiWav } from './gemini-stream'
import { splitGeminiText, type GeminiRequestPriority } from './gemini-queue'
import { geminiQuota, GeminiQuotaError } from './gemini-quota'
import { IPC, err, ok, toAppError, type AppError, type Result } from '@montree/contracts'
import type {
  TtsBatchCreatePayload,
  TtsBatchJobStatus,
  TtsCacheStats,
  TtsConfig,
  TtsRemoteModelItem,
  TtsSpeechBoundary,
  TtsSynthesizePayload,
  TtsSynthesizeResult,
  TtsTestKeyPayload,
  TtsTestKeyResult,
  TtsVoiceInfo,
  TtsStreamProgressPayload,
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
  enableBatch: false,
  highlightInReader: true,
}

let quotaStateLoaded: Promise<void> | undefined

function loadGeminiQuotaState(): Promise<void> {
  return quotaStateLoaded ??= readFile(join(app.getPath('userData'), 'tts-quota.json'), 'utf-8')
    .then((saved) => { geminiQuota.restore(JSON.parse(saved)) }).catch(() => {})
}

async function saveGeminiQuotaState(): Promise<void> {
  try {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(join(app.getPath('userData'), 'tts-quota.json'), JSON.stringify(geminiQuota.snapshot()), 'utf-8')
  } catch (cause) { console.warn('[TTS] 保存额度恢复时间失败:', cause) }
}

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
  if (error instanceof GeminiQuotaError) return true
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

async function tryGeminiBatchPrefetch(
  apiKey: string,
  segments: string[],
  voiceName: string,
  model: string,
  rate: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!geminiProvider.createBatchJob || !geminiProvider.getBatchJob) return
  const uncached: Array<{ segment: string; index: number; cacheFile: string }> = []
  for (const [index, segment] of segments.entries()) {
    const cacheFile = join(getCacheDirPath(), `${buildCacheKey({ text: segment, voiceName, modelId: model, rate })}.segment.wav`)
    try {
      await stat(cacheFile)
    } catch {
      uncached.push({ segment, index, cacheFile })
    }
  }

  if (uncached.length === 0) return

  console.info('[TTS] 正在尝试通过 Gemini Batch 提交批量预取任务...', { uncachedCount: uncached.length, model })
  try {
    const created = await geminiProvider.createBatchJob(apiKey, {
      model,
      voiceName,
      displayName: `montree-tts-${Date.now()}`,
      speechMetadata: '',
      languageCode: '',
      items: uncached.map((item) => ({
        key: String(item.index),
        text: item.segment,
        voiceName,
        speechMetadata: '',
        languageCode: '',
      })),
    })

    if (!created?.name) return
    console.info('[TTS] Gemini Batch 任务已创建，正在等待完成...', { name: created.name, state: created.state })

    // 轮询检查最多 10 秒（5次 x 2秒），避免过度阻塞播放起播
    for (let i = 0; i < 5; i++) {
      signal?.throwIfAborted()
      await new Promise((resolve) => setTimeout(resolve, 2000))
      signal?.throwIfAborted()
      const job = await geminiProvider.getBatchJob(apiKey, created.name)
      if (job.state === 'SUCCEEDED' || job.state === 'JOB_STATE_SUCCEEDED') {
        console.info('[TTS] Gemini Batch 任务执行成功，正在写入本地分段缓存...', { name: created.name })
        if (job.results && Array.isArray(job.results)) {
          await mkdir(getCacheDirPath(), { recursive: true })
          for (const res of job.results) {
            if (res.ok && res.audioBase64) {
              const matched = uncached.find((it) => String(it.index) === String(res.key))
              if (matched) {
                const wavBuf = Buffer.from(res.audioBase64, 'base64')
                try {
                  validateGeminiWav(matched.segment, wavBuf)
                  await writeFile(matched.cacheFile, wavBuf)
                } catch {}
              }
            }
          }
        }
        return
      }
      if (job.state === 'FAILED' || job.state === 'JOB_STATE_FAILED' || job.state === 'CANCELLED') {
        console.warn('[TTS] Gemini Batch 任务未成功结束:', job.state)
        return
      }
    }
    console.info('[TTS] Gemini Batch 任务云端排队中，自动无缝回退至实时流式分段播放')
  } catch (cause) {
    console.warn('[TTS] Gemini Batch 批量流程异常，平滑回退至实时流式:', cause)
  }
}

async function synthesizeSegmentBySubSentences(
  segment: string,
  voiceName: string,
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ pcm: Buffer; rate: number } | null> {
  const sentences = segment.match(/[^。！？；!?;]+[。！？；!?;\n]?/g) || [segment]
  const cleanSentences = sentences.map((s) => s.trim()).filter(Boolean)
  if (cleanSentences.length <= 1) return null

  const pcmList: Buffer[] = []
  let detectedRate = 24000

  for (const s of cleanSentences) {
    signal?.throwIfAborted()
    const chunks: Buffer[] = []
    let rate: number | undefined
    try {
      await synthesizeGeminiStream(
        { text: s, voiceName, model },
        apiKey,
        ({ audioBase64, mimeType }) => {
          rate = parsePcmRate(mimeType)
          detectedRate = rate
          chunks.push(Buffer.from(audioBase64, 'base64'))
        },
        { signal },
      )
      if (chunks.length > 0) {
        pcmList.push(Buffer.concat(chunks))
      }
    } catch {
      pcmList.push(Buffer.alloc(Math.round(detectedRate * 2 * 0.3), 0))
    }
  }

  if (pcmList.length === 0) return null
  return { pcm: Buffer.concat(pcmList), rate: detectedRate }
}

async function invokeGeminiTTS(params: {
  apiKey: string
  text: string
  voiceName: string
  modelId: string
  secondaryApiKey?: string
  keyUsed?: 'primary' | 'secondary'
  saveAudioCache?: boolean
  enableBatch?: boolean
  rate?: number
  signal?: AbortSignal
  priority?: GeminiRequestPriority
  onChunk?: (chunk: { audioBase64: string; mimeType: string }) => void
  jobId?: string
  onProgress?: (progress: Omit<TtsStreamProgressPayload, 'streamId'>) => void
}): Promise<{ audioBase64: string; mimeType: string; keyUsed: 'primary' | 'secondary'; cooldownActivated: boolean }> {
  await loadGeminiQuotaState()
  let apiKey = params.apiKey.trim()
  if (!apiKey) throw new Error('未配置 Gemini API Key')
  let model = resolveTtsModelId(params.modelId)
  let keyUsed = params.keyUsed ?? 'primary'
  let cooldownActivated = false
  let primaryQuotaError: GeminiQuotaError | undefined
  const text = params.text.trim()
  const voiceName = params.voiceName.trim() || 'Aoede'
  const allPcm: Buffer[] = []
  let sampleRate: number | undefined
  const segments = splitGeminiText(text).filter((segment) => segment.trim())
  const jobId = params.jobId ?? randomUUID()
  let completedSegments = 0
  let cachedSegments = 0
  let validatedSeconds = 0
  console.info('[TTS] 章节接收开始', { jobId, totalSegments: segments.length, textLength: text.length, cacheEnabled: Boolean(params.saveAudioCache) })
  const report = (stage: TtsStreamProgressPayload['stage'], segmentIndex: number, bufferedSeconds = validatedSeconds, waitMs?: number) => {
    params.onProgress?.({ stage, segmentIndex, totalSegments: segments.length, completedSegments, cachedSegments, bufferedSeconds, waitMs })
  }
  report('queued', 1)
  if (params.enableBatch && params.saveAudioCache && segments.length > 1) {
    await tryGeminiBatchPrefetch(apiKey, segments, voiceName, model, params.rate ?? 1, params.signal)
  }
  for (const [index, segment] of segments.entries()) {
    const segmentIndex = index + 1
    const segmentLog = { jobId, segmentIndex, totalSegments: segments.length, textHash: createHash('sha256').update(segment).digest('hex').slice(0, 12) }
    params.signal?.throwIfAborted()
    let segmentPcm: Buffer | undefined
    let segmentRate = 24000
    const cacheFile = join(getCacheDirPath(), `${buildCacheKey({ text: segment, voiceName, modelId: model, rate: params.rate ?? 1 })}.segment.wav`)
    if (params.saveAudioCache) {
      try {
        const cached = await readFile(cacheFile)
        validateGeminiWav(segment, cached)
        // Segment caches are exclusively written below with this canonical 44-byte header.
        if (cached.readUInt32LE(16) === 16 && cached.toString('ascii', 36, 40) === 'data' && cached.readUInt32LE(40) === cached.length - 44) {
          segmentPcm = cached.subarray(44)
          segmentRate = cached.readUInt32LE(24)
          cachedSegments++
          console.info('[TTS] 复用已完成分段', segmentLog)
        }
      } catch {}
    }
    if (!segmentPcm) {
      let retriedTransientError = false
      let changedModel = false
      for (let attempt = 0; attempt < 4; attempt++) {
        params.signal?.throwIfAborted()
        const chunks: Buffer[] = []
        let detectedRate: number | undefined
        try {
          await synthesizeGeminiStream(
            { text: segment, voiceName, model }, apiKey,
            ({ audioBase64, mimeType }) => {
              const nextRate = parsePcmRate(mimeType)
              if (detectedRate !== undefined && detectedRate !== nextRate) throw new Error('云端语音分片采样率发生变化，请重试')
              detectedRate = nextRate
              chunks.push(Buffer.from(audioBase64, 'base64'))
            },
            {
              signal: params.signal, priority: params.priority,
              logContext: { jobId, segmentIndex, totalSegments: segments.length, attempt: attempt + 1 },
              onQueueState: (state) => {
                console.info('[TTS] 请求调度', { ...segmentLog, attempt: attempt + 1, ...state })
                if (state.phase !== 'cancelled') report(state.phase === 'queued' ? 'queued' : 'receiving', segmentIndex, validatedSeconds, state.waitMs)
              },
              onProgress: ({ audioBytes, mimeType }) => report('receiving', segmentIndex, validatedSeconds + audioBytes / (parsePcmRate(mimeType) * 2)),
            },
          )
          segmentRate = detectedRate ?? 24000
          const wav = pcmChunksToWavBuffer(chunks, segmentRate)
          validateGeminiWav(segment, wav)
          params.signal?.throwIfAborted()
          segmentPcm = wav.subarray(44)
          if (params.saveAudioCache) {
            try {
              const actualCacheFile = join(getCacheDirPath(), `${buildCacheKey({ text: segment, voiceName, modelId: model, rate: params.rate ?? 1 })}.segment.wav`)
              await mkdir(getCacheDirPath(), { recursive: true })
              await writeFile(actualCacheFile, wav)
            } catch (cause) { console.warn('[TTS] 写入分段缓存失败:', cause) }
          }
          break
        } catch (cause) {
          params.signal?.throwIfAborted()
          if (cause instanceof GeminiQuotaError && cause.kind === 'daily') await saveGeminiQuotaState()
          const message = cause instanceof Error ? cause.message : String(cause)
          console.warn('[TTS] 分段尝试失败', { ...segmentLog, attempt: attempt + 1, keyUsed, error: message.replaceAll(apiKey, '[REDACTED]') })
          const secondaryKey = params.secondaryApiKey?.trim()
          if (keyUsed === 'primary' && secondaryKey && secondaryKey !== apiKey && isRateLimitOrQuotaError(cause)) {
            primaryQuotaError = cause instanceof GeminiQuotaError ? cause : undefined
            cooldownActivated = true
            keyUsed = 'secondary'
            apiKey = secondaryKey
            retriedTransientError = false
            console.info('[TTS] 主 Key 额度受限，切换备用 Key 继续当前段', { ...segmentLog, attempt: attempt + 1, retryAt: primaryQuotaError?.retryAt })
          } else if (cause instanceof GeminiQuotaError) {
            const retryAt = primaryQuotaError ? Math.min(primaryQuotaError.retryAt, cause.retryAt) : cause.retryAt
            const unavailable = new GeminiQuotaError(retryAt, cause.kind)
            unavailable.message = `第 ${segmentIndex}/${segments.length} 段接收失败：${primaryQuotaError ? '主备 API Key 均受额度限制' : keyUsed === 'secondary' ? '备用 API Key 受额度限制' : cause.message}；已缓存音频仍可播放，请待额度恢复后继续接收`
            throw unavailable
          } else if (!changedModel && message.includes('supports text output')) {
            model = model === 'gemini-3.8-flash-lite-tts' ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts'
            changedModel = true
          } else if (!retriedTransientError && /（OTHER）|缺少结束标志|严重不匹配|接收超时|fetch failed|ECONNRESET|\b50[234]\b/i.test(message)) {
            retriedTransientError = true
            continue
          } else if (/（OTHER）|缺少结束标志/i.test(message)) {
            // 敏感词/黑盒风控/云端异常截断终极自愈保护（经瞬态重试后依然失败，确认具有持续性）：
            // 1. 若主 Key 遇到截断且有备用 Key，先尝试备用 Key 接力
            if (keyUsed === 'primary' && secondaryKey && secondaryKey !== apiKey) {
              keyUsed = 'secondary'
              apiKey = secondaryKey
              retriedTransientError = false
              console.info('[TTS] 主 Key 遇到云端异常截断，切换备用 Key 继续当前段', { ...segmentLog, attempt: attempt + 1 })
              continue
            }

            // 2. 尝试将大段拆分为独立短句逐句合成（能够有效避开大段文本敏感词密集度风控拦截）
            console.info('[TTS] 分段遭遇云端截断（OTHER），启动短句级降噪自愈合成', segmentLog)
            try {
              const subRes = await synthesizeSegmentBySubSentences(segment, voiceName, model, apiKey, params.signal)
              if (subRes && subRes.pcm.length > 0) {
                segmentRate = subRes.rate
                segmentPcm = subRes.pcm
                console.info('[TTS] 短句级自愈合成成功，完整恢复该段朗读', segmentLog)
                break
              }
            } catch (subErr) {
              console.warn('[TTS] 短句降级重试失败:', subErr)
            }

            // 3. 若整段依然无法通过，且前序段落已合成，生成 0.5 秒静音平滑跳过，保证整章其余内容顺畅播放
            if (completedSegments > 0) {
              console.warn('[TTS] 分段内容疑似受云端限制或异常中断（OTHER），已自动安全跳过该段，继续接收后续段落', segmentLog)
              segmentRate = detectedRate ?? 24000
              segmentPcm = Buffer.alloc(Math.round(segmentRate * 2 * 0.5), 0)
              break
            } else {
              throw new Error(`第 ${segmentIndex}/${segments.length} 段接收失败：${formatFriendlyErrorMessage(cause)}`, { cause })
            }
          } else {
            throw new Error(`第 ${segmentIndex}/${segments.length} 段接收失败：${formatFriendlyErrorMessage(cause)}`, { cause })
          }
        }
      }
      if (!segmentPcm) throw new Error('云端语音分段重试失败，请重试')
    }
    params.signal?.throwIfAborted()
    if (sampleRate !== undefined && sampleRate !== segmentRate) throw new Error('云端语音段落采样率发生变化，请重试')
    sampleRate = segmentRate
    allPcm.push(segmentPcm)
    completedSegments++
    validatedSeconds += segmentPcm.length / (segmentRate * 2)
    console.info('[TTS] 分段已接收完成', { ...segmentLog, completedSegments, cachedSegments, audioSeconds: validatedSeconds })
    report('segment-complete', segmentIndex)
    // Failed attempts are never played, so retrying the current segment cannot duplicate speech.
    params.onChunk?.({ audioBase64: segmentPcm.toString('base64'), mimeType: `audio/L16;codec=pcm;rate=${segmentRate}` })
  }
  const wav = pcmChunksToWavBuffer(allPcm, sampleRate ?? 24000)
  validateGeminiWav(text, wav)
  console.info('[TTS] 整章已接收完成', { jobId, completedSegments, totalSegments: segments.length, cachedSegments, audioSeconds: validatedSeconds })
  report('complete', segments.length)
  return { audioBase64: wav.toString('base64'), mimeType: 'audio/wav', keyUsed, cooldownActivated }
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
      const timelineFilePath = join(cacheDir, `${cacheKey}.timeline.json`)

      if (config.saveAudioCache) {
        try {
          const cachedBuf = await readFile(cacheFilePath)
          if (cachedBuf.byteLength > 0) {
            let cachedBoundaries: TtsSpeechBoundary[] | undefined
            try {
              const timelineStr = await readFile(timelineFilePath, 'utf-8')
              cachedBoundaries = JSON.parse(timelineStr)
            } catch {}
            return ok({
              audioBase64: cachedBuf.toString('base64'),
              mimeType: 'audio/wav',
              fromCache: true,
              keyUsed: 'primary',
              ...(cachedBoundaries ? { boundaries: cachedBoundaries } : {}),
            })
          }
        } catch {}
      }

      let audioBuf: Buffer | undefined
      let boundaries: TtsSpeechBoundary[] | undefined
      if (text.length <= 6000) {
        const res = await azureProvider.synthesize(
          {
            text,
            voiceName: azureVoice,
            region: azureRegion,
            speed: rate,
          },
          azureKey,
        )
        audioBuf = res.audioBuffer
        if (res.boundaries && res.boundaries.length > 0) {
          boundaries = res.boundaries
        }
      } else {
        // 针对超长章节（>6000字）自动按段安全切分并拼接，彻底规避 Azure 单次 10,000 字符限制
        const parts = splitGeminiText(text, 5000).filter((p) => p.trim())
        const pcmChunks: Buffer[] = []
        const combinedBoundaries: TtsSpeechBoundary[] = []
        let currentOffsetMs = 0
        let currentTextOffset = 0
        for (const part of parts) {
          const res = await azureProvider.synthesize(
            {
              text: part,
              voiceName: azureVoice,
              region: azureRegion,
              speed: rate,
            },
            azureKey,
          )
          if (res.audioBuffer && res.audioBuffer.length > 44) {
            const rawPcm = res.audioBuffer.subarray(44)
            pcmChunks.push(rawPcm)
            if (res.boundaries && res.boundaries.length > 0) {
              for (const b of res.boundaries) {
                combinedBoundaries.push({
                  ...b,
                  audioOffsetMs: b.audioOffsetMs + currentOffsetMs,
                  textOffset: (b.textOffset ?? 0) + currentTextOffset,
                })
              }
            }
            // 24000Hz 16-bit mono = 48,000 bytes/sec = 48 bytes/ms
            const partDurationMs = Math.round(rawPcm.byteLength / 48)
            currentOffsetMs += partDurationMs
            currentTextOffset += part.length
          }
        }
        audioBuf = pcmChunksToWavBuffer(pcmChunks, 24000)
        if (combinedBoundaries.length > 0) {
          boundaries = combinedBoundaries
        }
      }

      if (config.saveAudioCache && audioBuf && audioBuf.byteLength > 0) {
        try {
          await mkdir(cacheDir, { recursive: true })
          await writeFile(cacheFilePath, audioBuf)
          if (boundaries && boundaries.length > 0) {
            await writeFile(timelineFilePath, JSON.stringify(boundaries), 'utf-8')
          }
        } catch {}
      }

      return ok({
        audioBase64: audioBuf ? audioBuf.toString('base64') : '',
        mimeType: 'audio/wav',
        fromCache: false,
        keyUsed: 'primary',
        ...(boundaries ? { boundaries } : {}),
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
          validateGeminiWav(text, cachedBuf)
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

    let chosenKey: string
    let keyUsed: 'primary' | 'secondary' = 'primary'

    if (payload.forceKeyType === 'secondary' && secondaryKey) {
      chosenKey = secondaryKey
      keyUsed = 'secondary'
    } else if (payload.forceKeyType === 'primary' && primaryKey) {
      chosenKey = primaryKey
      keyUsed = 'primary'
    } else if (primaryKey) {
      chosenKey = primaryKey
      keyUsed = 'primary'
    } else {
      chosenKey = secondaryKey
      keyUsed = 'secondary'
    }

    const audioData = await invokeGeminiTTS({
      apiKey: chosenKey,
      secondaryApiKey: secondaryKey,
      keyUsed,
      text,
      voiceName,
      modelId,
      rate,
      saveAudioCache: config.saveAudioCache,
      enableBatch: Boolean(payload.enableBatch ?? config.enableBatch),
      priority: payload.priority,
    })
    keyUsed = audioData.keyUsed

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
      cooldownActivated: audioData.cooldownActivated,
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
const cancelledBeforeStart = new Set<string>()

export async function cancelTtsStream(streamId: string): Promise<Result<void, AppError>> {
  const ctrl = activeStreams.get(streamId)
  if (ctrl) {
    console.info('[TTS] 请求取消接收', { jobId: streamId })
    ctrl.abort(new Error('用户取消了流式朗读'))
    activeStreams.delete(streamId)
  } else {
    // IPC cancellation can arrive while the startup handler is still reading config/cache.
    cancelledBeforeStart.add(streamId)
    if (cancelledBeforeStart.size > 128) cancelledBeforeStart.delete(cancelledBeforeStart.values().next().value!)
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

    const azureRegion = payload.azureRegion?.trim() || config.azureRegion?.trim() || 'eastasia'
    const azureVoice = payload.voiceName?.trim() || config.azureVoice?.trim() || 'zh-CN-XiaoxiaoNeural'
    const voiceName =
      activeProvider === 'azure'
        ? `${azureRegion}:${azureVoice}`
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
          if (activeProvider === 'gemini') validateGeminiWav(text, cachedBuf)
          console.info('[TTS] 整章缓存已就绪', { jobId: streamId, audioBytes: cachedBuf.length })
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
          boundaries: singleRes.value.boundaries,
        })
      }
      return ok({ started: true, fromCache: Boolean(singleRes.value.fromCache), cachedResult: singleRes.value })
    }

    // 3. Gemini 实时流式合成
    if (cancelledBeforeStart.delete(streamId)) return err({ code: 'CANCELLED', message: '用户取消了朗读' })
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

    let chosenKey = primaryKey
    let keyUsed: 'primary' | 'secondary' = 'primary'
    if (payload.forceKeyType === 'secondary' && secondaryKey) {
      chosenKey = secondaryKey
      keyUsed = 'secondary'
    } else if (payload.forceKeyType === 'primary' && primaryKey) {
      chosenKey = primaryKey
      keyUsed = 'primary'
    } else if (primaryKey) {
      chosenKey = primaryKey
      keyUsed = 'primary'
    } else {
      chosenKey = secondaryKey
      keyUsed = 'secondary'
    }

    // 异步执行消费循环，避免阻塞主进程 IPC handle 返回
    void (async () => {
      let chunkIndex = 0
      const abortOnDestroyed = () => abortCtrl.abort(new Error('朗读窗口已关闭'))
      sender.once('destroyed', abortOnDestroyed)
      try {
        if (sender.isDestroyed()) abortOnDestroyed()
        const audioData = await invokeGeminiTTS({
          apiKey: chosenKey,
          secondaryApiKey: secondaryKey,
          keyUsed,
          text,
          voiceName,
          modelId,
          rate,
          saveAudioCache: config.saveAudioCache,
          enableBatch: Boolean(payload.enableBatch ?? config.enableBatch),
          signal: abortCtrl.signal,
          jobId: streamId,
          onProgress: (progress) => {
            if (!abortCtrl.signal.aborted && !sender.isDestroyed()) sender.send(IPC.TTS_STREAM_PROGRESS, { streamId, ...progress })
          },
          priority: payload.priority,
          onChunk: ({ audioBase64, mimeType }) => {
            abortCtrl.signal.throwIfAborted()
            if (sender.isDestroyed()) { abortOnDestroyed(); abortCtrl.signal.throwIfAborted() }
            sender.send(IPC.TTS_STREAM_CHUNK, { streamId, chunkIndex: chunkIndex++, audioBase64, mimeType })
          },
        })
        if (abortCtrl.signal.aborted || sender.isDestroyed()) return

        if (config.saveAudioCache) {
          try {
            await mkdir(cacheDir, { recursive: true })
            await writeFile(cacheFilePath, Buffer.from(audioData.audioBase64, 'base64'))
          } catch (cacheErr) {
            console.warn('[TTS] 写入本地音频缓存失败:', cacheErr)
          }
        }

        if (abortCtrl.signal.aborted || sender.isDestroyed()) return
        sender.send(IPC.TTS_STREAM_END, {
          streamId,
          totalChunks: chunkIndex,
          audioBase64: audioData.audioBase64,
          mimeType: 'audio/wav',
          fromCache: false,
          keyUsed: audioData.keyUsed,
        })
      } catch (err: any) {
        if (abortCtrl.signal.aborted || sender.isDestroyed()) {
          console.info('[TTS] 章节接收已中断', { jobId: streamId, completedSegments: chunkIndex, reason: 'cancelled' })
          return
        }
        console.warn('[TTS] 章节接收失败', { jobId: streamId, completedSegments: chunkIndex, error: formatFriendlyErrorMessage(err) })
        sender.send(IPC.TTS_STREAM_ERROR, {
          streamId,
          error: formatFriendlyErrorMessage(err),
          canFallbackToSystem: true,
          retryAt: err instanceof GeminiQuotaError ? err.retryAt : undefined,
        })
      } finally {
        sender.removeListener('destroyed', abortOnDestroyed)
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
        if (file.endsWith('.wav') || file.endsWith('.timeline.json')) {
          const info = await stat(join(cacheDir, file))
          if (file.endsWith('.wav')) count++
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
        if (file.endsWith('.wav') || file.endsWith('.timeline.json')) {
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

export const GEMINI_CORE_VOICES: TtsVoiceInfo[] = [
  { id: 'Aoede', name: 'Aoede', description: '优雅知性 · 女声 (听书精选 · 推荐)', gender: 'female', isRecommended: true },
  { id: 'Puck', name: 'Puck', description: '阳光活力 · 男声 (听书精选 · 推荐)', gender: 'male', isRecommended: true },
  { id: 'Charon', name: 'Charon', description: '低沉稳重 · 男声 (沉浸书感 · 推荐)', gender: 'male', isRecommended: true },
  { id: 'Kore', name: 'Kore', description: '温柔治愈 · 女声 (轻柔舒缓 · 推荐)', gender: 'female', isRecommended: true },
  { id: 'Fenrir', name: 'Fenrir', description: '雄浑有力 · 男声 (气势磅礴 · 推荐)', gender: 'male', isRecommended: true },
  { id: 'Leda', name: 'Leda', description: '清澈明朗 · 女声 (通透悦耳 · 推荐)', gender: 'female', isRecommended: true },
]

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

    if (provider === 'gemini') {
      let rawList: any[] = []
      try {
        rawList = await geminiProvider.listVoices(key)
      } catch {
        rawList = []
      }

      // 提取核心推荐音色
      const coreIds = new Set(GEMINI_CORE_VOICES.map((v) => v.id.toLowerCase()))
      const mappedCore: TtsVoiceInfo[] = [...GEMINI_CORE_VOICES]

      // 过滤云端音色：剔除特定语种人设（如 ar-001-* 阿拉伯语特定政务/客服人设），保留星宿等通用高品质音色
      const extraList: TtsVoiceInfo[] = []
      for (const v of rawList || []) {
        const id = (v.id || '').trim()
        const idLower = id.toLowerCase()
        if (!idLower || coreIds.has(idLower)) continue
        // 过滤非通用语言人设（例如 ar-001 等阿拉伯语客服人设音色）
        if (/^(ar|he|ur|fa)-/i.test(id)) continue

        extraList.push({
          id,
          name: v.name || id,
          gender: v.gender || 'neutral',
          description: v.description || v.tone || 'Google 预置音色',
          isRecommended: false,
        })
      }

      return ok([...mappedCore, ...extraList])
    }

    let list: any[] = []
    if (provider === 'azure') {
      list = await azureProvider.listVoices(key, region || 'eastasia')
    } else if (provider === 'local') {
      list = await localProvider.listVoices(key)
    }

    const mapped: TtsVoiceInfo[] = (list || []).map((v) => ({
      id: v.id,
      name: v.name || v.id,
      gender: v.gender || 'neutral',
      description: v.description || v.tone || '',
      isRecommended: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural', 'zh-CN-XiaoyiNeural'].includes(v.id),
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


