import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from 'sonner'
import { ttsApi } from '@/api/tts-api'
import { getReaderContentProvider } from '@/lib/agent/context/reader-content-registry'
import type { TtsConfig, TtsProviderType, TtsStreamProgressPayload } from '@montree/contracts'
import {
  allocateSentenceTimeline,
  findCurrentSentenceIndex,
  findViewportStartingSentenceIndex,
  sanitizeReaderText,
  type SentenceItem,
} from '@/lib/reader/tts/text-sanitizer'
import {
  alignSentencesWithAudio,
  buildStaticCueMarkers,
  findActiveMarkerIndex,
} from '@/lib/reader/tts/audio-aligner'
import { PcmStreamPlayer, base64ToBytes, parsePcmRate } from '@/lib/reader/tts/pcm-player'

export interface TtsStoreState extends TtsConfig {
  // 运行时播放状态
  isSpeaking: boolean
  isPaused: boolean
  isLoading: boolean
  isReceiving: boolean
  isBuffering: boolean
  receivedDuration: number
  receptionProgress: TtsStreamProgressPayload | null
  receptionError: string | null
  receptionRetryAt: number
  playbackPositions: Record<string, { seconds: number; updatedAt: number }>
  isPlayerVisible: boolean
  isPlayerCollapsed: boolean // 悬浮球形态 (true) vs 展开控制卡片 (false)
  playerPosition: { x: number; y: number } | null // 悬浮球 / 播放卡片拖拽位置
  chapterProgress: Record<string, number> // 记忆各章节上次读取的句子索引
  currentTitle: string
  sentences: SentenceItem[]
  currentSentenceIndex: number
  currentTime: number
  duration: number
  isFromCache: boolean
  keyUsed: 'primary' | 'secondary' | 'system'
  cooldownUntil: number

  // 悬浮与位置控制
  setIsPlayerCollapsed: (collapsed: boolean) => void
  setPlayerPosition: (pos: { x: number; y: number } | null) => void
  saveChapterProgress: (title: string, index: number) => void

  // 配置更新动作
  setProvider: (provider: TtsProviderType) => void
  setPrimaryApiKey: (key: string) => void
  setSecondaryApiKey: (key: string) => void
  setVoiceName: (voice: string) => void
  setModelId: (model: string) => void
  setAzureApiKey: (key: string) => void
  setAzureRegion: (region: string) => void
  setAzureVoice: (voice: string) => void
  setLocalEndpoint: (endpoint: string) => void
  setLocalApiKey: (key: string) => void
  setLocalModel: (model: string) => void
  setLocalVoice: (voice: string) => void
  setRate: (rate: number) => void
  setSaveAudioCache: (save: boolean) => void
  setFilterFootnotesAndCitations: (filter: boolean) => void
  setFilterLinksAndTechnicalMarkup: (filter: boolean) => void
  setEnableBatch: (enable: boolean) => void

  // 播放控制
  playText: (
    title: string,
    rawText: string,
    options?: {
      viewportSnippet?: string
      startSentenceIndex?: number
    },
  ) => Promise<void>
  /** 从指定摘录/划词句子开始朗读（已在播放直接跳转，未播放自动提取全文启动） */
  playFromSnippet: (snippet: string, title?: string) => Promise<void>
  /** 将朗读进度立即对齐到当前屏幕正文顶部 */
  syncToViewport: () => Promise<void>
  togglePlayPause: () => void
  seekSentence: (index: number) => void
  /** 在当前章节音频中自由跳转到任意指定秒数（音频拖拽进度条模式） */
  seekTime: (targetSeconds: number) => void
  nextSentence: () => void
  prevSentence: () => void
  stop: () => void
  closePlayer: () => void
}

let activeAudio: HTMLAudioElement | null = null
let activeAudioUrl: string | null = null
let playbackGeneration = 0
let activePcmPlayer: PcmStreamPlayer | null = null
let activeCancelStream: (() => Promise<unknown>) | null = null
let streamProgressTimer: any = null
let activeAudioProgressTimer: any = null
let currentUtterance: SpeechSynthesisUtterance | null = null
let systemSentenceIndex = 0
let currentRawText = ''
let currentInitialSentenceIndex = 0
let activeBookmarkKey = ''
let playbackOffset = 0
let lastBookmarkAt = 0

function rememberPlaybackPosition(completed = false): void {
  if (!activeBookmarkKey) return
  const state = useTtsStore.getState()
  const seconds = activePcmPlayer ? playbackOffset + activePcmPlayer.playedSeconds : activeAudio?.currentTime ?? state.currentTime
  if (!completed && (!Number.isFinite(seconds) || seconds <= 0)) return
  const positions = { ...state.playbackPositions }
  if (completed) delete positions[activeBookmarkKey]
  else positions[activeBookmarkKey] = { seconds, updatedAt: Date.now() }
  const newest = Object.entries(positions).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 100)
  useTtsStore.setState({ playbackPositions: Object.fromEntries(newest) })
  if (completed) activeBookmarkKey = ''
  lastBookmarkAt = Date.now()
}

