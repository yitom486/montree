/**
 * 基于 Web Audio API 的实时 PCM 流式播放器与音频拼装工具
 * （复用自 gemini-tts-studio / study-studio 配套流式音频播放逻辑）
 */

export function base64ToBytes(base64: string): Uint8Array {
  let clean = (base64 || '').trim()
  const comma = clean.indexOf(',')
  if (clean.startsWith('data:') && comma >= 0) {
    clean = clean.slice(comma + 1)
  }
  clean = clean.replace(/\s+/g, '')
  if (!clean) return new Uint8Array(0)
  if (typeof atob !== 'undefined') {
    const binary = atob(clean)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  return new Uint8Array(0)
}

export function parsePcmRate(mimeType?: string | null): number {
  if (!mimeType) return 24000
  const m = /rate\s*=\s*(\d+)/i.exec(mimeType)
  if (m?.[1]) {
    const rate = parseInt(m[1], 10)
    if (Number.isFinite(rate) && rate >= 8000 && rate <= 96000) return rate
  }
  return 24000
}

export function isRawPcmMime(mimeType?: string | null): boolean {
  if (!mimeType) return true
  const m = mimeType.toLowerCase()
  return m.includes('l16') || m.includes('pcm')
}

/** 多个原始 PCM16LE 分片 → 单个 WAV Blob（单声道 16-bit） */
export function pcmChunksToWavBlob(chunks: Uint8Array[], sampleRate = 24000): Blob {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.floor(sampleRate) : 24000
  let total = 0
  for (const c of chunks) total += c.length
  const buffer = new ArrayBuffer(44 + total)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + total, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, total, true)
  const out = new Uint8Array(buffer, 44)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

interface RecordedPcmChunk {
  bytes: Uint8Array
  sampleRate: number
  offsetSec: number
  duration: number
}

interface ScheduledPcmChunk {
  source?: any
  startAt: number
  endAt: number
  duration: number
  timelineOffset: number
}

/**
 * 流式 PCM 播放器：首包即播，后续分片无缝续播（基于 Web Audio 高精度分片调度）
 * 支持在流式接收过程中任意快退、快进、重播以及在已就绪音频进度内自由 Seek。
 */
export class PcmStreamPlayer {
  private ctx: AudioContext | null = null
  private nextTime = 0
  private scheduledChunks: ScheduledPcmChunk[] = []
  private recordedChunks: RecordedPcmChunk[] = []
  private totalRecordedSeconds = 0
  private seekOffset = 0
  private closed = false

  constructor(private readonly sampleRate: number = 24000) {}

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        typeof window !== 'undefined'
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined
      if (!Ctor) throw new Error('当前浏览器不支持 Web Audio 播放')
      this.ctx = new Ctor()
    }
    return this.ctx
  }

  async resume(): Promise<void> {
    if (this.closed) return
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
  }

  async pause(): Promise<void> {
    if (this.closed) return
    const ctx = this.ensureContext()
    if (ctx.state === 'running') {
      await ctx.suspend()
    }
  }

  get isPaused(): boolean {
    return this.ctx?.state === 'suspended'
  }

  get receivedSeconds(): number {
    return this.totalRecordedSeconds
  }

  /** Buffer exhaustion can mean waiting for the network; only the caller knows whether input ended. */
  get isDrained(): boolean {
    if (this.scheduledChunks.length === 0) {
      return this.recordedChunks.length > 0
    }
    return Boolean(this.ctx && this.ctx.currentTime >= this.nextTime)
  }

  private scheduleSlice(
    bytes: Uint8Array,
    sampleRate: number,
    timelineOffset: number,
    duration: number,
  ): void {
    if (this.closed || bytes.length === 0 || duration <= 0) return
    const ctx = this.ensureContext()
    const frames = Math.floor(bytes.length / 2)
    if (frames === 0) return

    const buffer = ctx.createBuffer(1, frames, sampleRate)
    const channel = buffer.getChannelData(0)
    const view = new DataView(bytes.buffer, bytes.byteOffset, frames * 2)
    for (let i = 0; i < frames; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)

    const startAt = Math.max(this.nextTime, ctx.currentTime)
    const endAt = startAt + duration

    try {
      source.start(startAt)
    } catch {}

    this.scheduledChunks.push({
      source,
      startAt,
      endAt,
      duration,
      timelineOffset,
    })
    this.nextTime = endAt
  }

  pushChunk(bytes: Uint8Array, sampleRate = this.sampleRate): void {
    if (this.closed || !bytes || bytes.length === 0) return
    const frames = Math.floor(bytes.length / 2)
    if (frames === 0) return
    const duration = frames / sampleRate
    const offsetSec = this.totalRecordedSeconds

    this.recordedChunks.push({
      bytes,
      sampleRate,
      offsetSec,
      duration,
    })
    this.totalRecordedSeconds += duration

    this.scheduleSlice(bytes, sampleRate, offsetSec, duration)
  }

  /**
   * 跳转播放位置（秒）：在已接收的 PCM 缓存区内任意 Seek，停止当前调度并从目标时间无缝重调
   */
  seek(targetSec: number): void {
    if (this.closed) return
    const ctx = this.ensureContext()

    const clamped = Math.max(0, Math.min(this.totalRecordedSeconds, targetSec))
    this.seekOffset = clamped

    for (const chunk of this.scheduledChunks) {
      try {
        chunk.source?.stop?.()
        chunk.source?.disconnect?.()
      } catch {}
    }
    this.scheduledChunks = []
    this.nextTime = ctx.currentTime

    if (clamped >= this.totalRecordedSeconds) {
      return
    }

    for (const chunk of this.recordedChunks) {
      const chunkEnd = chunk.offsetSec + chunk.duration
      if (chunkEnd <= clamped) {
        continue
      }

      if (chunk.offsetSec < clamped) {
        const skipSec = clamped - chunk.offsetSec
        const skipFrames = Math.floor(skipSec * chunk.sampleRate)
        const byteOffset = skipFrames * 2
        const sliceBytes = chunk.bytes.subarray(byteOffset)
        const sliceDuration = chunk.duration - skipFrames / chunk.sampleRate
        if (sliceBytes.length > 0 && sliceDuration > 0) {
          this.scheduleSlice(sliceBytes, chunk.sampleRate, clamped, sliceDuration)
        }
      } else {
        this.scheduleSlice(chunk.bytes, chunk.sampleRate, chunk.offsetSec, chunk.duration)
      }
    }
  }

  /**
   * 真实已播放秒数：
   * 严格对应当前 AudioContext 时钟下正在发声或已发声的 PCM 时间轴位置。
   */
  get playedSeconds(): number {
    if (!this.ctx || this.scheduledChunks.length === 0) return this.seekOffset
    const now = this.ctx.currentTime
    for (let i = this.scheduledChunks.length - 1; i >= 0; i--) {
      const chunk = this.scheduledChunks[i]
      if (now >= chunk.startAt) {
        if (now < chunk.endAt) {
          return chunk.timelineOffset + (now - chunk.startAt)
        }
        return chunk.timelineOffset + chunk.duration
      }
    }
    return this.scheduledChunks[0].timelineOffset
  }

  async close(): Promise<void> {
    this.closed = true
    for (const chunk of this.scheduledChunks) {
      try {
        chunk.source?.stop?.()
        chunk.source?.disconnect?.()
      } catch {}
    }
    this.scheduledChunks = []
    this.recordedChunks = []
    this.totalRecordedSeconds = 0
    this.seekOffset = 0
    const ctx = this.ctx
    this.ctx = null
    this.nextTime = 0
    if (ctx) {
      try {
        await ctx.close()
      } catch {}
    }
  }
}
