import { useEffect, useState, useMemo } from 'react'
import {
  BookOpen,
  Coffee,
  FileText,
  Moon,
  PanelLeft,
  Search,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react'
import { appApi } from '@/api/app-api'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AppTheme } from '@/stores/editor-ui-store'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { cn } from '@/lib/utils'

interface AppTitleBarProps {
  activeFilePath?: string
  isDirty?: boolean
  sidebarVisible?: boolean
  onToggleSidebar?: () => void
  onQuickOpen?: () => void
  onToggleAgentPanel?: () => void
  agentPanelOpen?: boolean
  theme?: AppTheme
  onCycleTheme?: () => void
  onOpenSettings?: () => void
}

/** 提取用于居中胶囊显示的文件名和扩展名 */
function getDisplayFileInfo(filePath?: string) {
  if (!filePath) {
    return {
      name: 'Montree',
      sub: '快速打开 (Ctrl+P)',
      isBook: false,
    }
  }
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  const fullName = parts[parts.length - 1] ?? '未命名文档'
  const isBook = /\.(epub|mobi|azw3|pdf)$/i.test(fullName)
  return {
    name: fullName,
    sub: isBook ? '阅读模式' : '编辑模式',
    isBook,
  }
}

export function AppTitleBar({
  activeFilePath,
  isDirty = false,
  sidebarVisible = true,
  onToggleSidebar,
  onQuickOpen,
  onToggleAgentPanel,
  agentPanelOpen = false,
  theme = 'dark',
  onCycleTheme,
  onOpenSettings,
}: AppTitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const acpStatus = useAcpUiStore((s) => s.status)
  const isAcpConnected = acpStatus === 'connected'

  useEffect(() => {
    void appApi.isWindowMaximized().then(setIsMaximized)
    const unsubscribe = appApi.onWindowMaximizeChanged((maximized) => {
      setIsMaximized(maximized)
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  const fileInfo = useMemo(() => getDisplayFileInfo(activeFilePath), [activeFilePath])

  const handleDoubleClick = () => {
    appApi.toggleMaximizeWindow()
  }

  const isElectron = appApi.isElectron()

  return (
    <header
      className="flex h-9 w-full shrink-0 items-center justify-between border-b border-border/50 bg-background/95 px-2 text-foreground select-none backdrop-blur-md transition-colors"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={handleDoubleClick}
      aria-label="应用标题栏"
    >
      {/* 左侧：Logo、品牌名与侧栏开关 */}
      <div
        className="flex items-center gap-1.5 min-w-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {onToggleSidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors',
                  sidebarVisible && 'text-foreground bg-muted/40',
                )}
                onClick={onToggleSidebar}
                aria-label={sidebarVisible ? '折叠侧边栏' : '展开侧边栏'}
              >
                <PanelLeft className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {sidebarVisible ? '折叠侧栏 (Ctrl+B)' : '展开侧栏 (Ctrl+B)'}
            </TooltipContent>
          </Tooltip>
        )}

        <div className="flex items-center gap-1.5 pl-1 pr-2">
          <span className="text-xs font-semibold tracking-wide text-foreground/80">Montree</span>
        </div>
      </div>

      {/* 中间：VS Code 风格居中 Command Center 胶囊标题 */}
      <div
        className="flex flex-1 items-center justify-center max-w-lg min-w-0 px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onQuickOpen}
          className="group flex h-6.5 w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 text-xs text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground transition-all shadow-xs"
          title="点击快速打开或检索文档 (Ctrl+P)"
        >
          <div className="flex items-center gap-1.5 truncate min-w-0">
            {fileInfo.isBook ? (
              <BookOpen className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
            ) : (
              <FileText className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
            )}
            <span className="truncate font-medium text-foreground/90">{fileInfo.name}</span>
            {isDirty && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="未保存更改" />}
          </div>

          <div className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground/70 group-hover:text-muted-foreground">
            <Search className="size-3" />
            <kbd className="rounded bg-background/80 px-1 py-0.2 border border-border/40 font-mono text-[9px]">
              Ctrl P
            </kbd>
          </div>
        </button>
      </div>

      {/* 右侧：全局快捷工具 + 窗口控制按钮 */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* 全局操作工具组 */}
        <div className="flex items-center gap-0.5 pr-1">
          {onToggleAgentPanel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleAgentPanel}
                  className={cn(
                    'relative flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors',
                    agentPanelOpen && 'bg-primary/10 text-primary',
                  )}
                  aria-label="AI 伴读"
                >
                  <Sparkles className="size-3.5" />
                  {isAcpConnected && (
                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-500 ring-1 ring-background" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                AI 伴读 {isAcpConnected ? '(已连接)' : ''}
              </TooltipContent>
            </Tooltip>
          )}

          {onCycleTheme && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onCycleTheme}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
                  aria-label="切换主题"
                >
                  {theme === 'dark' ? (
                    <Moon className="size-3.5" />
                  ) : theme === 'sepia' ? (
                    <Coffee className="size-3.5" />
                  ) : (
                    <Sun className="size-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                外观主题：{theme === 'dark' ? '石墨极夜' : theme === 'sepia' ? '羊皮纸' : '纸张白'} (点击切换)
              </TooltipContent>
            </Tooltip>
          )}

          {onOpenSettings && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
                  aria-label="设置"
                >
                  <Settings className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                应用设置
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* 窗口控制三键（仅在 Electron 桌面环境下展示） */}
        {isElectron && (
          <div className="flex items-center h-full ml-1 border-l border-border/30 pl-0.5">
            {/* 最小化 */}
            <button
              type="button"
              onClick={() => appApi.minimizeWindow()}
              className="flex h-full w-10 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="最小化"
              aria-label="最小化窗口"
            >
              <svg width="10" height="1" viewBox="0 0 10 1">
                <path d="M0 0h10v1H0z" fill="currentColor" />
              </svg>
            </button>

            {/* 最大化 / 还原 */}
            <button
              type="button"
              onClick={() => appApi.toggleMaximizeWindow()}
              className="flex h-full w-10 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={isMaximized ? '还原' : '最大化'}
              aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path
                    d="M2 0v2H0v8h8V8h2V0H2zm1 1h6v6H8V2H3V1zm-2 2h6v6H1V3z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path d="M0 0v10h10V0H0zm1 1h8v8H1V1z" fill="currentColor" />
                </svg>
              )}
            </button>

            {/* 关闭 */}
            <button
              type="button"
              onClick={() => appApi.closeWindow()}
              className="flex h-full w-10 items-center justify-center text-muted-foreground hover:bg-[#e81123] hover:text-white dark:hover:bg-[#c42b1c] transition-colors"
              title="关闭"
              aria-label="关闭窗口"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path
                  d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4-1-4z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
