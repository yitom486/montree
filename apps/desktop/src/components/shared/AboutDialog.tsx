import { ExternalLink, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { APP_GITHUB_REPO, APP_TAGLINE, APP_TITLE } from '@montree/contracts'
import { useAppUpdate } from '@/hooks/workspace/useAppUpdate'
import { appApi } from '@/api/app-api'
import { cn } from '@/lib/utils'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  version: string
  platform: string
}

function updateStatusLabel(phase: string, message?: string): string {
  if (message) return message
  switch (phase) {
    case 'checking':
      return '正在检查更新…'
    case 'available':
      return '发现新版本'
    case 'not-available':
      return '当前已是最新版本'
    case 'downloading':
      return '正在下载更新…'
    case 'downloaded':
      return '更新已下载，可重启安装'
    case 'error':
      return '检查更新失败'
    default:
      return '尚未检查更新'
  }
}

export function AboutDialog({
  open,
  onOpenChange,
  version,
  platform,
}: AboutDialogProps) {
  const { status, check, download, install } = useAppUpdate()
  const busy = status.phase === 'checking' || status.phase === 'downloading'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>关于 {APP_TITLE}</DialogTitle>
          <DialogDescription>{APP_TAGLINE}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground leading-relaxed">
            本地优先的桌面知识工作区：在同一窗口里撰写 Markdown、深度阅读各类电子书（PDF / EPUB / MOBI / AZW3）与在线文档，并借助 Agent 感知阅读上下文、高效沉淀高亮与批注。
          </p>

          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <p>
              版本 <span className="font-medium text-foreground">{version}</span>
              {status.version && status.phase !== 'idle' && status.phase !== 'not-available' ? (
                <>
                  {' '}
                  →{' '}
                  <span className="font-medium text-foreground">v{status.version}</span>
                </>
              ) : null}
            </p>
            <p className="mt-1 capitalize">{platform}</p>
          </div>

          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <p className="text-xs font-medium text-foreground">软件更新</p>
            <p className={cn('text-xs', status.phase === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
              {busy ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" />
                  {updateStatusLabel(status.phase, status.message)}
                  {status.percent != null ? `（${status.percent}%）` : null}
                </span>
              ) : (
                updateStatusLabel(status.phase, status.message)
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void check()}>
                检查更新
              </Button>
              {status.phase === 'available' ? (
                <Button type="button" size="xs" disabled={busy} onClick={() => void download()}>
                  下载更新
                </Button>
              ) : null}
              {status.phase === 'downloaded' ? (
                <Button type="button" size="xs" onClick={() => void install()}>
                  重启并安装
                </Button>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              打包版本会在启动时自动检查 GitHub Release；也可在此手动检查。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="gap-1.5"
              onClick={() => void appApi.openExternal(APP_GITHUB_REPO)}
            >
              <ExternalLink className="size-3.5" />
              GitHub 仓库
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            基于 Electron · React 19 · TypeScript · CodeMirror 6 · ACP 协议构建。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
