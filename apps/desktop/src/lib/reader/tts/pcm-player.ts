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

/**
 * 流式 PCM 播放器：首包即播，后续分片无缝续播（Web Audio 调度）
 */
export class PcmStreamPlayer {
  private ctx: AudioContext | null = null
  private nextTime = 0
  private startTime = 0
  private totalDuration = 0
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
    if (ctx.state === 'suspended') await ctx.resume()
    if (this.nextTime === 0) {
      this.nextTime = ctx.currentTime + 0.05
      this.startTime = this.nextTime
    }
  }

  pushChunk(bytes: Uint8Array): void {
    if (this.closed || !bytes || bytes.length === 0) return
    const ctx = this.ensureContext()
    if (this.nextTime === 0) {
      this.nextTime = ctx.currentTime + 0.05
      this.startTime = this.nextTime
    }
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
    const startAt = Math.max(this.nextTime, ctx.currentTime)
    if (this.startTime === 0) this.startTime = startAt
    source.start(startAt)
    this.nextTime = startAt + buffer.duration
    this.totalDuration += buffer.duration
  }

  get playedSeconds(): number {
    if (!this.ctx || this.startTime === 0) return 0
    const elapsed = this.ctx.currentTime - this.startTime
    if (elapsed <= 0) return 0
    return Math.min(elapsed, this.totalDuration)
  }

  async close(): Promise<void> {
    this.closed = true
    const ctx = this.ctx
    this.ctx = null
    this.nextTime = 0
    this.startTime = 0
    this.totalDuration = 0
    if (ctx) {
      try {
        await ctx.close()
      } catch {}
    }
  }
}
