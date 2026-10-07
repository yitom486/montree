import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  CheckCircle2,
  ChevronDown,
  Database,
  ExternalLink,
  Filter,
  HelpCircle,
  Loader2,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Square,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTtsStore } from '@/stores/tts-store'
import { ttsApi } from '@/api/tts-api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { TtsProviderType } from '@montree/contracts'

const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash-tts', name: 'Gemini 3.8 Flash TTS', desc: 'Google 官方语音合成与朗读专属模型 (推荐)' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', desc: 'Google 2.0 实时多模态音频模型' },
]

const GEMINI_VOICES = [
  { id: 'Aoede', name: 'Aoede', desc: '优雅知性 · 女声 (推荐)', gender: 'female' },
  { id: 'Puck', name: 'Puck', desc: '阳光活力 · 男声 (推荐)', gender: 'male' },
  { id: 'Charon', name: 'Charon', desc: '低沉沉稳 · 男声', gender: 'male' },
  { id: 'Kore', name: 'Kore', desc: '温柔治愈 · 女声', gender: 'female' },
  { id: 'Fenrir', name: 'Fenrir', desc: '雄浑有力 · 男声', gender: 'male' },
  { id: 'Leda', name: 'Leda', desc: '清澈明朗 · 女声', gender: 'female' },
]

