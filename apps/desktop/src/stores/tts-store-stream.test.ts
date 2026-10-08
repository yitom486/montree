import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ttsApi } from '@/api/tts-api'
import { useTtsStore } from './tts-store'

const { synthesizeStream, cancel, success, error } = vi.hoisted(() => ({
  synthesizeStream: vi.fn(), cancel: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
const storage = vi.hoisted(() => {
  const items = new Map<string, string>()
  const memoryStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
    removeItem: (key: string) => { items.delete(key) },
  }
  vi.stubGlobal('localStorage', memoryStorage)
  vi.stubGlobal('window', { localStorage: memoryStorage })
  return memoryStorage
})
vi.mock('@/api/tts-api', () => ({ ttsApi: {
  saveConfig: vi.fn(async () => ({ ok: true })), synthesizeStream, synthesize: vi.fn(),
} }))
vi.mock('sonner', () => ({ toast: { success, error, warning: vi.fn() } }))
vi.mock('@/lib/agent/context/reader-content-registry', () => ({ getReaderContentProvider: () => null }))
vi.mock('@/lib/reader/tts/audio-aligner', () => ({
  alignSentencesWithAudio: vi.fn(async (sentences) => sentences),
  buildStaticCueMarkers: vi.fn(),
  findActiveMarkerIndex: vi.fn(() => 0),
}))

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  currentTime = 0
  state = 'running'
  destination = {}
  starts: number[] = []
  constructor() { FakeAudioContext.instances.push(this) }
  createBuffer(_channels: number, frames: number, rate: number) {
    return { duration: frames / rate, getChannelData: () => new Float32Array(frames) }
  }
  createBufferSource() {
    return { buffer: null, connect: vi.fn(), start: (time: number) => { this.starts.push(time) } }
  }
  async resume() { this.state = 'running' }
  async suspend() { this.state = 'suspended' }
  async close() { this.state = 'closed' }
}

class FakeAudio {
  static instances: FakeAudio[] = []
  duration = 3
  currentTime = 0
  playbackRate = 1
  onloadedmetadata: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  onplay: (() => void) | null = null
  onpause: (() => void) | null = null
  ontimeupdate: (() => void) | null = null
  play = vi.fn(async () => { this.onplay?.() })
  pause = vi.fn(() => { this.onpause?.() })
  load = vi.fn()
  removeAttribute = vi.fn()
  constructor() { FakeAudio.instances.push(this) }
}

type Callbacks = Parameters<typeof ttsApi.synthesizeStream>[1]
const calls: Array<{ streamId: string; callbacks: Callbacks }> = []
function push(index: number, seconds: number) {
  const { streamId, callbacks } = calls[index]
  callbacks.onChunk?.({ streamId, chunkIndex: 0, audioBase64: btoa('\0'.repeat(seconds * 48_000)), mimeType: 'audio/L16;codec=pcm;rate=24000' })
}
function end(index: number, fromCache = false) {
  const { streamId, callbacks } = calls[index]
  callbacks.onEnd?.({ streamId, totalChunks: 2, audioBase64: 'AAAA', mimeType: 'audio/wav', fromCache, keyUsed: 'primary' })
}

describe('TTS receiving and playback lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { AudioContext: FakeAudioContext, speechSynthesis: { cancel: vi.fn(), speak: vi.fn() } })
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
    useTtsStore.getState().stop()
    FakeAudioContext.instances = []
    FakeAudio.instances = []
    calls.length = 0
    success.mockClear()
    error.mockClear()
    cancel.mockReset()
    synthesizeStream.mockImplementation((payload, callbacks) => {
      calls.push({ streamId: payload.streamId, callbacks })
      return { cancel, promise: Promise.resolve({ ok: true, value: { started: true } }) }
    })
    useTtsStore.setState({ provider: 'gemini', primaryApiKey: 'test-key', secondaryApiKey: '', rate: 1, playbackPositions: {} })
  })
  afterEach(() => {
    useTtsStore.getState().stop()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits after the first second, receives later chunks, and completes only when STOP and queue drain both occur', async () => {
    await useTtsStore.getState().playText('测试章', '第一句。第二句。')
    push(0, 1)
    expect(useTtsStore.getState().receivedDuration).toBe(1)
    const context = FakeAudioContext.instances[0]
    context.currentTime = 1.5
    await vi.advanceTimersByTimeAsync(100)
    expect(useTtsStore.getState()).toMatchObject({ isReceiving: true, isBuffering: true, isSpeaking: true, currentTime: 1 })
    expect(success).not.toHaveBeenCalled()
    push(0, 2)
    expect(context.starts).toEqual([0, 1.5])
    expect(useTtsStore.getState()).toMatchObject({ receivedDuration: 3, isBuffering: false })
    end(0)
    expect(useTtsStore.getState().isReceiving).toBe(false)
    context.currentTime = 3.45
    await vi.advanceTimersByTimeAsync(100)
    expect(success).not.toHaveBeenCalled()
    context.currentTime = 3.5
    await vi.advanceTimersByTimeAsync(100)
    expect(success).toHaveBeenCalledTimes(1)
    expect(useTtsStore.getState()).toMatchObject({ isSpeaking: false, currentTime: 3 })
    // Late metadata must not replay the completed chapter from the beginning.
    FakeAudio.instances[0].onloadedmetadata?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(FakeAudio.instances[0].play).not.toHaveBeenCalled()
  })

  it('receiving a chunk while paused does not change the user pause state', async () => {
    await useTtsStore.getState().playText('测试章', '第一句。第二句。')
    push(0, 1)
    useTtsStore.getState().togglePlayPause()
    push(0, 2)
    expect(useTtsStore.getState()).toMatchObject({ isReceiving: true, isPaused: true, isSpeaking: false, receivedDuration: 3 })
    expect(FakeAudioContext.instances[0].state).toBe('suspended')
    useTtsStore.getState().togglePlayPause()
    expect(useTtsStore.getState().isSpeaking).toBe(true)
  })

  it('uses the chunk sample rate for duration and playback', async () => {
    await useTtsStore.getState().playText('测试章', '第一句。')
    calls[0].callbacks.onChunk?.({ streamId: calls[0].streamId, chunkIndex: 0, audioBase64: btoa('\0'.repeat(32_000)), mimeType: 'audio/L16;codec=pcm;rate=16000' })
    expect(useTtsStore.getState().receivedDuration).toBe(1)
    FakeAudioContext.instances[0].currentTime = 1
    await vi.advanceTimersByTimeAsync(100)
    expect(useTtsStore.getState()).toMatchObject({ currentTime: 1, isBuffering: true })
  })

  it('preserves the playback position, plays the remaining buffer and pauses before explicit retry', async () => {
    await useTtsStore.getState().playText('测试章', '第一句。')
    push(0, 1)
    FakeAudioContext.instances[0].currentTime = 0.5
    calls[0].callbacks.onError?.({ streamId: calls[0].streamId, error: 'OTHER', canFallbackToSystem: true })
    expect(useTtsStore.getState()).toMatchObject({ isReceiving: false, isBuffering: false, isSpeaking: true, currentTime: 0.5, receptionError: 'OTHER' })
    expect(Object.values(useTtsStore.getState().playbackPositions)[0].seconds).toBe(0.5)
    expect(error).toHaveBeenCalledOnce()
    expect(success).not.toHaveBeenCalled()
    expect(FakeAudioContext.instances[0].state).toBe('running')
    FakeAudioContext.instances[0].currentTime = 1
    await vi.advanceTimersByTimeAsync(100)
    expect(useTtsStore.getState()).toMatchObject({ isSpeaking: false, isPaused: true, currentTime: 1 })
    useTtsStore.getState().togglePlayPause()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(useTtsStore.getState()).toMatchObject({ currentTime: 1, receptionError: null, isReceiving: true })
  })

  it('allows cached playback and pause/resume after daily quota failure without making another request', async () => {
    await useTtsStore.getState().playText('缓存章', '缓存正文。')
    push(0, 30)
    calls[0].callbacks.onError?.({ streamId: calls[0].streamId, error: '当天额度耗尽', retryAt: Date.now() + 8 * 3600000 })
    expect(useTtsStore.getState()).toMatchObject({ isSpeaking: true, isReceiving: false })
    useTtsStore.getState().togglePlayPause()
    expect(useTtsStore.getState().isPaused).toBe(true)
    useTtsStore.getState().togglePlayPause()
    expect(useTtsStore.getState().isSpeaking).toBe(true)
    expect(calls).toHaveLength(1)
    FakeAudioContext.instances[0].currentTime = 30
    await vi.advanceTimersByTimeAsync(100)
    useTtsStore.getState().togglePlayPause()
    expect(calls).toHaveLength(1)
    expect(success).not.toHaveBeenCalled()
  })

  it('tracks segment reception independently of playable audio and never treats a progress event as END', async () => {
    await useTtsStore.getState().playText('测试章', '第一句。')
    const progress = { streamId: calls[0].streamId, stage: 'queued' as const, segmentIndex: 4, totalSegments: 11, completedSegments: 3, cachedSegments: 3, bufferedSeconds: 448, waitMs: 15000 }
    calls[0].callbacks.onProgress?.(progress)
    expect(useTtsStore.getState()).toMatchObject({ isReceiving: true, receptionProgress: progress })
    calls[0].callbacks.onProgress?.({ ...progress, stage: 'complete', completedSegments: 11 })
    expect(useTtsStore.getState().isReceiving).toBe(true)
    expect(success).not.toHaveBeenCalled()
    useTtsStore.getState().stop()
    calls[0].callbacks.onProgress?.(progress)
    expect(useTtsStore.getState().receptionProgress).toBe(null)
  })

  it('resumes playback within cached PCM after reopening the same chapter and clears the bookmark on completion', async () => {
    await useTtsStore.getState().playText('测试章', '第一句。第二句。')
    push(0, 3)
    FakeAudioContext.instances[0].currentTime = 1.25
    useTtsStore.getState().closePlayer()
    const positions = useTtsStore.getState().playbackPositions
    expect(Object.values(positions)[0].seconds).toBe(1.25)
    expect(useTtsStore.persist.getOptions().partialize?.(useTtsStore.getState())).toMatchObject({ playbackPositions: positions })
    expect(JSON.parse(storage.getItem('montree_tts_preferences')!).state.playbackPositions).toEqual(positions)
    await useTtsStore.getState().playText('测试章', '第一句。第二句。')
    expect(useTtsStore.getState().currentTime).toBe(1.25)
    push(1, 3)
    const player = FakeAudioContext.instances[1]
    player.currentTime = 0.5
    await vi.advanceTimersByTimeAsync(100)
    expect(useTtsStore.getState().currentTime).toBe(1.75)
    end(1)
    expect(useTtsStore.getState().duration).toBe(3)
    player.currentTime = 1.75
    await vi.advanceTimersByTimeAsync(100)
    expect(useTtsStore.getState().playbackPositions).toEqual({})
    await useTtsStore.getState().playText('测试章', '第一句。第二句。')
    expect(useTtsStore.getState().currentTime).toBe(0)
  })

  it('does not apply another chapter text or voice bookmark and can resume a whole-file cache', async () => {
    await useTtsStore.getState().playText('相同标题', '正文甲。')
    push(0, 3)
    FakeAudioContext.instances[0].currentTime = 1
    useTtsStore.getState().closePlayer()
    await useTtsStore.getState().playText('相同标题', '正文乙。')
    expect(useTtsStore.getState().currentTime).toBe(0)
    await useTtsStore.getState().playText('相同标题', '正文甲。')
    end(2, true)
    FakeAudio.instances[0].onloadedmetadata?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(FakeAudio.instances[0].currentTime).toBe(1)
    expect(FakeAudio.instances[0].play).toHaveBeenCalledOnce()
  })

  it('still reports received duration when Web Audio cannot initialize', async () => {
    vi.stubGlobal('window', { speechSynthesis: { cancel: vi.fn() } })
    await useTtsStore.getState().playText('测试章', '第一句。')
    push(0, 1)
    expect(useTtsStore.getState()).toMatchObject({ isReceiving: true, receivedDuration: 1, isLoading: true })
    end(0)
    FakeAudio.instances[0].onloadedmetadata?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(FakeAudio.instances[0].play).toHaveBeenCalledOnce()
  })

  it('ignores late chunks, completion and errors after stopping', async () => {
    await useTtsStore.getState().playText('测试章', '第一句。')
    push(0, 1)
    useTtsStore.getState().stop()
    push(0, 2)
    end(0)
    calls[0].callbacks.onError?.({ streamId: calls[0].streamId, error: 'late', canFallbackToSystem: true })
    expect(useTtsStore.getState()).toMatchObject({ isReceiving: false, isSpeaking: false, currentTime: 0 })
    expect(FakeAudio.instances).toHaveLength(0)
    expect(error).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('an old chapter cannot replace the new chapter audio or metadata', async () => {
    await useTtsStore.getState().playText('旧章', '旧章正文。')
    push(0, 1)
    end(0)
    const oldMetadata = FakeAudio.instances[0].onloadedmetadata
    await useTtsStore.getState().playText('新章', '新章正文。')
    end(0)
    oldMetadata?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(useTtsStore.getState()).toMatchObject({ currentTitle: '新章', isReceiving: true, receivedDuration: 0 })
    expect(FakeAudio.instances).toHaveLength(1)
    expect(FakeAudio.instances[0].play).not.toHaveBeenCalled()
  })

  it('plays a valid cache via Audio even though no PCM chunks arrived', async () => {
    await useTtsStore.getState().playText('缓存章', '完整缓存正文。')
    end(0, true)
    FakeAudio.instances[0].onloadedmetadata?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(FakeAudio.instances[0].play).toHaveBeenCalledOnce()
    expect(useTtsStore.getState()).toMatchObject({ isReceiving: false, isFromCache: true, receivedDuration: 3 })
  })

  it('allows seeking backward and forward within ready audio while isReceiving is true', async () => {
    await useTtsStore.getState().playText('测试章', '第一句。第二句。第三句。')
    push(0, 4)
    expect(useTtsStore.getState()).toMatchObject({ isReceiving: true, receivedDuration: 4 })
    const context = FakeAudioContext.instances[0]
    context.currentTime = 3
    await vi.advanceTimersByTimeAsync(100)
    expect(useTtsStore.getState().currentTime).toBe(3)

    // 在流式接收期间快退回第 1 秒
    useTtsStore.getState().seekTime(1)
    expect(useTtsStore.getState()).toMatchObject({ currentTime: 1, isSpeaking: true })

    // 时钟推进 1 秒，播放进度平滑到达 2 秒
    context.currentTime = 4
    await vi.advanceTimersByTimeAsync(100)
    expect(useTtsStore.getState().currentTime).toBe(2)

    // 超出已接收缓冲区的跳转自动钳制在最大已就绪秒数（4秒）
    useTtsStore.getState().seekTime(10)
    expect(useTtsStore.getState().currentTime).toBe(4)
  })
})

