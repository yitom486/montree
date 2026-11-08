import type { TtsConfig, TtsStreamProgressPayload } from '@yitom/contracts'
import type { SentenceItem } from './text-sanitizer'

export interface TtsPlaybackState {
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
}

export interface TtsPlaybackActions {
  saveChapterProgress: (title: string, index: number) => void
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
  /** 让阅读器页面立即平滑跳转/翻页并聚焦到当前正在朗读的高亮句子处 */
  locateCurrentSentenceInReader: () => void
}

export type TtsPlaybackSnapshot = TtsConfig & TtsPlaybackState

/** 引擎只读写播放快照，不依赖 Zustand 或具体 store。 */
export interface TtsPlaybackStatePort {
  getState: () => TtsPlaybackSnapshot
  setState: (patch: Partial<TtsPlaybackState>) => void
}