function formatUiErrorMessage(msg: string): string {
  if (!msg) return '未知错误'
  try {
    const match = msg.match(/\{[\s\S]*"error"[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      const m = parsed?.error?.message || ''
      if (m.includes('This model only supports text output') || m.includes('supports text output')) {
        return '当前模型为纯文本模型，不支持语音输出。已自动为您切换为官方语音模型 gemini-3.8-flash-tts。'
      }
      if (m) return m
    }
  } catch {}
  if (msg.includes('This model only supports text output') || msg.includes('supports text output')) {
    return '当前模型为纯文本模型，不支持语音输出。请切换为官方语音模型 gemini-3.8-flash-tts。'
  }
  return msg
}

const AZURE_REGIONS = [
  { id: 'eastasia', name: '东亚 (East Asia / 香港)' },
  { id: 'japaneast', name: '日本东 (Japan East / 东京)' },
  { id: 'southeastasia', name: '东南亚 (Southeast Asia / 新加坡)' },
  { id: 'eastus', name: '美国东部 (East US / 弗吉尼亚)' },
  { id: 'westus2', name: '美国西部 (West US 2)' },
  { id: 'westeurope', name: '西欧 (West Europe / 荷兰)' },
]

const AZURE_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (Xiaoxiao)', desc: '自然亲切 · 中文女声 (默认)' },
  { id: 'zh-CN-YunxiNeural', name: '云希 (Yunxi)', desc: '沉稳自然 · 中文男声' },
  { id: 'zh-CN-YunjianNeural', name: '云健 (Yunjian)', desc: '影视解说 · 沉稳男声' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊 (Xiaoyi)', desc: '多情景有声书 · 女声' },
  { id: 'zh-TW-HsiaoChenNeural', name: '晓臻 (HsiaoChen)', desc: '繁体中文 · 女声' },
  { id: 'en-US-JennyNeural', name: 'Jenny', desc: '自然流利 · 美音女声' },
  { id: 'ja-JP-NanamiNeural', name: '七海 (Nanami)', desc: '自然清澈 · 日语女声' },
]

export function TtsSettingsSection() {
  const {
    provider,
    primaryApiKey,
    secondaryApiKey,
    voiceName,
    modelId,
    azureApiKey,
    azureRegion,
    azureVoice,
    localEndpoint,
    localApiKey,
    localModel,
    localVoice,
    rate,
    saveAudioCache,
    filterFootnotesAndCitations,
    filterLinksAndTechnicalMarkup,
    setProvider,
    setPrimaryApiKey,
    setSecondaryApiKey,
    setVoiceName,
    setModelId,
    setAzureApiKey,
    setAzureRegion,
    setAzureVoice,
    setLocalEndpoint,
    setLocalApiKey,
    setLocalModel,
    setLocalVoice,
    setRate,
    setSaveAudioCache,
    setFilterFootnotesAndCitations,
    setFilterLinksAndTechnicalMarkup,
  } = useTtsStore(
    useShallow((s) => ({
      provider: s.provider,
      primaryApiKey: s.primaryApiKey,
      secondaryApiKey: s.secondaryApiKey,
      voiceName: s.voiceName,
      modelId: s.modelId,
      azureApiKey: s.azureApiKey,
      azureRegion: s.azureRegion,
      azureVoice: s.azureVoice,
      localEndpoint: s.localEndpoint,
      localApiKey: s.localApiKey,
      localModel: s.localModel,
      localVoice: s.localVoice,
      rate: s.rate,
      saveAudioCache: s.saveAudioCache,
      filterFootnotesAndCitations: s.filterFootnotesAndCitations,
      filterLinksAndTechnicalMarkup: s.filterLinksAndTechnicalMarkup,
      setProvider: s.setProvider,
      setPrimaryApiKey: s.setPrimaryApiKey,
      setSecondaryApiKey: s.setSecondaryApiKey,
      setVoiceName: s.setVoiceName,
      setModelId: s.setModelId,
      setAzureApiKey: s.setAzureApiKey,
      setAzureRegion: s.setAzureRegion,
      setAzureVoice: s.setAzureVoice,
      setLocalEndpoint: s.setLocalEndpoint,
      setLocalApiKey: s.setLocalApiKey,
      setLocalModel: s.setLocalModel,
      setLocalVoice: s.setLocalVoice,
      setRate: s.setRate,
      setSaveAudioCache: s.setSaveAudioCache,
      setFilterFootnotesAndCitations: s.setFilterFootnotesAndCitations,
      setFilterLinksAndTechnicalMarkup: s.setFilterLinksAndTechnicalMarkup,
    })),
  )

  const [testingKey, setTestingKey] = useState<string | null>(null)
  const [modelSectionOpen, setModelSectionOpen] = useState(false)
  const [textCleaningSectionOpen, setTextCleaningSectionOpen] = useState(false)
  const [cacheSectionOpen, setCacheSectionOpen] = useState(false)
  const [cacheStats, setCacheStats] = useState<{ count: number; totalBytes: number } | null>(null)
  const [clearingCache, setClearingCache] = useState(false)

  // 试听状态
  const [previewText, setPreviewText] = useState('您好，欢迎使用 Montree 智能伴读。今天也一起静心阅读吧。')
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null)

  const refreshCacheStats = async () => {
    try {
      const res = await ttsApi.getCacheStats()
      if (res.ok) {
        setCacheStats(res.value)
      }
    } catch {
      setCacheStats({ count: 0, totalBytes: 0 })
    }
  }

  useEffect(() => {
    void refreshCacheStats()
  }, [])

  // 针对历史旧版本配置脏数据进行自动自愈（将纯文本模型自动纠正为语音专属模型）
  useEffect(() => {
    if (!modelId || modelId.includes('gemini-2.5') || modelId.includes('gemini-1.5') || !modelId.includes('gemini-')) {
      setModelId('gemini-3.8-flash-tts')
    }
  }, [modelId, setModelId])

  // 测试 Key 连通性
  const handleTestKey = async (type: 'gemini-primary' | 'gemini-secondary' | 'azure' | 'local') => {
    setTestingKey(type)
    try {
      let key = ''
      let prov: TtsProviderType = 'gemini'
      let region = azureRegion || 'eastasia'
      let endpoint = localEndpoint || 'http://127.0.0.1:8880/v1'

      if (type === 'gemini-primary') {
        key = primaryApiKey.trim()
        prov = 'gemini'
      } else if (type === 'gemini-secondary') {
        key = secondaryApiKey.trim()
        prov = 'gemini'
      } else if (type === 'azure') {
        key = (azureApiKey || '').trim()
        prov = 'azure'
      } else if (type === 'local') {
        key = (localApiKey || '').trim()
        prov = 'local'
      }

      if (!key && type !== 'local') {
        toast.warning('请先填写对应的 API Key')
        return
      }

      const activeModelId = prov === 'gemini'
        ? (modelId && !modelId.includes('gemini-2.5') ? modelId : 'gemini-3.8-flash-tts')
        : localModel

      const res = await ttsApi.testKey({
        key,
        provider: prov,
        region,
        endpoint,
        text: '测试连接成功，音质清晰正常。',
        voiceName: prov === 'azure' ? (azureVoice || 'zh-CN-XiaoxiaoNeural') : voiceName,
        modelId: activeModelId,
      })

      if (!res.ok) {
        toast.error(`测试失败: ${formatUiErrorMessage(res.error.message)}`)
        return
      }

      toast.success(`验证成功！接口响应延迟: ${res.value.latencyMs}ms`)
      if (res.value.audioBase64) {
        const audio = new Audio(`data:${res.value.mimeType};base64,${res.value.audioBase64}`)
        void audio.play()
      }
    } catch (err: any) {
      toast.error(`测试发生错误: ${err?.message || '未知错误'}`)
    } finally {
      setTestingKey(null)
    }
  }

  // 播放试听
  const handleTogglePreview = async () => {
    if (isPreviewing) {
      if (previewAudio) {
        previewAudio.pause()
        setPreviewAudio(null)
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
      setIsPreviewing(false)
      return
    }

    const textToPlay = previewText.trim() || '您好，欢迎使用 Montree 智能伴读。'

    if (provider === 'system' || provider === 'default') {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        toast.error('系统不支持 Web Speech API')
        return
      }
      const utt = new SpeechSynthesisUtterance(textToPlay)
      utt.rate = rate
      utt.onend = () => setIsPreviewing(false)
      utt.onerror = () => setIsPreviewing(false)
      setIsPreviewing(true)
      window.speechSynthesis.speak(utt)
      return
    }

    setIsPreviewing(true)
    try {
      const res = await ttsApi.synthesize({
        text: textToPlay,
        provider,
        voiceName: provider === 'azure' ? (azureVoice || 'zh-CN-XiaoxiaoNeural') : voiceName,
        modelId,
        rate,
        azureApiKey,
        azureRegion,
        localEndpoint,
      })

      if (!res.ok || !res.value.audioBase64) {
        throw new Error(res.ok ? '未获取到音频数据' : res.error.message)
      }

      const audio = new Audio(`data:${res.value.mimeType};base64,${res.value.audioBase64}`)
      audio.playbackRate = rate
      setPreviewAudio(audio)

      audio.onended = () => {
        setIsPreviewing(false)
        setPreviewAudio(null)
      }
      audio.onerror = () => {
        toast.error('音频解码试听失败')
        setIsPreviewing(false)
      }

      await audio.play()
    } catch (err: any) {
      toast.error(`试听失败: ${err?.message || '未知错误'}`)
      setIsPreviewing(false)
    }
  }

  const handleClearCache = async () => {
    setClearingCache(true)
    try {
      const res = await ttsApi.clearCache()
      if (res.ok) {
        toast.success('本地音频缓存已清空')
        await refreshCacheStats()
      } else {
        toast.error(`清理失败: ${res.error.message}`)
      }
    } finally {
      setClearingCache(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  return (
    <div className="space-y-6">
      {/* 头部标题与服务商切换 Tabs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">语音朗读设置</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              配置听书朗读引擎（Google Gemini / 微软 Azure Speech / 本地 OpenAI / 系统兜底）
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            已连接
          </span>
        </div>

        {/* 4 大服务商切换 Tabs（对齐截图设计） */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-muted/50 border border-border/60">
          {[
            { id: 'default', label: '服务默认 (系统原生)' },
            { id: 'gemini', label: 'Google Gemini TTS' },
            { id: 'azure', label: 'Azure Speech TTS (微软)' },
            { id: 'local', label: 'Local OpenAI-compatible' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setProvider(item.id as TtsProviderType)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer',
                (provider === item.id || (provider === 'system' && item.id === 'default'))
                  ? 'bg-amber-500 text-white font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* ==================== 1. Google Gemini TTS 配置区 ==================== */}
      {(provider === 'gemini') && (
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              <span className="text-sm font-semibold text-foreground">Google Gemini TTS 凭证与容灾</span>
            </div>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              获取 Gemini API Key
              <ExternalLink className="size-3" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 主用 Key */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">主用 API Key (优先免费配额)</label>
                <button
                  type="button"
                  onClick={() => void handleTestKey('gemini-primary')}
                  disabled={testingKey === 'gemini-primary'}
                  className="text-[11px] text-primary hover:underline cursor-pointer disabled:opacity-50"
                >
                  {testingKey === 'gemini-primary' ? '正在测试…' : '▷ 测试有效性'}
                </button>
              </div>
              <Input
                type="password"
                placeholder="AIzaSy..."
                value={primaryApiKey}
                onChange={(e) => setPrimaryApiKey(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>

            {/* 备用 Key */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">备用 API Key (可选，付费兜底)</label>
                <button
                  type="button"
                  onClick={() => void handleTestKey('gemini-secondary')}
                  disabled={testingKey === 'gemini-secondary'}
                  className="text-[11px] text-primary hover:underline cursor-pointer disabled:opacity-50"
                >
                  {testingKey === 'gemini-secondary' ? '正在测试…' : '▷ 测试有效性'}
                </button>
              </div>
              <Input
                type="password"
                placeholder="AIzaSy..."
                value={secondaryApiKey}
                onChange={(e) => setSecondaryApiKey(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted/30 p-2.5 rounded-lg border border-border/40">
            支持主备双 Key 智能容灾：主用 Key 触发 Google 1 分钟频率限制 (429 / 15 RPM) 时，系统自动无缝切换至备用 Key 接管；60 秒冷却后自动恢复优先使用免费 Key。
          </p>
        </div>
      )}

      {/* ==================== 2. Azure Speech TTS (微软) 配置区 ==================== */}
      {provider === 'azure' && (
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="size-4 text-blue-500" />
              <span className="text-sm font-semibold text-foreground">微软 Azure Speech 凭证与区域</span>
            </div>
            <a
              href="https://azure.microsoft.com/products/ai-services/text-to-speech"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              获取 Azure Speech Key
              <ExternalLink className="size-3" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Azure Key */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">Azure Speech Key</label>
                <button
                  type="button"
                  onClick={() => void handleTestKey('azure')}
                  disabled={testingKey === 'azure'}
                  className="text-[11px] text-primary hover:underline cursor-pointer disabled:opacity-50"
                >
                  {testingKey === 'azure' ? '正在测试…' : '▷ 测试有效性'}
                </button>
              </div>
              <Input
                type="password"
                placeholder="例如 32位 Azure Speech 密钥"
                value={azureApiKey || ''}
                onChange={(e) => setAzureApiKey(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>

            {/* Region 区域 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">服务区域 Region</label>
              <select
                value={azureRegion || 'eastasia'}
                onChange={(e) => setAzureRegion(e.target.value)}
                className="w-full h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground"
              >
                {AZURE_REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 微软神经元音色选择 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">常用神经网络音色</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AZURE_VOICES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setAzureVoice(v.id)}
                  className={cn(
                    'flex flex-col text-left p-2 rounded-lg border text-xs transition-colors cursor-pointer',
                    (azureVoice || 'zh-CN-XiaoxiaoNeural') === v.id
                      ? 'border-primary/50 bg-primary/10 text-primary font-medium'
                      : 'border-border/50 hover:bg-muted/50 text-foreground',
                  )}
                >
                  <span className="font-semibold">{v.name}</span>
                  <span className="text-[10px] text-muted-foreground">{v.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 3. Local OpenAI-compatible 配置区 ==================== */}
      {provider === 'local' && (
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="size-4 text-emerald-500" />
              <span className="text-sm font-semibold text-foreground">本地 OpenAI 兼容服务 (Kokoro / ChatTTS 等)</span>
            </div>
            <button
              type="button"
              onClick={() => void handleTestKey('local')}
              disabled={testingKey === 'local'}
              className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50"
            >
              {testingKey === 'local' ? '正在探测…' : '▷ 测试端点连接'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">端点地址 (Endpoint)</label>
              <Input
                type="text"
                placeholder="http://127.0.0.1:8880/v1"
                value={localEndpoint || ''}
                onChange={(e) => setLocalEndpoint(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">API Key (可选，无鉴权可留空)</label>
              <Input
                type="password"
                placeholder="sk-..."
                value={localApiKey || ''}
                onChange={(e) => setLocalApiKey(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* ==================== 4. 试听与语速控制台（对齐图 3） ==================== */}
      <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">试听内容与语速测试</label>
          <span className="text-[10px] text-muted-foreground">{previewText.length} 字</span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Input
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="输入试听内容…"
            className="flex-1 h-9 text-xs"
          />

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">语速:</span>
            <span className="text-xs font-mono font-semibold w-10 text-right">{rate.toFixed(1)}x</span>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-24 accent-amber-500 cursor-pointer"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded cursor-pointer"
              onClick={() => setRate(1.0)}
              title="复位 1.0x"
            >
              <RotateCcw className="size-3" />
            </Button>
          </div>

          <Button
            variant="default"
            size="sm"
            onClick={() => void handleTogglePreview()}
            className="h-9 px-4 gap-1.5 bg-amber-500 hover:bg-amber-600 text-white font-medium shadow-xs cursor-pointer"
          >
            {isPreviewing ? (
              <>
                <Square className="size-3.5 fill-current" />
                <span>停止</span>
              </>
            ) : (
              <>
                <Play className="size-3.5 fill-current" />
                <span>试听</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ==================== 5. 高级配置：模型与音色库（可折叠） ==================== */}
      <div className="rounded-xl border border-border/70 bg-card/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setModelSectionOpen(!modelSectionOpen)}
          className="w-full flex items-center justify-between p-3.5 text-xs font-medium hover:bg-muted/40 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-3.5 text-primary" />
            <span className="font-semibold text-foreground">高级配置：模型与音色库</span>
            <span className="text-muted-foreground text-[11px]">
              当前音色: {voiceName} · 模型: {modelId}
            </span>
          </div>
          <ChevronDown
            className={cn('size-4 text-muted-foreground transition-transform', modelSectionOpen && 'rotate-180')}
          />
        </button>

        {modelSectionOpen && (
          <div className="p-4 pt-2 border-t border-border/50 space-y-4">
            {/* Gemini 专属语音模型选择 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Gemini 语音生成专属模型</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {GEMINI_MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModelId(m.id)}
                    className={cn(
                      'flex flex-col text-left p-2.5 rounded-lg border text-xs transition-colors cursor-pointer',
                      modelId === m.id
                        ? 'border-primary/50 bg-primary/10 text-primary font-medium'
                        : 'border-border/50 hover:bg-muted/50 text-foreground',
                    )}
                  >
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 音色音质选择 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">发音人音色选择</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {GEMINI_VOICES.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVoiceName(v.id)}
                    className={cn(
                      'flex flex-col text-left p-2 rounded-lg border text-xs transition-colors cursor-pointer',
                      voiceName === v.id
                        ? 'border-primary/50 bg-primary/10 text-primary font-medium'
                        : 'border-border/50 hover:bg-muted/50 text-foreground',
                    )}
                  >
                    <span className="font-semibold">{v.name}</span>
                    <span className="text-[10px] text-muted-foreground">{v.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 6. 文本降噪与过滤偏好（可折叠） ==================== */}
      <div className="rounded-xl border border-border/70 bg-card/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setTextCleaningSectionOpen(!textCleaningSectionOpen)}
          className="w-full flex items-center justify-between p-3.5 text-xs font-medium hover:bg-muted/40 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Filter className="size-3.5 text-amber-500" />
            <span className="font-semibold text-foreground">听书降噪：角标注释与链接过滤</span>
            <span className="text-muted-foreground text-[11px]">
              {filterFootnotesAndCitations && filterLinksAndTechnicalMarkup
                ? '已开启角标过滤与链接降噪'
                : '自定义过滤'}
            </span>
          </div>
          <ChevronDown
            className={cn('size-4 text-muted-foreground transition-transform', textCleaningSectionOpen && 'rotate-180')}
          />
        </button>

        {textCleaningSectionOpen && (
          <div className="p-4 pt-2 border-t border-border/50 space-y-4">
            {/* 角标过滤 */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-foreground">智能跳过角标与注释序号</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  朗读时自动跳过书籍/论文中的 <code className="text-amber-500 font-mono">(5)</code>、<code className="text-amber-500 font-mono">[1]</code>、<code className="text-amber-500 font-mono">①</code>、<code className="text-amber-500 font-mono">¹²³</code> 等文献序号，保留有语义的正文夹注（如「(中康熙壬辰科武探花)」），避免生硬念出括号数字打断沉浸感。
                </p>
              </div>
              <input
                type="checkbox"
                checked={filterFootnotesAndCitations}
                onChange={(e) => setFilterFootnotesAndCitations(e.target.checked)}
                className="size-4 mt-0.5 accent-amber-500 rounded cursor-pointer shrink-0"
              />
            </div>

            {/* 链接与标记过滤 */}
            <div className="flex items-start justify-between gap-4 pt-3 border-t border-border/40">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-foreground">剥离纯链接与技术排版符号</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  去除 <code className="text-amber-500 font-mono">https://...</code> 裸链接，保留锚文本（如“点击[某某文献]”只朗读“某某文献”）；滤除代码块、标题符号与图片，大幅提高听感品质并节省 API 计费。
                </p>
              </div>
              <input
                type="checkbox"
                checked={filterLinksAndTechnicalMarkup}
                onChange={(e) => setFilterLinksAndTechnicalMarkup(e.target.checked)}
                className="size-4 mt-0.5 accent-amber-500 rounded cursor-pointer shrink-0"
              />
            </div>
          </div>
        )}
      </div>

      {/* ==================== 7. 存储与开销：音频本地缓存（可折叠） ==================== */}
      <div className="rounded-xl border border-border/70 bg-card/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setCacheSectionOpen(!cacheSectionOpen)}
          className="w-full flex items-center justify-between p-3.5 text-xs font-medium hover:bg-muted/40 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Database className="size-3.5 text-emerald-500" />
            <span className="font-semibold text-foreground">存储与开销：音频本地缓存</span>
            <span className="text-muted-foreground text-[11px]">
              {saveAudioCache ? '已开启保存音频（避免二次请求与 API 计费）' : '已关闭'}
            </span>
          </div>
          <ChevronDown
            className={cn('size-4 text-muted-foreground transition-transform', cacheSectionOpen && 'rotate-180')}
          />
        </button>

        {cacheSectionOpen && (
          <div className="p-4 pt-2 border-t border-border/50 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-foreground">持久化音频缓存到本地磁盘</p>
                <p className="text-[11px] text-muted-foreground">
                  章节首次朗读后将音频存为本地 WAV 文件，下次阅读同一章节秒开播放
                </p>
              </div>
              <input
                type="checkbox"
                checked={saveAudioCache}
                onChange={(e) => setSaveAudioCache(e.target.checked)}
                className="size-4 accent-amber-500 rounded cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
              <span className="text-muted-foreground">
                当前缓存占用: <strong className="text-foreground">{cacheStats?.count ?? 0}</strong> 个文件 /{' '}
                <strong className="text-foreground">{formatBytes(cacheStats?.totalBytes ?? 0)}</strong>
              </span>

              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleClearCache()}
                disabled={clearingCache || (cacheStats?.count ?? 0) === 0}
                className="h-7 text-xs gap-1 cursor-pointer"
              >
                {clearingCache ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                <span>清理全部缓存</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