async function buildPlaybackPositionKey(text: string, config: TtsConfig): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return ''
  const identity = JSON.stringify([config.provider, config.voiceName, config.modelId, config.azureVoice, config.localModel, config.localVoice, text])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function stopAllPlayback(): void {
  rememberPlaybackPosition()
  activeBookmarkKey = ''
  playbackGeneration++
  if (streamProgressTimer) {
    clearInterval(streamProgressTimer)
    streamProgressTimer = null
  }
  if (activeAudioProgressTimer) {
    clearInterval(activeAudioProgressTimer)
    activeAudioProgressTimer = null
  }
  if (activeCancelStream) {
    void activeCancelStream()
    activeCancelStream = null
  }
  if (activePcmPlayer) {
    void activePcmPlayer.close()
    activePcmPlayer = null
  }
  if (activeAudio) {
    activeAudio.onended = null
    activeAudio.onloadedmetadata = null
    activeAudio.onerror = null
    activeAudio.pause()
    activeAudio.removeAttribute('src')
    activeAudio.load()
    activeAudio = null
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl)
    activeAudioUrl = null
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    currentUtterance = null
  }
}

function prefetchNextChapter(): void {
  if (!useTtsStore.getState().saveAudioCache) return
  const provider = getReaderContentProvider()
  if (!provider) return

  setTimeout(async () => {
    try {
      let nextText = ''
      let nextLabel = '下一章节'

      if (typeof provider.iterateUnits === 'function') {
        let foundCurrent = false
        for await (const unit of provider.iterateUnits()) {
          if (foundCurrent) {
            nextText = unit.text
            nextLabel = unit.label
            break
          }
          if (unit.label === useTtsStore.getState().currentTitle) {
            foundCurrent = true
          }
        }
      }

      if (nextText && nextText.trim()) {
        const state = useTtsStore.getState()
        const { fullCleanText } = sanitizeReaderText(nextText, {
          filterFootnotesAndCitations: state.filterFootnotesAndCitations,
          filterLinksAndTechnicalMarkup: state.filterLinksAndTechnicalMarkup,
        })
        if (fullCleanText) {
          void ttsApi.synthesize({
            text: fullCleanText,
            provider: state.provider,
            voiceName: state.voiceName,
            modelId: state.modelId,
            rate: state.rate,
            unitLabel: nextLabel,
            priority: 'background',
            primaryApiKey: state.primaryApiKey,
            secondaryApiKey: state.secondaryApiKey,
            azureApiKey: state.azureApiKey,
            azureRegion: state.azureRegion,
            localEndpoint: state.localEndpoint,
            localApiKey: state.localApiKey,
            localModel: state.localModel,
            localVoice: state.localVoice,
          })
        }
      }
    } catch (e) {
      console.warn('[TTS] 后台预取下一章跳过:', e)
    }
  }, 2000)
}

