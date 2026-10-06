import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { findBuiltinAcpRuntime, type AcpAuthMethod } from '@montree/contracts'

const FALLBACK_AUTH_HINT =
  '复用本机登录凭证（如 ~/.codex / 环境变量），或选择 Agent 提供的认证方式。'

interface AgentAuthDialogProps {
  open: boolean
  methods: AcpAuthMethod[]
  busy?: boolean
  error?: string | null
  runtimeName?: string
  runtimeId?: string
  onSelect: (methodId: string) => void
  onCancel: () => void
}

export function AgentAuthDialog({
  open,
  methods,
  busy,
  error,
  runtimeName,
  runtimeId,
  onSelect,
  onCancel,
}: AgentAuthDialogProps) {
  const [selected, setSelected] = useState(methods[0]?.id ?? '')
  const authHint = runtimeId
    ? (findBuiltinAcpRuntime(runtimeId)?.authHint ?? FALLBACK_AUTH_HINT)
    : FALLBACK_AUTH_HINT

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>连接 {runtimeName ?? 'Agent'} 需要认证</DialogTitle>
          <DialogDescription>{authHint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          {methods.map((method) => (
            <button
              key={method.id}
              type="button"
              disabled={busy}
              onClick={() => setSelected(method.id)}
              className={`flex w-full flex-col rounded-lg border px-3 py-2 text-left transition-colors ${
                selected === method.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border/60 hover:bg-muted/40'
              }`}
            >
              <span className="text-sm font-medium">{method.name ?? method.id}</span>
              {method.description ? (
                <span className="mt-0.5 text-[11px] text-muted-foreground">
                  {method.description}
                </span>
              ) : (
                <span className="mt-0.5 text-[11px] text-muted-foreground">{method.id}</span>
              )}
            </button>
          ))}
          {methods.length === 0 ? (
            <p className="text-xs text-muted-foreground">Agent 未返回可用认证方式</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || !selected}
            onClick={() => onSelect(selected)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            继续
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
