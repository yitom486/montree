import type { ReactNode } from 'react'
import { List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useReaderNavTitles, useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { useTtsStore } from '@/stores/tts-store'
import { getReaderContentProvider } from '@/lib/agent/context/reader-content-registry'
import { toast } from 'sonner'
import { preserveScrollAnchor } from '@/lib/reader/scroll-anchor'
import { PdfToolbarMoreMenu, type PdfToolbarMenuItem } from './PdfToolbarMoreMenu'

interface ReaderToolbarShellProps {
  ready?: boolean
  tocDisabled?: boolean
  readAloudDisabled?: boolean
  readAloudDisabledReason?: string
  onTocToggle: () => void
  onAddBookmark: () => void
  addBookmarkDisabled?: boolean
  center?: ReactNode
  menuItems?: readonly PdfToolbarMenuItem[]
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
  readAloudDisabled = false,
  readAloudDisabledReason,
  onTocToggle,
  onAddBookmark,
  addBookmarkDisabled = false,
  center,
  trailing,
  menuItems = [],
}: ReaderToolbarShellProps) {
  const { currentTitle } = useReaderNavTitles()

  const zenMode = useReaderHudUiStore((s) => s.zenMode)
  const toggleZenMode = useReaderHudUiStore((s) => s.toggleZenMode)

  const isSpeaking = useTtsStore((s) => s.isSpeaking)
  const isPlayerVisible = useTtsStore((s) => s.isPlayerVisible)

  const handleToggleReadAloud = async () => {
    if (readAloudDisabled) {
      toast.info(readAloudDisabledReason || '当前文档暂不支持语音朗读')
      return
    }
    if (isPlayerVisible && isSpeaking) {
      useTtsStore.getState().togglePlayPause()
      return
    }
    const provider = getReaderContentProvider()
    if (!provider) {
      toast.warning('当前暂无可用阅读正文')
      return
    }
    try {
      let rawText = await provider.getCurrentText()
      const currentFlat = useReaderNavigationStore.getState().nav.flatIndex
      if ((!rawText || rawText.trim().length < 100) && provider.getUnitByIndex && currentFlat >= 0) {
        try {
          const unit = await provider.getUnitByIndex(currentFlat)
          if (unit?.text && unit.text.trim().length > (rawText?.trim().length || 0)) {
            rawText = unit.text
          }
        } catch {}
      }
      if (!rawText || !rawText.trim()) {
        toast.warning('当前章节或版面未提取到可朗读正文')
        return
      }

      void useTtsStore.getState().playText(currentTitle || '当前章节', rawText)
    } catch (err: any) {
      toast.error(`获取正文失败: ${err?.message || '未知错误'}`)
    }
  }

  const items: PdfToolbarMenuItem[] = [
    {
      key: 'bookmark', label: '添加书签', disabled: !ready || addBookmarkDisabled,
      onSelect: () => {
        onAddBookmark()
        useReaderHudUiStore.getState().setIsCardRailOpen(true)
      },
    },
    {
      key: 'read-aloud', label: isSpeaking ? '暂停 / 继续朗读' : '朗读本章',
      title: readAloudDisabledReason,
      disabled: !ready || readAloudDisabled,
      onSelect: () => void handleToggleReadAloud(),
    },
    {
      key: 'zen', label: zenMode ? '退出沉浸阅读' : '沉浸阅读',
      onSelect: () => preserveScrollAnchor(() => toggleZenMode()),
    },
    ...menuItems,
  ]

  return (
    <div data-testid="reader-toolbar" className="@container/reader-toolbar flex min-h-[42px] shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 bg-background px-3 py-1.5 select-none">
      <div className="flex min-w-0 items-center gap-2">
        <ToolbarTip label="展开 / 收起目录">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            aria-label="目录"
            disabled={!ready || tocDisabled}
            onClick={onTocToggle}
          >
            <List className="size-3.5" aria-hidden="true" />
            <span className="hidden @min-[560px]/reader-toolbar:inline">目录</span>
          </Button>
        </ToolbarTip>
        {!center && currentTitle ? (
          <span className="hidden max-w-48 truncate text-xs text-muted-foreground @min-[640px]/reader-toolbar:inline" title={currentTitle}>
            {currentTitle}
          </span>
        ) : null}
      </div>
      {center ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1">{center}</div>
      ) : <div className="flex-1" />}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {trailing}
        <PdfToolbarMoreMenu items={items} />
      </div>
    </div>
  )
}
