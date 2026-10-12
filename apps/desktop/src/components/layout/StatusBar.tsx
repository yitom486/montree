import { useState } from 'react'
import { GitBranch, Loader2, RefreshCw, Terminal, UploadCloud } from 'lucide-react'
import { isWslPath, parseWslPath, getDocumentKind } from '@montree/contracts'
import { useGitStatus } from '@/hooks/workspace/useGitStatus'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RemoteConnectModal } from './RemoteConnectModal'
import { cn } from '@/lib/utils'

export interface StatusBarProps {
  workspaceRoot?: string
  activeFilePath?: string
  onOpenWorkspacePath?: (path: string) => void
}

/**
 * 底部状态栏：展示工作区环境（VS Code 风格 WSL/SSH 远程直连胶囊）、Git 分支与变更状态、一键远程推送、当前文档编码与格式。
 */
export function StatusBar({
  workspaceRoot,
  activeFilePath,
  onOpenWorkspacePath,
}: StatusBarProps) {
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false)
  const { status, isLoading, isPushing, push, refetch } = useGitStatus(workspaceRoot)

  const wslInfo = workspaceRoot && isWslPath(workspaceRoot) ? parseWslPath(workspaceRoot) : null
  const documentKind = activeFilePath ? getDocumentKind(activeFilePath) : null

  return (
    <>
      <footer
        className="flex h-6 shrink-0 items-center justify-between border-t border-border/60 bg-background/90 px-3 text-[11px] text-muted-foreground select-none backdrop-blur-sm z-10"
        aria-label="状态栏"
      >
        {/* 左侧：VS Code 风格远程指示器 + Git 状态 */}
        <div className="flex items-center gap-2 min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-6 rounded-none px-2 -ml-3 gap-1.5 font-medium text-[11px] transition-colors',
                  wslInfo?.isWsl
                    ? 'bg-sky-500/20 text-sky-400 hover:bg-sky-500/30'
                    : 'bg-primary/10 text-primary hover:bg-primary/20',
                )}
                onClick={() => setIsRemoteModalOpen(true)}
                aria-label="打开远程工作区管理器"
              >
                <Terminal className="size-3 shrink-0" />
                <span>{wslInfo?.isWsl ? `WSL: ${wslInfo.distro}` : '远程环境'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{wslInfo?.isWsl ? `当前位于 WSL: ${wslInfo.distro}` : '打开远程工作区管理器 (WSL / SSH)'}</p>
              <p className="text-[10px] text-muted-foreground">应用内直达 Linux / SSH 环境，无需系统文件对话框</p>
            </TooltipContent>
          </Tooltip>

          {status?.isRepo && (
            <div className="flex items-center gap-1.5">
              {/* 分支与变动 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-accent/40 text-foreground transition-colors cursor-default">
                    <GitBranch className="size-3 text-muted-foreground" />
                    <span className="font-medium">{status.branch || 'HEAD'}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>当前 Git 分支: {status.branch || 'HEAD'}</p>
                  {status.totalChanges > 0 && <p className="text-amber-400">{status.totalChanges} 个文件变动未提交</p>}
                  {status.ahead > 0 && <p className="text-emerald-400">{status.ahead} 个提交待推送</p>}
                  {status.behind > 0 && <p className="text-sky-400">落后远程 {status.behind} 个提交</p>}
                </TooltipContent>
              </Tooltip>

              {status.totalChanges > 0 && (
                <span
                  className="font-mono text-[10px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  title={`${status.totalChanges} 个文件变动未提交`}
                >
                  *{status.totalChanges}
                </span>
              )}

              {status.behind > 0 && (
                <span
                  className="font-mono text-[10px] px-1 py-0.2 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20"
                  title={`落后远程 ${status.behind} 个提交`}
                >
                  ↓{status.behind}
                </span>
              )}

              {status.ahead > 0 && (
                <span
                  className="font-mono text-[10px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  title={`待推送 ${status.ahead} 个提交`}
                >
                  ↑{status.ahead}
                </span>
              )}

              {/* 一键推送按钮 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-5 px-1.5 text-[11px] gap-1 font-normal text-muted-foreground hover:text-foreground hover:bg-accent/50',
                      status.ahead > 0 && 'text-primary font-medium hover:text-primary',
                    )}
                    onClick={() => void push()}
                    disabled={isPushing}
                    aria-label="一键推送"
                  >
                    {isPushing ? (
                      <Loader2 className="size-3 animate-spin text-primary" />
                    ) : (
                      <UploadCloud className="size-3" />
                    )}
                    <span>{isPushing ? '正在推送…' : status.ahead > 0 ? `推送 (↑${status.ahead})` : '推送'}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>
                    {status.ahead > 0
                      ? `一键推送到远程仓库（${status.ahead} 个本地提交待推送）`
                      : '一键推送到远程仓库 (git push)'}
                  </p>
                  {wslInfo?.isWsl && <p className="text-[10px] text-muted-foreground">自动利用 WSL 内部 SSH 凭证执行</p>}
                </TooltipContent>
              </Tooltip>

              {/* 刷新状态按钮 */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-5 text-muted-foreground hover:text-foreground"
                onClick={() => void refetch()}
                disabled={isLoading}
                title="刷新 Git 状态"
                aria-label="刷新 Git 状态"
              >
                <RefreshCw className={cn('size-2.5', isLoading && 'animate-spin')} />
              </Button>
            </div>
          )}
        </div>

        {/* 右侧：文档格式与编码 */}
        <div className="flex items-center gap-3">
          {documentKind && (
            <span className="uppercase tracking-wider text-[10px] font-mono text-muted-foreground/80">
              {documentKind}
            </span>
          )}
          <span className="font-mono text-[10px] text-muted-foreground/80">UTF-8</span>
        </div>
      </footer>

      {/* 远程环境连接器模态弹窗 */}
      <RemoteConnectModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        onOpenWorkspace={(path) => {
          onOpenWorkspacePath?.(path)
        }}
      />
    </>
  )
}
