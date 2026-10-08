import { GoogleGenAI } from '@google/genai'
import { geminiRequestQueue, type GeminiRequestPriority, type GeminiQueueState } from './gemini-queue'
import { geminiQuota, parseGeminiQuotaError } from './gemini-quota'

interface GeminiStreamContext {
  signal?: AbortSignal
  priority?: GeminiRequestPriority
  logContext?: { jobId: string; segmentIndex: number; totalSegments: number; attempt: number }
  onQueueState?: (state: GeminiQueueState) => void
  onProgress?: (progress: { chunks: number; audioBytes: number; mimeType: string }) => void
}

/** Read the terminal response ourselves: the provider adapter discards finishReason. */
export async function synthesizeGeminiStream(
  params: { text: string; voiceName: string; model: string },
  apiKey: string,
  onChunk: (chunk: { audioBase64: string; mimeType: string }) => void | Promise<void>,
  context?: GeminiStreamContext,
): Promise<{ mimeType: string }> {
  geminiQuota.assertAvailable(apiKey, params.model)
  return geminiRequestQueue.run(() => receiveGeminiStream(params, apiKey, onChunk, context), context)
}

async function receiveGeminiStream(
  params: { text: string; voiceName: string; model: string },
  apiKey: string,
  onChunk: (chunk: { audioBase64: string; mimeType: string }) => void | Promise<void>,
  context?: GeminiStreamContext,
): Promise<{ mimeType: string }> {
  const heartbeat = new AbortController()
  const signal = context?.signal
    ? AbortSignal.any([context.signal, heartbeat.signal])
    : heartbeat.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const resetHeartbeat = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => heartbeat.abort(new Error('云端语音接收超时，请重试')), ms)
  }
  let finishReason: string | undefined
  let mimeType = 'audio/L16;codec=pcm;rate=24000'
  let audioBytes = 0
  let chunks = 0
  let lastProgressAt = 0
  let failure: unknown
  let promptBlockReason: string | undefined
  let responseId: string | undefined
  let modelVersion: string | undefined
  const startedAt = Date.now()
  const diagnostics = () => ({ ...context?.logContext, model: params.model, modelVersion, responseId, textLength: params.text.length, chunks, audioBytes, finishReason, promptBlockReason, elapsedMs: Date.now() - startedAt })
  console.info('[TTS] 开始接收', diagnostics())
  resetHeartbeat(45_000)
  try {
    signal.throwIfAborted()
    geminiQuota.assertAvailable(apiKey, params.model)
    const ai = new GoogleGenAI({ apiKey })
    const voice = params.voiceName.trim()
    const stream = await ai.models.generateContentStream({
      model: params.model,
      contents: params.text,
      config: {
        // Every HTTP attempt must acquire our shared request budget.
        httpOptions: { retryOptions: { attempts: 1 } },
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: /^voice(_|key_)/i.test(voice)
            ? { voice }
            : { prebuiltVoiceConfig: { voiceName: voice } },
        },
        abortSignal: signal,
      },
    })
    for await (const response of stream) {
      signal.throwIfAborted()
      resetHeartbeat(30_000)
      responseId = response.responseId ?? responseId
      modelVersion = response.modelVersion ?? modelVersion
      promptBlockReason = response.promptFeedback?.blockReason ?? promptBlockReason
      if (promptBlockReason) throw new Error(`云端拒绝合成文本（${promptBlockReason}）`)
      const candidate = response.candidates?.[0]
      if (candidate?.finishReason) finishReason = candidate.finishReason
      for (const part of candidate?.content?.parts ?? []) {
        const inline = part.inlineData
        if (!inline?.data) continue
        mimeType = inline.mimeType || mimeType
        if (!/l16|pcm/i.test(mimeType)) {
          throw new Error(`云端流式音频格式不受支持：${mimeType}`)
        }
        audioBytes += Buffer.from(inline.data, 'base64').length
        chunks++
        await onChunk({ audioBase64: inline.data, mimeType })
        if (chunks === 1) {
          console.info('[TTS] 首包到达', diagnostics())
        }
        if (chunks === 1 || Date.now() - lastProgressAt >= 1000) {
          lastProgressAt = Date.now()
          context?.onProgress?.({ chunks, audioBytes, mimeType })
        }
      }
    }
    signal.throwIfAborted()
    if (finishReason !== 'STOP') {
      throw new Error(`云端语音未正常完成（${finishReason || '缺少结束标志'}），音频可能不完整`)
    }
    if (!audioBytes) throw new Error('云端语音未返回有效音频')
    return { mimeType }
  } catch (cause) {
    failure = signal.aborted ? signal.reason : cause
    if (signal.aborted) throw signal.reason
    const quota = parseGeminiQuotaError(cause)
    if (quota) {
      const quotaError = quota.kind === 'daily'
        ? geminiQuota.record(apiKey, params.model, quota.retryMs)
        : geminiQuota.recordRate(apiKey, params.model, quota.retryMs)
      failure = quotaError
      console.warn('[TTS] 当前 Key 额度受限', { ...context?.logContext, model: params.model, kind: quota.kind, retryAt: quotaError.retryAt, retryMs: quota.retryMs })
      throw quotaError
    }
    throw cause
  } finally {
    clearTimeout(timer)
    // Keep diagnostics useful without logging the transcript or credentials.
    const error = failure as { message?: string; status?: number; code?: string; name?: string } | undefined
    console.info('[TTS] 接收结果', {
      ...diagnostics(), outcome: failure ? signal.aborted ? 'aborted' : 'failed' : 'complete',
      error: error?.message?.replaceAll(apiKey, '[REDACTED]').replace(/AIza[\w-]+/g, '[REDACTED]'), status: error?.status, code: error?.code,
    })
  }
}

export function assertGeminiAudioDuration(text: string, duration: number): void {
  const readableChars = (text.match(/[\p{L}\p{N}]/gu) ?? []).length
  // This deliberately generous bound catches gross truncation, not speaking-speed differences.
  if (!Number.isFinite(duration) || duration <= 0 || (readableChars >= 200 && duration < readableChars / 40)) {
    throw new Error('云端语音时长与正文严重不匹配，可能只返回了部分音频，请重试')
  }
}

/** Validate both newly generated audio and older caches before declaring synthesis complete. */
export function validateGeminiWav(text: string, wav: Buffer): number {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('云端语音缓存不是有效 WAV 音频')
  }
  if (wav.readUInt32LE(4) + 8 !== wav.length) throw new Error('云端语音 WAV 文件不完整')
  let byteRate = 0
  let dataBytes = 0
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4)
    const length = wav.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + length > wav.length) throw new Error('云端语音 WAV 数据不完整')
    if (id === 'fmt ' && length >= 16) {
      if (wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 || wav.readUInt16LE(start + 14) !== 16) {
        throw new Error('云端语音 WAV 格式不受支持')
      }
      byteRate = wav.readUInt32LE(start + 8)
      if (byteRate !== wav.readUInt32LE(start + 4) * 2) throw new Error('云端语音 WAV 采样率无效')
    }
    if (id === 'data') dataBytes += length
    offset = start + length + (length % 2)
  }
  const duration = dataBytes / byteRate
  if (dataBytes % 2) throw new Error('云端语音 WAV 采样数据不完整')
  assertGeminiAudioDuration(text, duration)
  return duration
}
