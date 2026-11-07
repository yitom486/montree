import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ttsApi } from '@/api/tts-api'
import type { TtsConfig, TtsProviderType } from '@yitom/contracts'
import { createTtsPlaybackEngine } from '@/lib/reader/tts/playback-engine'
import type { TtsPlaybackActions, TtsPlaybackSnapshot, TtsPlaybackState } from '@/lib/reader/tts/playback-types'
import { emitTtsHighlight, emitTtsClearHighlight } from '@/lib/reader/marks/mark-linkage'

export interface TtsStoreState extends TtsConfig, TtsPlaybackState, TtsPlaybackActions {
  highlightInReader: boolean
  setHighlightInReader: (highlightInReader: boolean) => void

  // 悬浮与位置控制
  setIsPlayerCollapsed: (collapsed: boolean) => void
  setPlayerPosition: (pos: { x: number; y: number } | null) => void

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
}

const playbackEngine = createTtsPlaybackEngine({
  getState: (): TtsPlaybackSnapshot => useTtsStore.getState(),
  setState: (patch) => useTtsStore.setState(patch),
})

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
      highlightInReader: true,

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
      setHighlightInReader: (highlightInReader) => {
        set({ highlightInReader })
        const isSupported = get().provider === 'azure' || get().isFromCache
        if (!highlightInReader || !isSupported) {
          emitTtsClearHighlight()
        } else if (get().isSpeaking && !get().isPaused && isSupported) {
          const sList = get().sentences
          const activeText = sList[get().currentSentenceIndex]?.text
          if (activeText) emitTtsHighlight(activeText)
        }
        void ttsApi.saveConfig({ ...get(), highlightInReader })
      },

      setProvider: (provider) => {
        set({ provider })
        if (provider !== 'azure' && !get().isFromCache) {
          emitTtsClearHighlight()
        }
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
        playbackEngine.setPlaybackRate(clamped)
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

      ...playbackEngine.actions,
      locateCurrentSentenceInReader: () => {
        const state = get()
        if (!state.highlightInReader) {
          set({ highlightInReader: true })
          void ttsApi.saveConfig({ ...state, highlightInReader: true })
        }
        playbackEngine.actions.locateCurrentSentenceInReader()
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
        highlightInReader: state.highlightInReader,
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
            highlightInReader: state.highlightInReader,
          })
        }
      },
    },
  ),
)

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const saveBeforeUnload = () => playbackEngine.savePlaybackPosition()
  window.addEventListener('beforeunload', saveBeforeUnload)
  import.meta.hot?.dispose(() => {
    window.removeEventListener('beforeunload', saveBeforeUnload)
    playbackEngine.dispose()
  })
}
