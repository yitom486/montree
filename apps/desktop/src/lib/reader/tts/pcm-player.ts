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

interface ScheduledPcmChunk {
  startAt: number
  endAt: number
  duration: number
}

/**
 * 流式 PCM 播放器：首包即播，后续分片无缝续播（基于 Web Audio 高精度分片调度）
 * 彻底消除网络延迟导致 startTime 早于发声、进而导致 playedSeconds 封顶卡死的时钟 Bug。
 */
export class PcmStreamPlayer {
  private ctx: AudioContext | null = null
  private nextTime = 0
  private scheduledChunks: ScheduledPcmChunk[] = []
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

  pushChunk(bytes: Uint8Array): void {
    if (this.closed || !bytes || bytes.length === 0) return
    const ctx = this.ensureContext()

    const frames = Math.floor(bytes.length / 2)
    if (frames === 0) return

    const buffer = ctx.createBuffer(1, frames, this.sampleRate)
    const channel = buffer.getChannelData(0)
    const view = new DataView(bytes.buffer, bytes.byteOffset, frames * 2)
    for (let i = 0; i < frames; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)

    // 若当前时间已落后于声卡当前时钟（网络断流或首包到达），重新从当前时钟平滑起步
    const startAt = Math.max(this.nextTime, ctx.currentTime)
    const duration = buffer.duration
    const endAt = startAt + duration

    source.start(startAt)
    this.scheduledChunks.push({ startAt, endAt, duration })
    this.nextTime = endAt
  }

  /**
   * 真实已播放秒数：
   * 遍历所有已调度分片在当前 AudioContext 时钟下的实际发声区间，
   * 无论遇到网络延迟、首包排队还是断流静音，均分秒不差严格对应声卡真实发音进度。
   */
  get playedSeconds(): number {
    if (!this.ctx || this.scheduledChunks.length === 0) return 0
    const now = this.ctx.currentTime
    let played = 0
    for (const chunk of this.scheduledChunks) {
      if (now >= chunk.endAt) {
        played += chunk.duration
      } else if (now > chunk.startAt) {
        played += now - chunk.startAt
      }
    }
    return played
  }

  async close(): Promise<void> {
    this.closed = true
    const ctx = this.ctx
    this.ctx = null
    this.nextTime = 0
    this.scheduledChunks = []
    if (ctx) {
      try {
        await ctx.close()
      } catch {}
    }
  }
}
