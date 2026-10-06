import type { ReactNode } from 'react'
import {
  Bookmark,
  BookmarkPlus,
  Columns2,
  FileText,
  List,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useReaderNavTitles } from '@/stores/reader-navigation-store'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { preserveScrollAnchor } from '@/lib/reader/scroll-anchor'
import { cn } from '@/lib/utils'

interface ReaderToolbarShellProps {
  ready?: boolean
  tocDisabled?: boolean
  marksHidden?: boolean
  onTocToggle: () => void
  onMarksToggle: () => void
  onAddBookmark: () => void
  addBookmarkDisabled?: boolean
  center?: ReactNode
  trailing?: ReactNode
}

/**
 * 工具栏提示统一向下弹出（side="bottom"），避免原生 title 向上遮挡窗口标题栏。
 */
function ToolbarTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ReaderToolbarShell({
  ready = true,
  tocDisabled = false,
  marksHidden = false,
  onTocToggle,
  onMarksToggle,
  onAddBookmark,
  addBookmarkDisabled = false,
  center,
  trailing,
}: ReaderToolbarShellProps) {
  const { currentTitle } = useReaderNavTitles()

  // 伴读 HUD 与先锋卡轨状态
  const isCardRailOpen = useReaderHudUiStore((s) => s.isCardRailOpen)
  const toggleCardRail = useReaderHudUiStore((s) => s.toggleCardRail)
  const setIsNotesDrawerOpen = useReaderHudUiStore((s) => s.setIsNotesDrawerOpen)
  const zenMode = useReaderHudUiStore((s) => s.zenMode)
  const toggleZenMode = useReaderHudUiStore((s) => s.toggleZenMode)

  const setHudDisplayMode = useAcpUiStore((s) => s.setHudDisplayMode)
  const panelOpen = useAcpUiStore((s) => s.panelOpen)
  const setPanelOpen = useAcpUiStore((s) => s.setPanelOpen)
  const acpStatus = useAcpUiStore((s) => s.status)

  // AI 伴读开关：已开则关闭，未开则以悬浮窗打开
  //（侧栏/胶囊/关闭在 HUD 自身头部切换，对齐原版）
  const handleToggleHud = () => {
    if (panelOpen) {
      setPanelOpen(false)
      return
    }
    setPanelOpen(true)
    setHudDisplayMode('floating')
  }

  const isAcpConnected = acpStatus === 'connected'

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-3 py-1.5 backdrop-blur-md select-none transition-colors">
      {/* 左侧：导航与目录组 */}
      <div className="flex min-w-0 items-center gap-1.5">
        <ToolbarTip label="展开 / 收起目录">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-lg px-2 text-xs hover:bg-muted/80"
            disabled={!ready || tocDisabled}
            onClick={onTocToggle}
          >
            <List className="size-3.5 text-muted-foreground" />
            <span>目录</span>
          </Button>
        </ToolbarTip>

        {!marksHidden ? (
          <>
            <ToolbarTip label="传统批注列表面板">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2 text-xs hover:bg-muted/80"
                disabled={!ready}
                onClick={onMarksToggle}
              >
                <Bookmark className="size-3.5 text-muted-foreground" />
                <span>批注簿</span>
              </Button>
            </ToolbarTip>
            <ToolbarTip label="在当前阅读位置添加书签">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 rounded-lg px-2 text-xs hover:bg-muted/80"
                disabled={!ready || addBookmarkDisabled}
                onClick={onAddBookmark}
              >
                <BookmarkPlus className="size-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">加书签</span>
              </Button>
            </ToolbarTip>
          </>
        ) : null}

        {currentTitle ? (
          <ToolbarTip label={currentTitle}>
            <span className="ml-1.5 hidden max-w-[240px] truncate text-xs font-medium text-muted-foreground md:inline-block lg:max-w-[340px]">
              {currentTitle}
            </span>
          </ToolbarTip>
        ) : null}
      </div>

      {/* 中部自定义控件 */}
      {center ? (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1">{center}</div>
      ) : null}

      {/* 右侧：阅读器原生控件 + 微晶控制药丸组 */}
      <div className="flex shrink-0 items-center gap-2">
        {trailing ? (
          <div className="flex items-center gap-1.5 border-r border-border/50 pr-2">
            {trailing}
          </div>
        ) : null}

        {/* 先锋微晶控制胶囊组 */}
        <div className="flex items-center gap-1">
          {/* 知识卡轨切换 */}
          <ToolbarTip label={isCardRailOpen ? '收起右侧知识卡轨' : '展开右侧知识卡轨'}>
            <Button
              variant={isCardRailOpen ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'h-7 gap-1.5 rounded-lg px-2 text-xs transition-all duration-150',
                isCardRailOpen
                  ? 'border border-primary/20 bg-primary/10 text-primary font-medium hover:bg-primary/15'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
              onClick={() => preserveScrollAnchor(() => toggleCardRail())}
            >
              {isCardRailOpen ? (
                <PanelRightClose className="size-3.5" />
              ) : (
                <PanelRightOpen className="size-3.5" />
              )}
              <span>卡片流</span>
            </Button>
          </ToolbarTip>

          {/* 全书札记中心 */}
          <ToolbarTip label="查看全书札记中心与闪卡">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              onClick={() => setIsNotesDrawerOpen(true)}
            >
              <FileText className="size-3.5" />
              <span className="hidden sm:inline">札记箱</span>
            </Button>
          </ToolbarTip>

          {/* AI 伴读开关：开/关悬浮窗 */}
          <ToolbarTip label={panelOpen ? '关闭 AI 伴读' : '打开 AI 伴读悬浮窗'}>
            <button
              type="button"
              onClick={handleToggleHud}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all duration-150 cursor-pointer select-none',
                panelOpen
                  ? 'border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
              aria-label="AI 伴读模态切换"
            >
              <Sparkles className="size-3.5 text-primary" />
              <span className="hidden md:inline font-medium">AI 伴读</span>
              {/* 伴读运行状态微型指示点 */}
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  isAcpConnected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-muted-foreground/40',
                )}
              />
            </button>
          </ToolbarTip>

          {/* 沉浸禅模式 */}
          <ToolbarTip label={zenMode ? '退出沉浸禅模式 (Esc)' : '开启沉浸禅模式 (Ctrl+Alt+Z)'}>
            <Button
              variant={zenMode ? 'secondary' : 'ghost'}
              size="icon"
              className={cn(
                'size-7 rounded-lg transition-all',
                zenMode
                  ? 'border border-primary/30 bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
              onClick={() => toggleZenMode()}
            >
              {zenMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </Button>
          </ToolbarTip>
        </div>
      </div>
    </div>
  )
}

