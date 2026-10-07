import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from 'sonner'
import { ttsApi } from '@/api/tts-api'
import { getReaderContentProvider } from '@/lib/agent/context/reader-content-registry'
import type { TtsConfig, TtsProviderType } from '@montree/contracts'
import {
  allocateSentenceTimeline,
  findCurrentSentenceIndex,
  findViewportStartingSentenceIndex,
  sanitizeReaderText,
  type SentenceItem,
} from '@/lib/reader/tts/text-sanitizer'

export interface TtsStoreState extends TtsConfig {
  // 运行时播放状态
  isSpeaking: boolean
  isPaused: boolean
  isLoading: boolean
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
  nextSentence: () => void
  prevSentence: () => void
  stop: () => void
  closePlayer: () => void
}

let activeAudio: HTMLAudioElement | null = null
let currentUtterance: SpeechSynthesisUtterance | null = null
let systemSentenceIndex = 0

function stopAllPlayback(): void {
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.removeAttribute('src')
    activeAudio.load()
    activeAudio = null
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    currentUtterance = null
  }
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
      modelId: 'gemini-3.8-flash-tts',
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

      // 运行时状态
      isSpeaking: false,
      isPaused: false,
      isLoading: false,
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

      playText: async (title: string, rawText: string, options) => {
        stopAllPlayback()

        const { sentences, fullCleanText } = sanitizeReaderText(rawText, {
          filterFootnotesAndCitations: get().filterFootnotesAndCitations,
          filterLinksAndTechnicalMarkup: get().filterLinksAndTechnicalMarkup,
        })
        if (!fullCleanText || sentences.length === 0) {
          toast.warning('当前版面或章节未包含有效可读正文')
          return
        }

        // 智能定位起始朗读句子：视口顶部优先 > 显式指定 > 历史记录 > 0
        let initialIndex = 0
        if (
          options?.startSentenceIndex !== undefined &&
          options.startSentenceIndex >= 0 &&
          options.startSentenceIndex < sentences.length
        ) {
          initialIndex = options.startSentenceIndex
        } else if (options?.viewportSnippet) {
          initialIndex = findViewportStartingSentenceIndex(sentences, options.viewportSnippet)
        } else if (get().chapterProgress[title] !== undefined) {
          const saved = get().chapterProgress[title]
          if (saved >= 0 && saved < sentences.length) {
            initialIndex = saved
          }
        }

        set({
          isLoading: true,
          isPlayerVisible: true,
          isPlayerCollapsed: true,
          currentTitle: title || '正在朗读',
          sentences,
          currentSentenceIndex: initialIndex,
          currentTime: 0,
          duration: 0,
          isSpeaking: true,
          isPaused: false,
        })

        const state = get()
        const shouldUseOnlineTts =
          (state.provider === 'gemini' && Boolean(state.primaryApiKey.trim() || state.secondaryApiKey.trim())) ||
          (state.provider === 'azure' && Boolean(state.azureApiKey?.trim())) ||
          (state.provider === 'local' && Boolean(state.localEndpoint?.trim()))

        if (shouldUseOnlineTts) {
          try {
            const result = await ttsApi.synthesize({
              text: fullCleanText,
              provider: state.provider,
              voiceName: state.provider === 'azure' ? state.azureVoice : state.provider === 'local' ? state.localVoice : state.voiceName,
              modelId: state.provider === 'local' ? state.localModel : state.modelId,
              rate: state.rate,
              unitLabel: title,
              azureApiKey: state.azureApiKey,
              azureRegion: state.azureRegion,
              localEndpoint: state.localEndpoint,
            })

            if (!result.ok) {
              throw new Error(result.error.message)
            }

            const data = result.value
            if (data.cooldownActivated) {
              set({ cooldownUntil: Date.now() + 60_000 })
              toast.info('主用 API 触发频率限制，已自动切换备用 Key 接管（60 秒后恢复免费 Key）')
            }

            if (data.keyUsed === 'system' || !data.audioBase64) {
              // 自动回退系统语音
              throw new Error('未获取到音频数据，回退至系统语音')
            }

            // 加载 base64 WAV 音频
            const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`)
            activeAudio = audio
            audio.playbackRate = state.rate

            audio.onloadedmetadata = () => {
              const dur = audio.duration || 0
              const timedSentences = allocateSentenceTimeline(sentences, dur)
              const startItem = timedSentences[initialIndex]
              const startSeek = startItem?.startTime || 0
              if (startSeek > 0) {
                audio.currentTime = startSeek
              }

              set({
                duration: dur,
                sentences: timedSentences,
                currentTime: startSeek,
                currentSentenceIndex: initialIndex,
                isFromCache: data.fromCache,
                keyUsed: data.keyUsed ?? 'primary',
                isLoading: false,
              })
              audio.play().catch((err) => {
                toast.error(`播放失败: ${err?.message || '未知错误'}`)
                set({ isSpeaking: false })
              })
            }

            audio.ontimeupdate = () => {
              const cur = audio.currentTime
              const curSentences = get().sentences
              const curIdx = findCurrentSentenceIndex(curSentences, cur)
              const prevIdx = get().currentSentenceIndex
              set({
                currentTime: cur,
                currentSentenceIndex: curIdx,
              })
              if (curIdx !== prevIdx) {
                get().saveChapterProgress(get().currentTitle, curIdx)
              }
            }

            audio.onended = () => {
              set({ isSpeaking: false, isPaused: false })
              toast.success('本章朗读完毕')
            }

            audio.onerror = () => {
              toast.error('音频解码播放失败')
              set({ isSpeaking: false, isLoading: false })
            }

            return
          } catch (err: any) {
            console.warn('[TTS] Gemini 合成失败，尝试降级系统原生语音:', err)
            toast.error(`Gemini 合成失败（${err?.message || '未知'}），已无缝切换系统原生语音兜底`)
          }
        }

        // 2. 兜底回退：系统原生 Web Speech API
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          toast.error('当前系统不支持语音播放')
          set({ isLoading: false, isSpeaking: false })
          return
        }

        set({
          isLoading: false,
          keyUsed: 'system',
          isFromCache: false,
          duration: sentences.length * 3, // 估算
        })

        systemSentenceIndex = initialIndex
        const speakNextSentence = (idx: number) => {
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
            if (e.error !== 'canceled') {
              console.warn('[TTS Web Speech Error]', e)
            }
          }

          window.speechSynthesis.speak(utt)
        }

        speakNextSentence(initialIndex)
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
        const { isPaused, isSpeaking } = get()
        if (!isSpeaking && !isPaused) return

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
        const { sentences } = get()
        if (index < 0 || index >= sentences.length) return

        get().saveChapterProgress(get().currentTitle, index)

        if (activeAudio) {
          const target = sentences[index]
          if (target && target.startTime !== undefined) {
            activeAudio.currentTime = target.startTime
            set({ currentSentenceIndex: index, currentTime: target.startTime })
            if (get().isPaused) {
              activeAudio.play().catch(() => {})
              set({ isPaused: false, isSpeaking: true })
            }
          }
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
          currentTime: 0,
        })
      },

      closePlayer: () => {
        stopAllPlayback()
        set({
          isSpeaking: false,
          isPaused: false,
          isLoading: false,
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
      }),
    },
  ),
)
