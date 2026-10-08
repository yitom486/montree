import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@montree/contracts'
import {
  DEFAULT_TTS_CONFIG,
  formatFriendlyErrorMessage,
  isRateLimitOrQuotaError,
  resolveTtsModelId,
  synthesizeTtsStream,
  synthesizeTts,
  testTtsKey,
  cancelTtsStream,
  listTtsVoices,
  GEMINI_CORE_VOICES,
} from './tts-service'

const { generate, readFile, writeFile, clientKeys } = vi.hoisted(() => ({ generate: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), clientKeys: [] as string[] }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  constructor({ apiKey }: { apiKey: string }) { clientKeys.push(apiKey) }
  models = { generateContentStream: generate }
} }))
vi.mock('./gemini-queue', async (importOriginal) => ({
  ...await importOriginal<typeof import('./gemini-queue')>(),
  geminiRequestQueue: { run: (work: () => Promise<unknown>) => work(), coolDown: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => '/test-tts-data' } }))
vi.mock('node:fs/promises', () => ({ readFile, writeFile, mkdir: vi.fn(), readdir: vi.fn(), stat: vi.fn(), unlink: vi.fn() }))

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

describe('tts-service stream integration', () => {
  beforeEach(() => {
    generate.mockReset()
    clientKeys.length = 0
    writeFile.mockReset()
    readFile.mockRejectedValue({ code: 'ENOENT' })
  })

  const audioChunk = (seconds: number) => ({ candidates: [{ content: { parts: [{ inlineData: {
    data: Buffer.alloc(seconds * 48_000).toString('base64'), mimeType: 'audio/L16;codec=pcm;rate=24000',
  } }] } }] })
  const payload = (text: string) => ({ streamId: 'test-stream', text, primaryApiKey: 'test-key', provider: 'gemini' as const })
  const sender = () => ({ send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() })

  it('sends END and saves the complete WAV only after every chunk and STOP', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    generate.mockResolvedValue((async function* () {
      yield audioChunk(1)
      await waiting
      yield audioChunk(2)
      yield { candidates: [{ finishReason: 'STOP' }] }
    })())
    const webContents = sender()
    await synthesizeTtsStream(webContents as unknown as Electron.WebContents, payload('你好。'))
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    expect(webContents.send.mock.calls.some(([channel]) => channel === IPC.TTS_STREAM_CHUNK)).toBe(false)
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_PROGRESS, expect.objectContaining({ stage: 'receiving', completedSegments: 0 })))
    expect(writeFile).not.toHaveBeenCalled()
    expect(webContents.send.mock.calls.some(([channel]) => channel === IPC.TTS_STREAM_END)).toBe(false)
    release()
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_END, expect.objectContaining({ totalChunks: 1 })))
    expect((writeFile.mock.calls[0][1] as Buffer).length).toBe(44 + 3 * 48_000)
  })

  it.each(['OTHER', 'MAX_TOKENS', 'missing', 'short-STOP'])('never saves or announces a partial chapter: %s', async (reason) => {
    generate.mockImplementation(async () => (async function* () {
      yield audioChunk(1)
      if (reason !== 'missing') yield { candidates: [{ finishReason: reason === 'short-STOP' ? 'STOP' : reason }] }
    })())
    const webContents = sender()
    await synthesizeTtsStream(webContents as unknown as Electron.WebContents, payload('中'.repeat(7954)))
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_ERROR, expect.anything()))
    expect(writeFile).not.toHaveBeenCalled()
    expect(webContents.send.mock.calls.some(([channel]) => channel === IPC.TTS_STREAM_CHUNK)).toBe(false)
    expect(webContents.send.mock.calls.some(([channel]) => channel === IPC.TTS_STREAM_END)).toBe(false)
  })

  it('skips an old invalid cache and starts a new stream', async () => {
    readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('tts-config.json')) throw { code: 'ENOENT' }
      return Buffer.from('old incomplete audio')
    })
    generate.mockResolvedValue((async function* () { yield audioChunk(1); yield { candidates: [{ finishReason: 'STOP' }] } })())
    const webContents = sender()
    const result = await synthesizeTtsStream(webContents as unknown as Electron.WebContents, payload('你好。'))
    expect(result.ok && result.value.fromCache).toBe(false)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_END, expect.objectContaining({ fromCache: false })))
  })

  it('splits long chapters without losing text and announces END only after the last segment', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    generate.mockImplementation(async () => (async function* () {
      if (++calls === 2) await waiting
      yield audioChunk(30)
      yield { candidates: [{ finishReason: 'STOP' }] }
    })())
    const text = '中'.repeat(1700)
    const webContents = sender()
    await synthesizeTtsStream(webContents as unknown as Electron.WebContents, payload(text))
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    expect(webContents.send.mock.calls.filter(([channel]) => channel === IPC.TTS_STREAM_CHUNK)).toHaveLength(1)
    expect(webContents.send.mock.calls.some(([channel]) => channel === IPC.TTS_STREAM_END)).toBe(false)
    release()
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_END, expect.objectContaining({ totalChunks: 3 })))
    expect(generate.mock.calls.map(([request]) => request.contents).join('')).toBe(text)
    expect(generate.mock.calls.every(([request]) => Array.from(request.contents).length <= 800)).toBe(true)
  })

  it('retries only the failed segment and never plays the failed attempt', async () => {
    let calls = 0
    generate.mockImplementation(async () => (async function* () {
      const index = ++calls
      yield audioChunk(index === 2 ? 1 : 30)
      yield { candidates: [{ finishReason: index === 2 ? 'OTHER' : 'STOP' }] }
    })())
    const webContents = sender()
    await synthesizeTtsStream(webContents as unknown as Electron.WebContents, payload('中'.repeat(900)))
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_END, expect.objectContaining({ totalChunks: 2 })))
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls[1][0].contents).toBe(generate.mock.calls[2][0].contents)
    expect(webContents.send.mock.calls.filter(([channel]) => channel === IPC.TTS_STREAM_CHUNK)).toHaveLength(2)
    expect(writeFile.mock.calls.filter(([path]) => path.endsWith('.segment.wav'))).toHaveLength(2)
  })

  it('does not retry a safety rejection', async () => {
    generate.mockImplementation(async () => (async function* () { yield { candidates: [{ finishReason: 'SAFETY' }] } })())
    const webContents = sender()
    await synthesizeTtsStream(webContents as unknown as Electron.WebContents, payload('你好。'))
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_ERROR, expect.anything()))
    expect(generate).toHaveBeenCalledOnce()
  })

  it('cancellation stops a chapter before requesting another segment or emitting END', async () => {
    generate.mockImplementation(async () => (async function* () { yield audioChunk(30); yield { candidates: [{ finishReason: 'STOP' }] } })())
    const webContents = sender()
    webContents.send.mockImplementation((channel) => { if (channel === IPC.TTS_STREAM_CHUNK) void cancelTtsStream('test-stream') })
    await synthesizeTtsStream(webContents as unknown as Electron.WebContents, payload('中'.repeat(1600)))
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_CHUNK, expect.anything()))
    expect(generate).toHaveBeenCalledOnce()
    expect(webContents.send.mock.calls.some(([channel]) => channel === IPC.TTS_STREAM_END)).toBe(false)
  })

  it('uses the same segmented generation path for nonstreaming synthesis and key tests', async () => {
    generate.mockImplementation(async () => (async function* () { yield audioChunk(30); yield { candidates: [{ finishReason: 'STOP' }] } })())
    expect((await synthesizeTts(payload('中'.repeat(900)))).ok).toBe(true)
    expect(generate).toHaveBeenCalledTimes(2)
    expect((await testTtsKey({ key: 'test-key', text: '测试。' })).ok).toBe(true)
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('reuses validated segments after a later segment failed', async () => {
    const cache = new Map<string, Buffer>()
    readFile.mockImplementation(async (path: string) => {
      if (cache.has(path)) return cache.get(path)
      throw { code: 'ENOENT' }
    })
    writeFile.mockImplementation(async (path: string, bytes: Buffer) => { cache.set(path, bytes) })
    let calls = 0
    generate.mockImplementation(async () => (async function* () {
      const index = ++calls
      yield audioChunk(30)
      yield { candidates: [{ finishReason: index === 2 ? 'SAFETY' : 'STOP' }] }
    })())
    const first = sender()
    await synthesizeTtsStream(first as unknown as Electron.WebContents, payload('中'.repeat(900)))
    await vi.waitFor(() => expect(first.send).toHaveBeenCalledWith(IPC.TTS_STREAM_ERROR, expect.anything()))
    expect(cache.size).toBe(1)
    const second = sender()
    await synthesizeTtsStream(second as unknown as Electron.WebContents, payload('中'.repeat(900)))
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledWith(IPC.TTS_STREAM_END, expect.objectContaining({ totalChunks: 2 })))
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls[2][0].contents).toBe('中'.repeat(100))
  })

  it('switches keys only for the failed segment, without replaying previous segments', async () => {
    let calls = 0
    generate.mockImplementation(async () => {
      if (++calls === 2) throw Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 })
      return (async function* () { yield audioChunk(30); yield { candidates: [{ finishReason: 'STOP' }] } })()
    })
    const webContents = sender()
    await synthesizeTtsStream(webContents as unknown as Electron.WebContents, { ...payload('中'.repeat(900)), primaryApiKey: 'rate-service-key', secondaryApiKey: 'test-secondary' })
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_END, expect.objectContaining({ totalChunks: 2, keyUsed: 'secondary' })))
    expect(generate.mock.calls.map(([request]) => request.contents.length)).toEqual([800, 100, 100])
    expect(clientKeys).toEqual(['rate-service-key', 'rate-service-key', 'test-secondary'])
  })

  it('cancels a startup still reading configuration before any cloud request', async () => {
    let release!: () => void
    readFile.mockImplementationOnce(() => new Promise((_, reject) => { release = () => reject({ code: 'ENOENT' }) }))
    const pending = synthesizeTtsStream(sender() as unknown as Electron.WebContents, { ...payload('正文。'), streamId: 'cancel-before-start' })
    await cancelTtsStream('cancel-before-start')
    release()
    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    expect(generate).not.toHaveBeenCalled()
  })

  it('tries the backup immediately after primary daily quota exhaustion, then reuses the completed whole cache', async () => {
    const dailyKey = 'daily-quota-test-key'
    const cached = new Map<string, Buffer>()
    readFile.mockImplementation(async (path: string) => { if (cached.has(path)) return cached.get(path); throw { code: 'ENOENT' } })
    writeFile.mockImplementation(async (path: string, bytes: Buffer) => { if (path.endsWith('.wav')) cached.set(path, bytes) })
    let count = 0
    generate.mockImplementation(async () => {
      if (++count === 2) throw Object.assign(new Error(JSON.stringify({ error: {
        code: 429, message: 'RESOURCE_EXHAUSTED',
        details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }, { retryDelay: '29184s' }],
      } })), { status: 429 })
      return (async function* () { yield audioChunk(30); yield { candidates: [{ finishReason: 'STOP' }] } })()
    })
    const request = { ...payload('中'.repeat(900)), primaryApiKey: dailyKey, secondaryApiKey: 'daily-secondary', forceKeyType: 'primary' as const }
    const first = sender()
    await synthesizeTtsStream(first as unknown as Electron.WebContents, request)
    await vi.waitFor(() => expect(first.send).toHaveBeenCalledWith(IPC.TTS_STREAM_END, expect.objectContaining({ totalChunks: 2, keyUsed: 'secondary' })))
    expect(generate).toHaveBeenCalledTimes(3)
    expect(clientKeys).toEqual([dailyKey, dailyKey, 'daily-secondary'])
    expect(generate.mock.calls.map(([request]) => request.contents.length)).toEqual([800, 100, 100])
    expect(first.send.mock.calls.filter(([channel]) => channel === IPC.TTS_STREAM_CHUNK)).toHaveLength(2)
    expect(writeFile.mock.calls.some(([path]) => path.endsWith('tts-quota.json'))).toBe(true)
    const second = sender()
    await synthesizeTtsStream(second as unknown as Electron.WebContents, request)
    await vi.waitFor(() => expect(second.send.mock.calls.find(([channel]) => channel === IPC.TTS_STREAM_END)?.[1].fromCache).toBe(true))
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it.each(['different', 'same', 'missing'])('stops only after all usable credentials are exhausted: %s backup', async (backup) => {
    const primary = `both-daily-primary-${backup}`
    const secondary = backup === 'different' ? 'both-daily-secondary' : backup === 'same' ? primary : ''
    const cached = new Map<string, Buffer>()
    readFile.mockImplementation(async (path: string) => { if (cached.has(path)) return cached.get(path); throw { code: 'ENOENT' } })
    writeFile.mockImplementation(async (path: string, bytes: Buffer) => { if (path.endsWith('.wav')) cached.set(path, bytes) })
    let count = 0
    generate.mockImplementation(async () => {
      if (++count > 1) throw new Error(JSON.stringify({ error: { code: 429, message: 'RESOURCE_EXHAUSTED', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }, { retryDelay: '29184s' }] } }))
      return (async function* () { yield audioChunk(30); yield { candidates: [{ finishReason: 'STOP' }] } })()
    })
    const request = { ...payload('中'.repeat(900)), primaryApiKey: primary, secondaryApiKey: secondary }
    const first = sender()
    await synthesizeTtsStream(first as unknown as Electron.WebContents, request)
    await vi.waitFor(() => expect(first.send).toHaveBeenCalledWith(IPC.TTS_STREAM_ERROR, expect.objectContaining({ retryAt: expect.any(Number), error: expect.stringContaining(backup === 'different' ? '主备 API Key 均' : '当天请求额度') })))
    const attempts = backup === 'different' ? 3 : 2
    expect(generate).toHaveBeenCalledTimes(attempts)
    expect(clientKeys).toEqual(backup === 'different' ? [primary, primary, secondary] : [primary, primary])
    expect(first.send.mock.calls.some(([channel]) => channel === IPC.TTS_STREAM_END)).toBe(false)
    const second = sender()
    await synthesizeTtsStream(second as unknown as Electron.WebContents, request)
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledWith(IPC.TTS_STREAM_ERROR, expect.anything()))
    expect(second.send).toHaveBeenCalledWith(IPC.TTS_STREAM_CHUNK, expect.anything())
    expect(generate).toHaveBeenCalledTimes(attempts)
  })

  it('gracefully skips an isolated segment persistently hitting OTHER after a successful segment, allowing the chapter to complete', async () => {
    let callCount = 0
    generate.mockImplementation(async () => (async function* () {
      callCount++
      if (callCount === 1) {
        yield audioChunk(30)
        yield { candidates: [{ finishReason: 'STOP' }] }
      } else {
        yield audioChunk(1)
        yield { candidates: [{ finishReason: 'OTHER' }] }
      }
    })())
    const webContents = sender()
    await synthesizeTtsStream(webContents as unknown as Electron.WebContents, payload('中'.repeat(900)))
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith(IPC.TTS_STREAM_END, expect.objectContaining({ totalChunks: 2 })))
    expect(webContents.send.mock.calls.some(([channel]) => channel === IPC.TTS_STREAM_ERROR)).toBe(false)
  })

  it('应当确保 Gemini 核心推荐音色排在首位，并自动过滤特定区域语言人设音色', async () => {
    const res = await listTtsVoices('gemini', 'test-key')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.length).toBeGreaterThanOrEqual(GEMINI_CORE_VOICES.length)
      expect(res.value[0].id).toBe('Aoede')
      expect(res.value[0].isRecommended).toBe(true)
      expect(res.value.some((v) => v.id === 'Puck')).toBe(true)
      expect(res.value.some((v) => v.id.startsWith('ar-'))).toBe(false)
    }
  })
})
