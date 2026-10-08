export type TtsProviderType = 'default' | 'gemini' | 'azure' | 'local' | 'system'

export interface TtsConfig {
  enabled: boolean
  provider: TtsProviderType

  // Gemini 配置
  primaryApiKey: string
  secondaryApiKey: string
  voiceName: string
  voiceNameMale: string
  voiceNameFemale: string
  modelId: string

  // Azure Speech (微软 TTS)
  azureApiKey?: string
  azureRegion?: string
  azureVoice?: string

  // Local OpenAI-compatible TTS
  localEndpoint?: string
  localApiKey?: string
  localModel?: string
  localVoice?: string

  rate: number
  saveAudioCache: boolean

  // 文本清洗与听书降噪偏好
  filterFootnotesAndCitations?: boolean
  filterLinksAndTechnicalMarkup?: boolean

  // Gemini 异步 Batch 模式（默认关闭）
  enableBatch?: boolean

  // 正文跟读高亮（仅在微软 Azure 等支持精准时间轴的引擎下生效，Gemini 保持纯净静默）
  highlightInReader?: boolean
}

export interface TtsSynthesizePayload {
  text: string
  provider?: TtsProviderType
  voiceName?: string
  modelId?: string
  rate?: number
  unitLabel?: string
  forceKeyType?: 'primary' | 'secondary'
  priority?: 'foreground' | 'background'
  enableBatch?: boolean

  // 可选厂商特定参数与密钥实时覆盖
  primaryApiKey?: string
  secondaryApiKey?: string
  azureApiKey?: string
  azureRegion?: string
  localEndpoint?: string
  localApiKey?: string
  localModel?: string
  localVoice?: string
}

export interface TtsSpeechBoundary {
  text: string
  audioOffsetMs: number
  durationMs: number
  textOffset?: number
  wordLength?: number
  boundaryType?: string
}

export interface TtsSynthesizeResult {
  audioBase64: string
  mimeType: string
  fromCache: boolean
  keyUsed?: 'primary' | 'secondary' | 'system'
  cooldownActivated?: boolean
  boundaries?: TtsSpeechBoundary[]
}

export interface TtsStreamChunkPayload {
  streamId: string
  chunkIndex: number
  audioBase64: string
  mimeType: string
}

export interface TtsStreamProgressPayload {
  streamId: string
  stage: 'queued' | 'receiving' | 'segment-complete' | 'complete'
  segmentIndex: number
  totalSegments: number
  completedSegments: number
  cachedSegments: number
  bufferedSeconds: number
  waitMs?: number
}

export interface TtsStreamEndPayload {
  streamId: string
  totalChunks: number
  audioBase64: string
  mimeType: string
  fromCache: boolean
  keyUsed?: 'primary' | 'secondary' | 'system'
  boundaries?: TtsSpeechBoundary[]
}

export interface TtsStreamErrorPayload {
  streamId: string
  error: string
  canFallbackToSystem?: boolean
  retryAt?: number
}

export interface TtsCacheStats {
  count: number
  totalBytes: number
}

export interface TtsTestKeyPayload {
  key: string
  provider?: TtsProviderType
  region?: string
  endpoint?: string
  modelId?: string
  voiceName?: string
  text?: string
}

export interface TtsTestKeyResult {
  latencyMs: number
  audioBase64: string
  mimeType: string
}

export interface TtsVoiceInfo {
  id: string
  name: string
  gender: 'male' | 'female' | 'neutral'
  description: string
  isRecommended?: boolean
  language?: string
}

export interface TtsRemoteModelItem {
  id: string
  name: string
  description?: string
  isRecommended?: boolean
  tier?: string
}

export interface TtsBatchItemPayload {
  key: string
  text: string
  voiceName?: string
  speechMetadata?: string
}

export interface TtsBatchCreatePayload {
  provider?: TtsProviderType
  apiKey?: string
  model?: string
  voiceName?: string
  displayName?: string
  items: TtsBatchItemPayload[]
}

export interface TtsBatchItemResult {
  key: string
  ok: boolean
  audioBase64?: string
  mimeType?: string
  error?: string
}

export interface TtsBatchJobStatus {
  name: string
  state: string
  model?: string
  displayName?: string
  results?: TtsBatchItemResult[]
}

