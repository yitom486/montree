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
}

export interface TtsSynthesizePayload {
  text: string
  provider?: TtsProviderType
  voiceName?: string
  modelId?: string
  rate?: number
  unitLabel?: string
  forceKeyType?: 'primary' | 'secondary'

  // 可选厂商特定参数
  azureApiKey?: string
  azureRegion?: string
  localEndpoint?: string
}

export interface TtsSynthesizeResult {
  audioBase64: string
  mimeType: string
  fromCache: boolean
  keyUsed?: 'primary' | 'secondary' | 'system'
  cooldownActivated?: boolean
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
}