export const useTtsStore = create<TtsStoreState>()(
  persist(
    (set, get) => ({
      enabled: true,
      provider: 'gemini',
      primaryApiKey: '',
      secondaryApiKey: '',
      voiceName: 'Aoede',
      voiceNameMale: 'Puck',
      voiceNameFemale: 'Aoede',
      modelId: 'gemini-3.8-flash-lite-tts',
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

      // 运行时状态
      isSpeaking: false,
      isPaused: false,
      isLoading: false,
      isReceiving: false,
      isBuffering: false,
      receivedDuration: 0,
      receptionProgress: null,
      receptionError: null,
      receptionRetryAt: 0,
      playbackPositions: {},
      isPlayerVisible: false,
      isPlayerCollapsed: true,
      playerPosition: null,
      chapterProgress: {},
      currentTitle: '',
      sentences: [],
      currentSentenceIndex: 0,
      currentTime: 0,
      duration: 0,
      isFromCache: false,
      keyUsed: 'system',
      cooldownUntil: 0,

      setIsPlayerCollapsed: (isPlayerCollapsed) => set({ isPlayerCollapsed }),
      setPlayerPosition: (playerPosition) => set({ playerPosition }),
      saveChapterProgress: (title, index) => {
        if (!title) return
        const progress = { ...get().chapterProgress, [title]: index }
        set({ chapterProgress: progress })
      },

      setProvider: (provider) => {
        set({ provider })
        void ttsApi.saveConfig({ ...get(), provider })
      },
      setPrimaryApiKey: (primaryApiKey) => {
        set({ primaryApiKey: primaryApiKey.trim() })
        void ttsApi.saveConfig({ ...get(), primaryApiKey: primaryApiKey.trim() })
      },
      setSecondaryApiKey: (secondaryApiKey) => {
        set({ secondaryApiKey: secondaryApiKey.trim() })
        void ttsApi.saveConfig({ ...get(), secondaryApiKey: secondaryApiKey.trim() })
      },
      setVoiceName: (voiceName) => {
        set({ voiceName: voiceName.trim() })
        void ttsApi.saveConfig({ ...get(), voiceName: voiceName.trim() })
      },
      setModelId: (modelId) => {
        set({ modelId: modelId.trim() })
        void ttsApi.saveConfig({ ...get(), modelId: modelId.trim() })
      },
      setAzureApiKey: (azureApiKey) => {
        set({ azureApiKey: azureApiKey.trim() })
        void ttsApi.saveConfig({ ...get(), azureApiKey: azureApiKey.trim() })
      },
      setAzureRegion: (azureRegion) => {
        set({ azureRegion: azureRegion.trim() })
        void ttsApi.saveConfig({ ...get(), azureRegion: azureRegion.trim() })
      },
      setAzureVoice: (azureVoice) => {
        set({ azureVoice: azureVoice.trim() })
        void ttsApi.saveConfig({ ...get(), azureVoice: azureVoice.trim() })
      },
      setLocalEndpoint: (localEndpoint) => {
        set({ localEndpoint: localEndpoint.trim() })
        void ttsApi.saveConfig({ ...get(), localEndpoint: localEndpoint.trim() })
      },
      setLocalApiKey: (localApiKey) => {
        set({ localApiKey: localApiKey.trim() })
        void ttsApi.saveConfig({ ...get(), localApiKey: localApiKey.trim() })
      },
      setLocalModel: (localModel) => {
        set({ localModel: localModel.trim() })
        void ttsApi.saveConfig({ ...get(), localModel: localModel.trim() })
      },
      setLocalVoice: (localVoice) => {
        set({ localVoice: localVoice.trim() })
        void ttsApi.saveConfig({ ...get(), localVoice: localVoice.trim() })
      },
      setRate: (rate) => {
        const clamped = Math.max(0.5, Math.min(2.0, rate))
        set({ rate: clamped })
        if (activeAudio) {
          activeAudio.playbackRate = clamped
        }
        void ttsApi.saveConfig({ ...get(), rate: clamped })
      },
      setSaveAudioCache: (saveAudioCache) => {
        set({ saveAudioCache })
        void ttsApi.saveConfig({ ...get(), saveAudioCache })
      },
      setFilterFootnotesAndCitations: (filterFootnotesAndCitations) => {
        set({ filterFootnotesAndCitations })
        void ttsApi.saveConfig({ ...get(), filterFootnotesAndCitations })
      },
      setFilterLinksAndTechnicalMarkup: (filterLinksAndTechnicalMarkup) => {
        set({ filterLinksAndTechnicalMarkup })
        void ttsApi.saveConfig({ ...get(), filterLinksAndTechnicalMarkup })
      },
      setEnableBatch: (enableBatch) => {
        set({ enableBatch })
        void ttsApi.saveConfig({ ...get(), enableBatch })
      },

      playText: async (title: string, rawText: string) => {
        stopAllPlayback()
        const generation = playbackGeneration
        const isCurrentPlayback = () => generation === playbackGeneration

        const { sentences, fullCleanText } = sanitizeReaderText(rawText, {
          filterFootnotesAndCitations: get().filterFootnotesAndCitations,
          filterLinksAndTechnicalMarkup: get().filterLinksAndTechnicalMarkup,
        })
        if (!fullCleanText || sentences.length === 0) {
          toast.warning('当前版面或章节未包含有效可读正文')
          return
        }

        currentRawText = rawText
        currentInitialSentenceIndex = 0
        const bookmarkKey = await buildPlaybackPositionKey(fullCleanText, get())
        if (!isCurrentPlayback()) return
        const resumeSeconds = Math.max(0, get().playbackPositions[bookmarkKey]?.seconds ?? 0)
        activeBookmarkKey = bookmarkKey
        playbackOffset = resumeSeconds
        lastBookmarkAt = Date.now()
        if (resumeSeconds > 0) console.info('[TTS] 恢复播放位置', { positionKey: bookmarkKey.slice(0, 12), seconds: resumeSeconds })

        // Synthesis reuses the whole chapter's completed segments; playback may resume within them.
        const estimatedDur = Math.max(1, fullCleanText.length / 4.3)

        set({
          isLoading: true,
          isReceiving: false,
          isBuffering: false,
          receivedDuration: 0,
          receptionProgress: null,
          receptionError: null,
          receptionRetryAt: 0,
          isFromCache: false,
          isPlayerVisible: true,
          isPlayerCollapsed: false,
          currentTitle: title || '正在朗读',
          sentences: sentences,
          currentSentenceIndex: 0,
          currentTime: resumeSeconds,
          duration: estimatedDur,
          isSpeaking: true,
          isPaused: false,
        })

        const state = get()

        const startSystemSpeech = (startIndex: number) => {
          activeBookmarkKey = ''
          if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
            toast.error('当前系统不支持语音播放')
            set({ isLoading: false, isSpeaking: false })
            return
          }

          set({
            isLoading: false,
            isReceiving: false,
            isBuffering: false,
            keyUsed: 'system',
            isFromCache: false,
            duration: sentences.length * 3, // 估算
            currentSentenceIndex: startIndex,
            currentTime: 0,
            isSpeaking: true,
            isPaused: false,
          })

          systemSentenceIndex = startIndex
          const systemGeneration = playbackGeneration
          const speakNextSentence = (idx: number) => {
            if (systemGeneration !== playbackGeneration) return
            if (idx >= sentences.length) {
              set({ isSpeaking: false, isPaused: false })
              toast.success('本章朗读完毕')
              return
            }

            set({ currentSentenceIndex: idx })
            get().saveChapterProgress(get().currentTitle, idx)
            const item = sentences[idx]
            const utt = new SpeechSynthesisUtterance(item.text)
            currentUtterance = utt
            utt.rate = state.rate

            utt.onend = () => {
              speakNextSentence(idx + 1)
            }

            utt.onerror = (e) => {
              if (systemGeneration !== playbackGeneration || e.error === 'canceled' || e.error === 'interrupted') return
              console.warn('[TTS Web Speech Error]', { error: e.error, charIndex: e.charIndex, elapsedTime: e.elapsedTime })
              set({ isSpeaking: false, isPaused: false, isLoading: false })
              toast.error(`系统语音播放失败：${e.error}`)
            }

            window.speechSynthesis.speak(utt)
          }

          speakNextSentence(startIndex)
        }

        const shouldUseOnlineTts =
          (state.provider === 'gemini' && Boolean(state.primaryApiKey.trim() || state.secondaryApiKey.trim())) ||
          (state.provider === 'azure' && Boolean(state.azureApiKey?.trim())) ||
          (state.provider === 'local' && Boolean(state.localEndpoint?.trim()))

        if (shouldUseOnlineTts) {
          set({ isReceiving: true })
          const streamId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
          let pcmPlayer: PcmStreamPlayer | null = null

          // Main receives the whole chapter identity so disk segments can be reused across restarts.
          const speakText = fullCleanText

          if (state.provider === 'gemini') {
            try {
              pcmPlayer = new PcmStreamPlayer(24000)
              await pcmPlayer.resume()
              if (!isCurrentPlayback()) {
                void pcmPlayer.close()
                return
              }
              activePcmPlayer = pcmPlayer
            } catch (audioCtxErr) {
              console.warn('[TTS] Web Audio Context 初始化失败，将等待完整包播放:', audioCtxErr)
              void pcmPlayer?.close()
              pcmPlayer = null
            }
          }

          if (!isCurrentPlayback()) return
          let streamCompleted = false
          let streamFailed = false
          let receivedChunkCount = 0
          let remainingSkip = resumeSeconds

          if (pcmPlayer) {
            if (streamProgressTimer) clearInterval(streamProgressTimer)
            streamProgressTimer = setInterval(() => {
              const player = pcmPlayer
              if (!isCurrentPlayback() || !player || activePcmPlayer !== player || get().isPaused) return
              const played = playbackOffset + player.playedSeconds
              set({
                currentTime: played,
                isBuffering: !streamCompleted && !streamFailed && player.isDrained,
              })
              if (Date.now() - lastBookmarkAt >= 2000) rememberPlaybackPosition()

              // 检查音频是否全部播放完毕
              const currentDur = get().receivedDuration
              if (streamFailed && player.isDrained) {
                rememberPlaybackPosition()
                clearInterval(streamProgressTimer)
                streamProgressTimer = null
                void player.close()
                activePcmPlayer = null
                set({ isSpeaking: false, isPaused: true, isBuffering: false, currentTime: currentDur })
                return
              }
              if (streamCompleted && player.isDrained) {
                rememberPlaybackPosition(true)
                clearInterval(streamProgressTimer)
                streamProgressTimer = null
                if (activePcmPlayer) {
                  void activePcmPlayer.close()
                  activePcmPlayer = null
                }
                set({ isSpeaking: false, isPaused: false, isBuffering: false, currentTime: currentDur })
                toast.success('本章朗读完毕')
              }
            }, 100)
          }

          const { cancel, promise } = ttsApi.synthesizeStream(
            {
              streamId,
              text: speakText,
              provider: state.provider,
              voiceName: state.provider === 'azure' ? state.azureVoice : state.provider === 'local' ? state.localVoice : state.voiceName,
              modelId: state.provider === 'local' ? state.localModel : (state.modelId || 'gemini-3.8-flash-lite-tts'),
              rate: state.rate,
              unitLabel: title,
              primaryApiKey: state.primaryApiKey,
              secondaryApiKey: state.secondaryApiKey,
              azureApiKey: state.azureApiKey,
              azureRegion: state.azureRegion,
              localEndpoint: state.localEndpoint,
              localApiKey: state.localApiKey,
              localModel: state.localModel,
              localVoice: state.localVoice,
              enableBatch: state.enableBatch,
            },
            {
              onProgress: (progress) => {
                if (!isCurrentPlayback()) return
                set({ receptionProgress: progress })
              },
              onChunk: (chunk) => {
                if (!isCurrentPlayback()) return
                try {
                  const bytes = base64ToBytes(chunk.audioBase64)
                  const sampleRate = parsePcmRate(chunk.mimeType)
                  const player = pcmPlayer
                  const canPlayChunk = player && activePcmPlayer === player
                  if (canPlayChunk) {
                    const skipFrames = Math.min(Math.floor(bytes.length / 2), Math.floor(remainingSkip * sampleRate))
                    remainingSkip = Math.max(0, remainingSkip - skipFrames / sampleRate)
                    const playbackBytes = bytes.subarray(skipFrames * 2)
                    if (playbackBytes.length) {
                      player.pushChunk(playbackBytes, sampleRate)
                      receivedChunkCount++
                    }
                  }
                  const receivedDuration = get().receivedDuration + bytes.length / (sampleRate * 2)
                  set({
                    receivedDuration,
                    duration: Math.max(estimatedDur, receivedDuration),
                    isLoading: !canPlayChunk || receivedChunkCount === 0,
                    isSpeaking: !get().isPaused,
                    isBuffering: false,
                  })
                } catch (decErr) {
                  console.warn('[TTS] PCM 分片播放失败，将等待完整音频:', decErr)
                  void pcmPlayer?.close()
                  pcmPlayer = null
                  activePcmPlayer = null
                  clearInterval(streamProgressTimer)
                  streamProgressTimer = null
                  set({ isLoading: true, isBuffering: false })
                }
              },
              onEnd: (end) => {
                if (!isCurrentPlayback()) return
                streamCompleted = true
                const isCacheHit = end.fromCache
                set({
                  isFromCache: isCacheHit,
                  keyUsed: end.keyUsed ?? 'primary',
                  isReceiving: false,
                  isBuffering: false,
                  ...(pcmPlayer && !isCacheHit && pcmPlayer.receivedSeconds > 0
                    ? { duration: get().receivedDuration }
                    : {}),
                })

                const audioBytes = base64ToBytes(end.audioBase64)
                const audioBlob = new Blob([audioBytes.buffer as ArrayBuffer], { type: end.mimeType || 'audio/wav' })
                const audioUrl = URL.createObjectURL(audioBlob)
                activeAudioUrl = audioUrl
                const audio = new Audio(audioUrl)
                audio.playbackRate = get().rate
                activeAudio = audio

                let hasSetupTimeline = false
                const setupTimeline = async (dur: number) => {
                  if (!isCurrentPlayback() || activeAudio !== audio || hasSetupTimeline || !Number.isFinite(dur) || dur <= 0) return
                  hasSetupTimeline = true

                  let alignedEffective = sentences
                  try {
                    alignedEffective = await alignSentencesWithAudio(
                      sentences,
                      audioBytes,
                      dur,
                    )
                  } catch (alignErr) {
                    console.warn('[TTS] 声波对齐失败，降级静态比例标记:', alignErr)
                    const staticMarkers = buildStaticCueMarkers(sentences, dur)
                    alignedEffective = sentences.map((s, idx) => {
                      const m = staticMarkers[idx]
                      return {
                        ...s,
                        startTime: m.startTime,
                        endTime: m.endTime,
                        detectedPauseSec: m.detectedPauseSec,
                        alignmentType: m.alignmentType,
                      }
                    })
                  }

                  if (!isCurrentPlayback() || activeAudio !== audio) return
                  set({
                    duration: dur,
                    receivedDuration: dur,
                    sentences: alignedEffective,
                    isLoading: false,
                  })

                  if (isCacheHit || !pcmPlayer || receivedChunkCount === 0) {
                    if (pcmPlayer) {
                      void pcmPlayer.close()
                      activePcmPlayer = null
                    }
                    if (streamProgressTimer) {
                      clearInterval(streamProgressTimer)
                      streamProgressTimer = null
                    }
                    audio.currentTime = Math.min(resumeSeconds, Math.max(0, dur - 0.05))
                    set({
                      currentTime: audio.currentTime,
                      currentSentenceIndex: 0,
                    })
                    if (get().isPaused) return
                    audio.play().catch((err) => {
                      if (!isCurrentPlayback()) return
                      toast.error(`播放失败: ${err?.message || '未知错误'}`)
                      set({ isSpeaking: false })
                    })
                  }
                }

                audio.onloadedmetadata = () => {
                  const dur = audio.duration || 0
                  void setupTimeline(dur)
                }

                // 微任务兜底：部分 Data URL metadata 瞬时就绪，确保对齐绝不遗漏
                setTimeout(() => {
                  if (!hasSetupTimeline && audio.duration) {
                    void setupTimeline(audio.duration)
                  }
                }, 60)

                const updateAudioProgress = () => {
                  if (!isCurrentPlayback() || activePcmPlayer || activeAudio !== audio) return
                  const cur = activeAudio.currentTime
                  set({
                    currentTime: cur,
                  })
                  if (Date.now() - lastBookmarkAt >= 2000) rememberPlaybackPosition()
                }

                audio.ontimeupdate = updateAudioProgress
                audio.onplay = () => {
                  if (!isCurrentPlayback() || activeAudio !== audio) return
                  if (activeAudioProgressTimer) clearInterval(activeAudioProgressTimer)
                  activeAudioProgressTimer = setInterval(updateAudioProgress, 50)
                }
                audio.onpause = () => {
                  if (!isCurrentPlayback() || activeAudio !== audio) return
                  if (activeAudioProgressTimer) {
                    clearInterval(activeAudioProgressTimer)
                    activeAudioProgressTimer = null
                  }
                }

                audio.onended = () => {
                  if (!isCurrentPlayback() || activeAudio !== audio) return
                  if (activeAudioProgressTimer) {
                    clearInterval(activeAudioProgressTimer)
                    activeAudioProgressTimer = null
                  }
                  rememberPlaybackPosition(true)
                  set({ isSpeaking: false, isPaused: false })
                  toast.success('本章朗读完毕')
                }

                audio.onerror = () => {
                  if (!isCurrentPlayback()) return
                  if (activePcmPlayer) return
                  toast.error('音频解码播放失败')
                  set({ isSpeaking: false, isLoading: false })
                }

                prefetchNextChapter()
              },
              onError: (errPayload) => {
                if (!isCurrentPlayback()) return
                const pausedAt = activePcmPlayer ? playbackOffset + activePcmPlayer.playedSeconds : get().currentTime
                console.warn('[TTS] 接收中断，保留播放位置:', { streamId, seconds: pausedAt, error: errPayload.error })
                streamFailed = true
                const retryAt = errPayload.retryAt ?? 0
                if (activePcmPlayer && !activePcmPlayer.isDrained && receivedChunkCount > 0) {
                  rememberPlaybackPosition()
                  activeCancelStream = null
                  set({ isReceiving: false, isBuffering: false, isLoading: false, currentTime: pausedAt, receptionError: errPayload.error, receptionRetryAt: retryAt })
                  toast.error(`${errPayload.error}；已接收的 ${Math.floor(get().receivedDuration / 60)} 分钟音频会继续播放`)
                  return
                }
                stopAllPlayback()
                set({ isReceiving: false, isBuffering: false, isLoading: false, isSpeaking: false, isPaused: true, currentTime: pausedAt, receptionError: errPayload.error, receptionRetryAt: retryAt })
                toast.error(`云端接收中断（${errPayload.error || '未知'}），点击播放可继续；已完成的音频段会复用`)
              },
            },
          )

          activeCancelStream = cancel

          const startRes = await promise
          if (!isCurrentPlayback()) return
          if (!startRes.ok) {
            console.warn('[TTS] 接收启动失败:', startRes.error.message)
            stopAllPlayback()
            set({ isReceiving: false, isBuffering: false, isLoading: false, isSpeaking: false, isPaused: true, receptionError: startRes.error.message })
            toast.error(`云端接收启动失败（${startRes.error.message}），点击播放可重试`)
            return
          }

          return
        }

        // 2. 兜底回退：系统原生 Web Speech API
        startSystemSpeech(0)
      },

      playFromSnippet: async (snippet: string, title?: string) => {
        const clean = snippet.trim()
        if (!clean) return

        const state = get()
        // 1. 若当前已经有正文句子且播放器处于活动状态：直接寻找匹配句子瞬时 seek
        if (state.sentences.length > 0 && state.isPlayerVisible) {
          const targetIndex = findViewportStartingSentenceIndex(state.sentences, clean)
          if (targetIndex >= 0 && targetIndex < state.sentences.length) {
            get().seekSentence(targetIndex)
            if (state.isPaused) {
              get().togglePlayPause()
            }
            const snippetPreview = state.sentences[targetIndex].text.slice(0, 15)
            toast.success(`已定位至指定句子：${snippetPreview}…`)
            return
          }
        }

        // 2. 若未在朗读或切了章节：从正文 Provider 获取当前全文，将 snippet 作为起始视口
        const provider = getReaderContentProvider()
        if (!provider) {
          toast.warning('当前暂无可用阅读正文')
          return
        }
        try {
          const rawText = await provider.getCurrentText()
          if (!rawText.trim()) {
            toast.warning('当前章节未提取到可朗读正文')
            return
          }
          await get().playText(title || state.currentTitle || '当前章节', rawText, {
            viewportSnippet: clean,
          })
        } catch (e: any) {
          toast.error(`启动朗读失败: ${e?.message || '未知错误'}`)
        }
      },

      syncToViewport: async () => {
        const provider = getReaderContentProvider()
        if (!provider) {
          toast.warning('当前暂无可用阅读视口')
          return
        }
        try {
          let viewportSnippet = ''
          if (provider.getViewportText) {
            viewportSnippet = await provider.getViewportText()
          }
          if (!viewportSnippet.trim()) {
            toast.info('未能捕获当前屏幕可见文本')
            return
          }

          const state = get()
          if (state.sentences.length > 0 && state.isPlayerVisible) {
            const targetIndex = findViewportStartingSentenceIndex(state.sentences, viewportSnippet)
            if (targetIndex >= 0 && targetIndex < state.sentences.length) {
              get().seekSentence(targetIndex)
              if (state.isPaused) {
                get().togglePlayPause()
              }
              const snippetPreview = state.sentences[targetIndex].text.slice(0, 15)
              toast.success(`已对齐到当前屏幕：${snippetPreview}…`)
              return
            }
          }

          // 未在朗读时，直接从当前屏幕第一句开启朗读
          const rawText = await provider.getCurrentText()
          await get().playText(state.currentTitle || '当前章节', rawText, {
            viewportSnippet,
          })
          toast.success('已从当前屏幕开始朗读')
        } catch (e: any) {
          toast.error(`对齐当前屏幕失败: ${e?.message || '未知错误'}`)
        }
      },

      togglePlayPause: () => {
        if (get().receptionError && currentRawText && !activePcmPlayer) {
          if (get().receptionRetryAt > Date.now()) {
            toast.warning('请求额度尚未恢复；已缓存音频仍可播放，请待额度恢复后继续接收')
            return
          }
          void get().playText(get().currentTitle, currentRawText)
          return
        }
        const { isPaused, isSpeaking } = get()
        if (!isSpeaking && !isPaused) return
        if (!isPaused) rememberPlaybackPosition()

        if (activePcmPlayer) {
          if (isPaused) {
            void activePcmPlayer.resume()
            set({ isPaused: false, isSpeaking: true })
          } else {
            void activePcmPlayer.pause()
            set({ isPaused: true, isSpeaking: false })
          }
          return
        }

        if (activeAudio) {
          if (isPaused) {
            activeAudio.play().catch(() => {})
            set({ isPaused: false, isSpeaking: true })
          } else {
            activeAudio.pause()
            set({ isPaused: true, isSpeaking: false })
          }
          return
        }

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          if (isPaused) {
            window.speechSynthesis.resume()
            set({ isPaused: false, isSpeaking: true })
          } else {
            window.speechSynthesis.pause()
            set({ isPaused: true, isSpeaking: false })
          }
        }
      },

      seekSentence: (index: number) => {
        if (get().isReceiving || get().receptionError) return
        const { sentences } = get()
        if (index < 0 || index >= sentences.length) return

        get().saveChapterProgress(get().currentTitle, index)

        // 若用户点击跳转的目标句位于当前合成切片之前（index < currentInitialSentenceIndex），
        // 自动无缝重新从目标句起读并合成
        if (index < currentInitialSentenceIndex && currentRawText) {
          void get().playText(get().currentTitle, currentRawText, { startSentenceIndex: index })
          return
        }

        if (activePcmPlayer) {
          void activePcmPlayer.close()
          activePcmPlayer = null
          if (streamProgressTimer) {
            clearInterval(streamProgressTimer)
            streamProgressTimer = null
          }
        }

        if (activeAudio) {
          const target = sentences[index]
          if (target && target.startTime !== undefined) {
            activeAudio.currentTime = target.startTime
            set({ currentSentenceIndex: index, currentTime: target.startTime, isSpeaking: true, isPaused: false })
            activeAudio.play().catch((err) => {
              console.warn('[TTS] 跳转播放失败:', err)
            })
          }
          return
        }

        // 若完整音频尚未就绪（流式还在首包阶段），直接从目标句重新合成
        if (currentRawText) {
          void get().playText(get().currentTitle, currentRawText, { startSentenceIndex: index })
          return
        }

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel()
          systemSentenceIndex = index
          set({ currentSentenceIndex: index, isSpeaking: true, isPaused: false })

          const speakFrom = (idx: number) => {
            if (idx >= sentences.length) {
              set({ isSpeaking: false, isPaused: false })
              return
            }
            set({ currentSentenceIndex: idx })
            get().saveChapterProgress(get().currentTitle, idx)
            const utt = new SpeechSynthesisUtterance(sentences[idx].text)
            currentUtterance = utt
            utt.rate = get().rate
            utt.onend = () => speakFrom(idx + 1)
            window.speechSynthesis.speak(utt)
          }

          speakFrom(index)
        } else {
          set({ currentSentenceIndex: index })
        }
      },

      seekTime: (targetSeconds: number) => {
        const { duration, receivedDuration, isReceiving, receptionError } = get()
        const maxDur =
          isReceiving || Boolean(receptionError) || !activeAudio
            ? receivedDuration
            : (activeAudio?.duration || duration || 0)

        if (maxDur <= 0) return
        const clamped = Math.max(0, Math.min(maxDur, targetSeconds))

        if (activeAudio && !isReceiving) {
          if (activePcmPlayer) {
            void activePcmPlayer.close()
            activePcmPlayer = null
            if (streamProgressTimer) {
              clearInterval(streamProgressTimer)
              streamProgressTimer = null
            }
          }
          activeAudio.currentTime = clamped
          set({
            currentTime: clamped,
            isSpeaking: true,
            isPaused: false,
          })
          activeAudio.play().catch((err) => {
            console.warn('[TTS] 跳转时间播放失败:', err)
          })
          rememberPlaybackPosition()
          return
        }

        if (activePcmPlayer) {
          const pcmTarget = Math.max(0, clamped - playbackOffset)
          activePcmPlayer.seek(pcmTarget)
          set({
            currentTime: clamped,
            isSpeaking: true,
            isPaused: false,
            isBuffering: false,
          })
          void activePcmPlayer.resume()
          rememberPlaybackPosition()
          return
        }

        set({ currentTime: clamped })
      },

      nextSentence: () => {
        const { currentSentenceIndex, sentences } = get()
        if (currentSentenceIndex < sentences.length - 1) {
          get().seekSentence(currentSentenceIndex + 1)
        }
      },

      prevSentence: () => {
        const { currentSentenceIndex } = get()
        if (currentSentenceIndex > 0) {
          get().seekSentence(currentSentenceIndex - 1)
        }
      },

      stop: () => {
        stopAllPlayback()
        set({
          isSpeaking: false,
          isPaused: false,
          isLoading: false,
          isReceiving: false,
          isBuffering: false,
          receptionProgress: null,
          receptionError: null,
          receptionRetryAt: 0,
          currentTime: 0,
        })
      },

      closePlayer: () => {
        stopAllPlayback()
        set({
          isSpeaking: false,
          isPaused: false,
          isLoading: false,
          isReceiving: false,
          isBuffering: false,
          receptionProgress: null,
          receptionError: null,
          receptionRetryAt: 0,
          isPlayerVisible: false,
          currentTime: 0,
        })
      },
    }),
    {
      name: 'montree_tts_preferences',
      partialize: (state) => ({
        enabled: state.enabled,
        provider: state.provider,
        primaryApiKey: state.primaryApiKey,
        secondaryApiKey: state.secondaryApiKey,
        voiceName: state.voiceName,
        voiceNameMale: state.voiceNameMale,
        voiceNameFemale: state.voiceNameFemale,
        modelId: state.modelId,
        azureApiKey: state.azureApiKey,
        azureRegion: state.azureRegion,
        azureVoice: state.azureVoice,
        localEndpoint: state.localEndpoint,
        localApiKey: state.localApiKey,
        localModel: state.localModel,
        localVoice: state.localVoice,
        rate: state.rate,
        saveAudioCache: state.saveAudioCache,
        playerPosition: state.playerPosition,
        isPlayerCollapsed: state.isPlayerCollapsed,
        chapterProgress: state.chapterProgress,
        playbackPositions: state.playbackPositions,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          void ttsApi.saveConfig({
            enabled: state.enabled,
            provider: state.provider,
            primaryApiKey: state.primaryApiKey,
            secondaryApiKey: state.secondaryApiKey,
            voiceName: state.voiceName,
            voiceNameMale: state.voiceNameMale,
            voiceNameFemale: state.voiceNameFemale,
            modelId: state.modelId,
            azureApiKey: state.azureApiKey,
            azureRegion: state.azureRegion,
            azureVoice: state.azureVoice,
            localEndpoint: state.localEndpoint,
            localApiKey: state.localApiKey,
            localModel: state.localModel,
            localVoice: state.localVoice,
            rate: state.rate,
            saveAudioCache: state.saveAudioCache,
            filterFootnotesAndCitations: state.filterFootnotesAndCitations,
            filterLinksAndTechnicalMarkup: state.filterLinksAndTechnicalMarkup,
          })
        }
      },
    },
  ),
)

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const saveBeforeUnload = () => rememberPlaybackPosition()
  window.addEventListener('beforeunload', saveBeforeUnload)
  import.meta.hot?.dispose(() => window.removeEventListener('beforeunload', saveBeforeUnload))
}
