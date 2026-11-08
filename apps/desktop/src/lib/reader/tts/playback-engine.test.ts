import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ttsApi } from '@/api/tts-api'
import type { ReaderContentProvider } from '@/lib/agent/context/reader-content-registry'
import { createTtsPlaybackEngine, type TtsPlaybackEngine } from './playback-engine'
import type { TtsPlaybackSnapshot } from './playback-types'
import { sanitizeReaderText } from './text-sanitizer'

const { synthesizeStream, synthesize, getProvider } = vi.hoisted(() => ({
  synthesizeStream: vi.fn(), synthesize: vi.fn(), getProvider: vi.fn(),
}))
vi.mock('@/api/tts-api', () => ({ ttsApi: { synthesizeStream, synthesize } }))
vi.mock('@/lib/agent/context/reader-content-registry', () => ({ getReaderContentProvider: getProvider }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('./audio-aligner', () => ({
  alignSentencesWithAudio: vi.fn(async (sentences) => sentences),
  findActiveMarkerIndex: vi.fn(() => 0),
}))

class FakeAudio {
  static instances: FakeAudio[] = []
  duration = 10
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

function initialState(): TtsPlaybackSnapshot {
  return {
    enabled: true, provider: 'local', primaryApiKey: '', secondaryApiKey: '',
    voiceName: 'Aoede', voiceNameMale: 'Puck', voiceNameFemale: 'Aoede', modelId: 'test',
    localEndpoint: 'http://localhost:8880/v1', localVoice: 'test', localModel: 'test',
    rate: 1, saveAudioCache: true, highlightInReader: false,
    isSpeaking: false, isPaused: false, isLoading: false, isReceiving: false, isBuffering: false,
    receivedDuration: 0, receptionProgress: null, receptionError: null, receptionRetryAt: 0,
    playbackPositions: {}, isPlayerVisible: false, isPlayerCollapsed: true, playerPosition: null,
    chapterProgress: {}, currentTitle: '', sentences: [], currentSentenceIndex: 0,
    currentTime: 0, duration: 0, isFromCache: false, keyUsed: 'system', cooldownUntil: 0,
  }
}

const engines: TtsPlaybackEngine[] = []
function createPlayer(overrides: Partial<TtsPlaybackSnapshot> = {}) {
  let state = { ...initialState(), ...overrides }
  const engine = createTtsPlaybackEngine({
    getState: () => state,
    setState: (patch) => { state = { ...state, ...patch } },
  })
  engines.push(engine)
  return { engine, getState: () => state }
}

type StreamCallbacks = Parameters<typeof ttsApi.synthesizeStream>[1]
const streams: Array<{ callbacks: StreamCallbacks; cancel: ReturnType<typeof vi.fn> }> = []
function finish(index: number) {
  streams[index].callbacks.onEnd?.({
    streamId: String(index), totalChunks: 0, audioBase64: 'AAAA', mimeType: 'audio/wav', fromCache: true,
  })
  FakeAudio.instances.at(-1)?.onloadedmetadata?.()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('window', { speechSynthesis: { cancel: vi.fn(), speak: vi.fn() } })
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  FakeAudio.instances = []
  streams.length = 0
  getProvider.mockReset()
  synthesize.mockReset()
  synthesizeStream.mockReset()
  synthesizeStream.mockImplementation((_payload, callbacks) => {
    const cancel = vi.fn(async () => ({ ok: true }))
    streams.push({ callbacks, cancel })
    return { cancel, promise: Promise.resolve({ ok: true, value: { started: true } }) }
  })
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('playback engine without Zustand', () => {
  it('isolates audio, speed, stream cancellation and bookmarks between instances', async () => {
    const first = createPlayer()
    const second = createPlayer()
    await first.engine.actions.playText('甲章', '第一章正文。')
    finish(0)
    await second.engine.actions.playText('乙章', '第二章正文。')
    finish(1)
    await vi.advanceTimersByTimeAsync(100)
    const [audioA, audioB] = FakeAudio.instances
    first.engine.setPlaybackRate(1.5)
    expect(audioA.playbackRate).toBe(1.5)
    expect(audioB.playbackRate).toBe(1)
    audioA.currentTime = 2
    const lateProgress = audioA.ontimeupdate!
    first.engine.dispose()
    expect(streams[0].cancel).toHaveBeenCalledOnce()
    expect(streams[1].cancel).not.toHaveBeenCalled()
    expect(Object.values(first.getState().playbackPositions)[0].seconds).toBe(2)
    expect(second.getState().playbackPositions).toEqual({})
    expect(audioA.onplay).toBeNull()
    expect(audioA.ontimeupdate).toBeNull()
    lateProgress()
    expect(first.getState()).toMatchObject({ isSpeaking: false, currentTime: 0 })
    second.engine.actions.togglePlayPause()
    expect(second.getState().isPaused).toBe(true)
    second.engine.actions.togglePlayPause()
    expect(second.getState()).toMatchObject({ isPaused: false, isSpeaking: true })
  })

  it('disposes all timers and ignores late completion without starting chapter prefetch', async () => {
    getProvider.mockReturnValue({ filePath: 'book.epub', iterateUnits: async function* () {
      yield { label: '甲章', text: '第一章正文。' }
      yield { label: '乙章', text: '第二章正文。' }
    } } satisfies Partial<ReaderContentProvider>)
    const { engine, getState } = createPlayer()
    await engine.actions.playText('甲章', '第一章正文。')
    finish(0)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    engine.dispose()
    expect(vi.getTimerCount()).toBe(0)
    streams[0].callbacks.onEnd?.({ streamId: 'late', totalChunks: 0, audioBase64: 'AAAA', mimeType: 'audio/wav', fromCache: false })
    await vi.advanceTimersByTimeAsync(3000)
    expect(FakeAudio.instances).toHaveLength(1)
    expect(synthesize).not.toHaveBeenCalled()
    expect(getState()).toMatchObject({ isSpeaking: false, isReceiving: false })
  })

  it('invalidates a pending stream start when the engine is disposed', async () => {
    let completeStart!: (result: { ok: true }) => void
    synthesizeStream.mockImplementation((_payload, callbacks) => {
      const cancel = vi.fn()
      streams.push({ callbacks, cancel })
      return { cancel, promise: new Promise(resolve => { completeStart = resolve }) }
    })
    const { engine, getState } = createPlayer()
    const playing = engine.actions.playText('待启动', '待启动正文。')
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    engine.dispose()
    completeStart({ ok: true })
    await playing
    finish(0)
    expect(streams[0].cancel).toHaveBeenCalledOnce()
    expect(FakeAudio.instances).toHaveLength(0)
    expect(getState()).toMatchObject({ isSpeaking: false, isReceiving: false })
  })

  it('does not restart playback when pending reader extraction resolves after disposal', async () => {
    let completeText!: (text: string) => void
    const text = new Promise<string>(resolve => { completeText = resolve })
    getProvider.mockReturnValue({ filePath: 'book.epub', getCurrentText: () => text } satisfies ReaderContentProvider)
    const { engine, getState } = createPlayer()
    const playing = engine.actions.playFromSnippet('目标句子')
    engine.dispose()
    completeText('目标句子。后续正文。')
    await playing
    expect(synthesizeStream).not.toHaveBeenCalled()
    expect(getState().isSpeaking).toBe(false)
  })

  it('does not resume system speech from a stale seek callback after disposal', () => {
    const speak = vi.fn()
    vi.stubGlobal('window', { speechSynthesis: { cancel: vi.fn(), speak } })
    const { sentences } = sanitizeReaderText('第一句。第二句。第三句。')
    const { engine, getState } = createPlayer({ provider: 'system', sentences })
    engine.actions.seekSentence(1)
    const utterance = speak.mock.lastCall![0] as SpeechSynthesisUtterance
    const lateEnd = utterance.onend!
    engine.dispose()
    lateEnd.call(utterance, {} as SpeechSynthesisEvent)
    expect(speak).toHaveBeenCalledOnce()
    expect(getState().isSpeaking).toBe(false)
    expect(synthesizeStream).not.toHaveBeenCalled()
  })
})
