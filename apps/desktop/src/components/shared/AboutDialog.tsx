import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  Sparkles,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { APP_GITHUB_REPO, APP_TAGLINE, APP_TITLE } from '@yitom/contracts'
import { useAppUpdate } from '@/hooks/workspace/useAppUpdate'
import { appApi } from '@/api/app-api'
import { cn, formatBytes } from '@/lib/utils'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  version: string
  platform: string
}

export function AboutDialog({
  open,
  onOpenChange,
  version,
  platform,
}: AboutDialogProps) {
  const { status, check, download, install } = useAppUpdate()
  const isBusy = status.phase === 'checking' || status.phase === 'downloading' || status.phase === 'installing'

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

          {/* 软件更新面板：支持平滑进度条、下载/安装/就绪多态切换 */}
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">软件更新</p>
              {status.version && status.phase !== 'idle' && status.phase !== 'not-available' ? (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  新版 v{status.version}
                </span>
              ) : null}
            </div>

            {/* 状态 1：正在下载中 */}
            {status.phase === 'downloading' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <ArrowDownToLine className="size-3.5 text-primary animate-pulse" />
                    正在下载更新…
                  </span>
                  <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                    {status.percent ?? 0}%
                  </span>
                </div>
                <Progress
                  value={status.percent}
                  className="h-2 bg-secondary/80"
                  indicatorClassName="bg-gradient-to-r from-primary/80 to-primary shadow-[0_0_8px_rgba(var(--primary),0.3)]"
                />
                <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {status.transferred != null && status.total != null
                      ? `${formatBytes(status.transferred)} / ${formatBytes(status.total)}`
                      : `${status.percent ?? 0}% 已下载`}
                  </span>
                  <span>{status.bytesPerSecond ? `${formatBytes(status.bytesPerSecond)}/s` : ''}</span>
                </div>
              </div>
            ) : null}

            {/* 状态 2：正在静默安装中 */}
            {status.phase === 'installing' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                  正在准备静默安装并启动新版本…
                </div>
                <Progress
                  value={100}
                  className="h-2 bg-secondary/80"
                  indicatorClassName="bg-primary animate-pulse"
                />
                <p className="text-[11px] text-muted-foreground">
                  安装包正在后台原地就绪，即将自动重启启动，全程无需任何手动操作。
                </p>
              </div>
            ) : null}

            {/* 状态 3：下载完成，提醒用户可以启动 */}
            {status.phase === 'downloaded' ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4 shrink-0" />
                  新版本安装包已就绪！
                </div>
                <Progress
                  value={100}
                  className="h-1.5 bg-emerald-500/20"
                  indicatorClassName="bg-emerald-500"
                />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  全程已全自动下载并完成就绪，点击下方按钮立即原地重启启动新版本。
                </p>
                <div className="pt-0.5">
                  <Button
                    type="button"
                    size="xs"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                    onClick={() => void install()}
                  >
                    <Rocket className="size-3.5" />
                    立即重启并启动新版
                  </Button>
                </div>
              </div>
            ) : null}

            {/* 状态 4：发现新版本（等待下载） */}
            {status.phase === 'available' ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  发现新版本 <span className="font-medium text-foreground">v{status.version}</span>，可立即下载。
                </p>
                <div>
                  <Button
                    type="button"
                    size="xs"
                    disabled={isBusy}
                    onClick={() => void download()}
                    className="gap-1.5"
                  >
                    <ArrowDownToLine className="size-3.5" />
                    下载更新
                  </Button>
                </div>
              </div>
            ) : null}

            {/* 状态 5：检查中 */}
            {status.phase === 'checking' ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                正在检查 GitHub Release 最新版本…
              </div>
            ) : null}

            {/* 状态 6：已是最新版本 / 初始未检查 */}
            {status.phase === 'not-available' || status.phase === 'idle' ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{status.phase === 'not-available' ? '当前已是最新版本' : '点击检查最新版本'}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => void check()}
                  className="gap-1"
                >
                  <RefreshCw className="size-3" />
                  检查更新
                </Button>
              </div>
            ) : null}

            {/* 状态 7：错误 */}
            {status.phase === 'error' ? (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" />
                  {status.message || '检查更新失败'}
                </p>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => void check()}
                  className="gap-1"
                >
                  <RefreshCw className="size-3" />
                  重试
                </Button>
              </div>
            ) : null}
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

