import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, LogIn, LogOut, SlidersHorizontal } from 'lucide-react'
import { isOk } from '@yitom/contracts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  clearInlineCompletionProvider,
  getChatGptAuthStatus,
  getInlineCompletionProviderStatus,
  listInlineCompletionModels,
  loginChatGpt,
  logoutChatGpt,
  saveInlineCompletionProvider,
} from '@/lib/editor/inline-completion/inline-completion-client'
import type {
  ChatGptAuthStatus,
  InlineCompletionAuthMode,
  InlineCompletionProviderStatus,
} from '../../../contracts/inline-completion-provider'

const PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', label: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio（本地）', baseUrl: 'http://localhost:1234/v1' },
  { id: 'custom', label: '自定义', baseUrl: '' },
] as const

const CHATGPT_MODELS = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna（低延迟）' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
] as const

function presetFor(baseUrl: string | undefined): string {
  return PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === baseUrl)?.id ?? 'custom'
}

function isChatGptModel(model: string): boolean {
  return CHATGPT_MODELS.some((item) => item.id === model)
}

/** 设置页里的补全模型入口；显式配置后不再与 Agent 供应商共用模型。 */
export function InlineCompletionProviderSettings() {
  const [status, setStatus] = useState<InlineCompletionProviderStatus | null>(null)
  const [chatGpt, setChatGpt] = useState<ChatGptAuthStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [error, setError] = useState('')
  const [authMode, setAuthMode] = useState<InlineCompletionAuthMode>('api-key')
  const [preset, setPreset] = useState('custom')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)

  useEffect(() => {
    void getInlineCompletionProviderStatus().then(setStatus)
    void getChatGptAuthStatus().then(setChatGpt)
  }, [])

  const openDialog = () => {
    const nextMode = status?.authMode ?? 'api-key'
    setAuthMode(nextMode)
    setPreset(presetFor(status?.baseUrl))
    setName(status?.name ?? '')
    setBaseUrl(status?.baseUrl ?? '')
    setModel(status?.model ?? (nextMode === 'chatgpt' ? CHATGPT_MODELS[0].id : ''))
    setApiKey('')
    setHasApiKey(status?.hasApiKey ?? false)
    setModelOptions([])
    setError('')
    setOpen(true)
    void getChatGptAuthStatus().then(setChatGpt)
    void getInlineCompletionProviderStatus().then(setStatus)
  }

  const handleSave = async () => {
    setBusy(true)
    setError('')
    const result = await saveInlineCompletionProvider(
      authMode === 'chatgpt'
        ? {
            authMode: 'chatgpt',
            name: name.trim() || undefined,
            model: model.trim(),
          }
        : {
            authMode: 'api-key',
            name: name.trim() || undefined,
            baseUrl: baseUrl.trim(),
            model: model.trim(),
            apiKey: apiKey.trim(),
          },
    )
    setBusy(false)
    if (!isOk(result)) {
      setError(result.error.message)
      return
    }
    setStatus(result.value)
    setOpen(false)
    toast.success('补全模型已保存')
  }

  const handleClear = async () => {
    setBusy(true)
    setError('')
    const result = await clearInlineCompletionProvider()
    setBusy(false)
    if (!isOk(result)) {
      setError(result.error.message)
      return
    }
    setStatus(result.value)
    setOpen(false)
    toast.success(result.value.configured ? '已恢复跟随 Agent 模型' : '补全模型已清除')
  }

  const handleLogin = async () => {
    setLoggingIn(true)
    setError('')
    const result = await loginChatGpt()
    setLoggingIn(false)
    if (!isOk(result)) {
      setError(result.error.message)
      return
    }
    setChatGpt(result.value)
    setAuthMode('chatgpt')
    setModel((current) => isChatGptModel(current) ? current : CHATGPT_MODELS[0].id)
    setStatus(await getInlineCompletionProviderStatus())
    toast.success('ChatGPT 登录成功')
  }

  const handleLogout = async () => {
    setLoggingIn(true)
    setError('')
    const result = await logoutChatGpt()
    setLoggingIn(false)
    if (!isOk(result)) {
      setError(result.error.message)
      return
    }
    setChatGpt(result.value)
    setStatus(await getInlineCompletionProviderStatus())
    toast.success('已退出 ChatGPT')
  }

  const handleFetchModels = async () => {
    setLoadingModels(true)
    setError('')
    const result = await listInlineCompletionModels({
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() || undefined,
    })
    setLoadingModels(false)
    if (!isOk(result)) {
      setError(result.error.message)
      return
    }
    setModelOptions(result.value)
    if (!result.value.length) {
      setError('接口没有返回模型，请手动输入模型 id')
      return
    }
    if (!model.trim()) setModel(result.value[0] ?? '')
    toast.success(`获取到 ${result.value.length} 个模型`)
  }

  const handleAuthModeChange = (next: InlineCompletionAuthMode) => {
    setAuthMode(next)
    if (next === 'chatgpt' && !isChatGptModel(model)) {
      setModel(CHATGPT_MODELS[0].id)
    } else if (next === 'api-key' && isChatGptModel(model)) {
      setModel('')
    }
  }

  const disabled = busy || loggingIn || loadingModels
  const chatGptConfigured = status?.authMode === 'chatgpt'
    ? Boolean(status.configured)
    : Boolean(chatGpt?.configured)
  const chatGptAccountId = status?.authMode === 'chatgpt'
    ? status.chatgptAccountId ?? chatGpt?.accountId
    : chatGpt?.accountId
  const canSave = authMode === 'chatgpt'
    ? Boolean(chatGptConfigured && model.trim())
    : Boolean(baseUrl.trim().startsWith('http') && model.trim())

  const statusText = status === null
    ? '读取中…'
    : status.configured
      ? status.authMode === 'chatgpt'
        ? `ChatGPT · ${status.model ?? ''}${status.chatgptAccountId ? ` · ${status.chatgptAccountId}` : ''}`
        : `${status.source === 'agent' ? '跟随 Agent' : '单独配置'} · ${status.model ?? ''}`
      : status.authMode === 'chatgpt'
        ? 'ChatGPT 未登录'
        : '未配置'

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-t border-border/60 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">补全模型</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            默认跟随 Agent 的自定义供应商；也可以单独配置低延迟、低成本的补全模型。
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{statusText}</p>
        </div>
        <Button type="button" variant="outline" size="xs" onClick={openDialog} disabled={!status}>
          <SlidersHorizontal className="size-3.5" />
          配置
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
        <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>行内补全模型</DialogTitle>
            <DialogDescription>
              补全与聊天分开配置。可使用 OpenAI 兼容的 API Key，或登录 ChatGPT 使用订阅额度；
              凭据只保存在本机主进程。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5 py-1">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">认证方式</span>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={authMode}
                onChange={(event) => handleAuthModeChange(event.target.value as InlineCompletionAuthMode)}
                disabled={disabled}
              >
                <option value="api-key">API Key / OpenAI 兼容接口</option>
                <option value="chatgpt">ChatGPT 登录</option>
              </select>
            </label>

            {authMode === 'chatgpt' ? (
              <>
                <div className="rounded-md border border-border bg-muted/30 p-2.5">
                  {chatGptConfigured ? (
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground">已登录 ChatGPT</p>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          Account {chatGptAccountId ?? '未知'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={disabled}
                        onClick={() => void handleLogout()}
                      >
                        <LogOut className="size-3.5" />
                        退出
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">尚未登录 ChatGPT</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          登录会打开浏览器完成 OAuth 授权，请保持本窗口打开。
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={disabled}
                        onClick={() => void handleLogin()}
                      >
                        {loggingIn ? (
                          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <LogIn className="size-3.5" />
                        )}
                        {loggingIn ? '等待授权…' : '登录'}
                      </Button>
                    </div>
                  )}
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">模型</span>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    disabled={disabled}
                  >
                    {CHATGPT_MODELS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <p className="text-[10px] text-muted-foreground">
                  使用 Codex 客户端的 ChatGPT OAuth 接口，不消耗 API Key；若 OpenAI 调整接口可能失效。
                </p>
              </>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">服务预设</span>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={preset}
                    onChange={(event) => {
                      const next = event.target.value
                      setPreset(next)
                      setModelOptions([])
                      const presetValue = PRESETS.find((item) => item.id === next)
                      if (presetValue?.baseUrl) setBaseUrl(presetValue.baseUrl)
                    }}
                    disabled={disabled}
                  >
                    {PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">名称（可选）</span>
                  <Input
                    placeholder="OpenAI / DeepSeek / 本地模型…"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={disabled}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Base URL</span>
                  <Input
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    disabled={disabled}
                    spellCheck={false}
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <div className="block space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">模型 id</span>
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={disabled || !baseUrl.trim().startsWith('http')}
                        onClick={() => void handleFetchModels()}
                      >
                        {loadingModels ? '获取中…' : '获取模型'}
                      </button>
                    </div>
                    <Input
                      list="inline-completion-model-options"
                      placeholder="gpt-4.1-mini / deepseek-flash"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      disabled={disabled}
                      spellCheck={false}
                    />
                    <datalist id="inline-completion-model-options">
                      {modelOptions.map((id) => <option key={id} value={id} />)}
                    </datalist>
                  </div>
                  <label className="block space-y-1">
                    <span className="text-xs text-muted-foreground">API Key</span>
                    <Input
                      type="password"
                      placeholder={hasApiKey ? '已配置（留空保持不变）' : '本地服务可留空'}
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      disabled={disabled}
                      autoComplete="off"
                    />
                  </label>
                </div>

                {status?.source === 'agent' ? (
                  <p className="text-[10px] text-muted-foreground">
                    当前使用 Agent 的自定义供应商；保存后会创建补全专用配置。留空 API Key 会沿用 Agent 的 Key。
                  </p>
                ) : null}
              </>
            )}

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>

          <DialogFooter className="flex items-center justify-between gap-2">
            {status?.source === 'dedicated' ? (
              <Button type="button" variant="outline" className="text-destructive hover:text-destructive" disabled={disabled} onClick={() => void handleClear()}>
                清除补全配置
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
              <Button type="button" disabled={disabled || !canSave} onClick={() => void handleSave()}>
                {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                保存
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
