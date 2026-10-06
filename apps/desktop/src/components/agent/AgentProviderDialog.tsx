import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { acpApi } from '@/api/acp-api'
import { isOk } from '@montree/contracts'
import type { AcpProviderStatus } from '@montree/contracts'

interface AgentProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 保存/清除成功后回调（父级可提示“下次连接生效”或触发重连） */
  onChanged: (status: AcpProviderStatus) => void
}

/**
 * 自定义模型供应商配置：base URL + API Key + 模型（OpenAI 兼容端点）。
 * Key 只存主进程 userData 文件，编辑时留空即沿用已存 Key。
 */
export function AgentProviderDialog({ open, onOpenChange, onChanged }: AgentProviderDialogProps) {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [wireApi, setWireApi] = useState<'chat' | 'responses'>('chat')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setBusy(true)
    setError(null)
    void (async () => {
      const result = await acpApi.getProvider()
      if (cancelled) return
      setBusy(false)
      if (!isOk(result)) {
        setError(result.error.message)
        return
      }
      const s = result.value
      setHasApiKey(s.hasApiKey)
      setName(s.name ?? '')
      setBaseUrl(s.baseUrl ?? '')
      setModel(s.model ?? '')
      setWireApi(s.wireApi === 'responses' ? 'responses' : 'chat')
      setApiKey('')
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const canSave =
    !busy &&
    baseUrl.trim().startsWith('http') &&
    model.trim().length > 0 &&
    (apiKey.trim().length > 0 || hasApiKey)

  const handleSave = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await acpApi.saveProvider({
      name: name.trim() || undefined,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      wireApi,
      apiKey: apiKey.trim(),
    })
    setBusy(false)
    if (!isOk(result)) {
      setError(result.error.message)
      return
    }
    onOpenChange(false)
    onChanged(result.value)
  }

  const handleClear = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await acpApi.clearProvider()
    setBusy(false)
    if (!isOk(result)) {
      setError(result.error.message)
      return
    }
    onOpenChange(false)
    onChanged({ configured: false, hasApiKey: false })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onOpenChange(false)
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>自定义模型供应商</DialogTitle>
          <DialogDescription>
            直连 OpenAI 兼容端点（如 DeepSeek）。使用时以 API Key 认证，不读写本机
            ~/.codex；清除后回到订阅登录。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-1">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">名称（可选）</span>
            <input
              className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-sm outline-none"
              placeholder="DeepSeek / SiliconFlow…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Base URL</span>
            <input
              className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-sm outline-none"
              placeholder="https://api.deepseek.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={busy}
              spellCheck={false}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">API Key</span>
            <input
              type="password"
              className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-sm outline-none"
              placeholder={hasApiKey ? '已配置（留空保持不变）' : 'sk-…'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">模型 id</span>
              <input
                className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-sm outline-none"
                placeholder="deepseek-chat"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">协议</span>
              <select
                className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-sm outline-none"
                value={wireApi}
                onChange={(e) => setWireApi(e.target.value === 'responses' ? 'responses' : 'chat')}
                disabled={busy}
              >
                <option value="chat">chat（兼容端点）</option>
                <option value="responses">responses（OpenAI）</option>
              </select>
            </label>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {hasApiKey ? (
            <p className="text-[10px] text-muted-foreground">
              已启用自定义 API；变更需断开重连后生效。
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2">
          {hasApiKey ? (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => void handleClear()}
            >
              清除配置
            </Button>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!canSave}
              onClick={() => void handleSave()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
