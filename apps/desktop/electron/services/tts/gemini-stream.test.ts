import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertGeminiAudioDuration, synthesizeGeminiStream, validateGeminiWav } from './gemini-stream'
import { geminiRequestQueue } from './gemini-queue'

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContentStream: generate } },
}))
vi.mock('./gemini-queue', async (importOriginal) => ({
  ...await importOriginal<typeof import('./gemini-queue')>(),
  geminiRequestQueue: { run: (work: () => Promise<unknown>) => work(), coolDown: vi.fn() },
}))

const params = { text: '你好，语音测试。', voiceName: 'Aoede', model: 'gemini-3.8-flash-lite-tts' }
const pcm = (seconds = 1) => Buffer.alloc(seconds * 48_000).toString('base64')
const chunk = (data = pcm()) => ({ candidates: [{ content: { parts: [{ inlineData: { data, mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] })
const terminal = (finishReason: string) => ({ candidates: [{ finishReason }] })

function wav(seconds: number): Buffer {
  const audio = Buffer.alloc(44 + seconds * 48_000)
  audio.write('RIFF', 0)
  audio.writeUInt32LE(audio.length - 8, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(24_000, 24)
  audio.writeUInt32LE(48_000, 28)
  audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(audio.length - 44, 40)
  return audio
}

describe('Gemini stream completion', () => {
  beforeEach(() => {
    generate.mockReset()
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps accepting chunks after a one-second first chunk and waits for STOP', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    generate.mockResolvedValue((async function* () {
      yield chunk()
      await waiting
      yield chunk(pcm(2))
      yield terminal('STOP')
    })())
    const onChunk = vi.fn()
    let done = false
    const result = synthesizeGeminiStream(params, 'test-key', onChunk).then(() => { done = true })
    await vi.waitFor(() => expect(onChunk).toHaveBeenCalledTimes(1))
    expect(done).toBe(false)
    release()
    await result
    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(done).toBe(true)
  })

  it.each(['OTHER', 'MAX_TOKENS', 'SAFETY', 'RECITATION'])('rejects incomplete audio ending with %s', async (reason) => {
    generate.mockResolvedValue((async function* () { yield chunk(); yield terminal(reason) })())
    await expect(synthesizeGeminiStream(params, 'test-key', vi.fn())).rejects.toThrow(reason)
  })

  it('rejects a clean network EOF without a terminal marker', async () => {
    generate.mockResolvedValue((async function* () { yield chunk() })())
    await expect(synthesizeGeminiStream(params, 'test-key', vi.fn())).rejects.toThrow('缺少结束标志')
  })

  it('reports an explicit prompt rejection rather than an EOF without a finish marker', async () => {
    generate.mockResolvedValue((async function* () { yield { promptFeedback: { blockReason: 'SAFETY' } } })())
    await expect(synthesizeGeminiStream(params, 'test-key', vi.fn())).rejects.toThrow('拒绝合成文本（SAFETY）')
  })

  it('disables SDK retries and does not block the backup through the shared queue after 429', async () => {
    generate.mockRejectedValue(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }))
    await expect(synthesizeGeminiStream(params, 'rate-stream-key', vi.fn())).rejects.toThrow('请求频率')
    expect(generate.mock.calls[0][0].config.httpOptions.retryOptions.attempts).toBe(1)
    expect(geminiRequestQueue.coolDown).not.toHaveBeenCalled()
  })

  it('does not issue a request that was already cancelled', async () => {
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(synthesizeGeminiStream(params, 'test-key', vi.fn(), { signal: abort.signal })).rejects.toThrow('cancelled')
    expect(generate).not.toHaveBeenCalled()
  })

  it('does not forward chunks after cancellation', async () => {
    const abort = new AbortController()
    generate.mockResolvedValue((async function* () { yield chunk(); yield chunk(); yield terminal('STOP') })())
    const onChunk = vi.fn(() => { abort.abort(new Error('cancelled')) })
    await expect(synthesizeGeminiStream(params, 'test-key', onChunk, { signal: abort.signal })).rejects.toThrow('cancelled')
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  it('rejects unexpected compressed audio instead of playing it as PCM', async () => {
    generate.mockResolvedValue((async function* () {
      yield { candidates: [{ content: { parts: [{ inlineData: { data: pcm(), mimeType: 'audio/mp3' } }] } }] }
      yield terminal('STOP')
    })())
    await expect(synthesizeGeminiStream(params, 'test-key', vi.fn())).rejects.toThrow('格式不受支持')
  })

  it('aborts a stalled connection instead of waiting indefinitely', async () => {
    vi.useFakeTimers()
    generate.mockImplementation(({ config }) => new Promise((_, reject) => {
      config.abortSignal.addEventListener('abort', () => reject(config.abortSignal.reason), { once: true })
    }))
    const result = synthesizeGeminiStream(params, 'test-key', vi.fn())
    const rejected = expect(result).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(45_000)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Gemini audio validation', () => {
  it('rejects the reported long chapter with 1.68 seconds of audio', () => {
    expect(() => assertGeminiAudioDuration('中'.repeat(7954), 1.68)).toThrow('严重不匹配')
  })
  it('accepts short utterances and plausible long chapters', () => {
    expect(validateGeminiWav('你好。', wav(1))).toBe(1)
    expect(validateGeminiWav('中'.repeat(7954), wav(1000))).toBe(1000)
  })
  it('rejects truncated WAV caches even when they have a nonempty body', () => {
    expect(() => validateGeminiWav('你好。', wav(2).subarray(0, 48_044))).toThrow('不完整')
  })
})
