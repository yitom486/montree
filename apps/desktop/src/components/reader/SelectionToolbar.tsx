import { useEffect, useState } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  Headphones,
  Highlighter,
  Loader2,
  MessageSquarePlus,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SelectionAiMenu } from '@/components/reader/SelectionAiMenu'
import { isMarkdownEditorFocused } from '@/lib/editor/editor-focus'
import { cn } from '@/lib/utils'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  shouldHandleReaderCopyShortcut,
  type HighlightColorId,
} from '@yitom/reader-core'

export interface SelectionToolbarProps {
  x: number
  y: number
  onCopy: () => void
  /** 快捷键复制门：无阅读选区时不拦截（Electron editMenu 保底） */
  hasSelectionForCopy?: boolean
  /** iframe 阅读器（Foliate/WebDoc）额外监听其 contentDocument，PDF 不传 */
  keyEventDocs?: Document[]
  onAnnotate?: () => void
  /** 从当前选区开始语音朗读 */
  onReadAloud?: () => void
  /** 打开 Agent 面板并带着当前选区去提问 */
  onAskAgent?: () => void
  /** 一键快速问答（方向见 deep-answer），答案落对话框 */
  onAskDeepAnswer?: (directionId: string) => void
  deepAnswerPending?: boolean
  /** 将当前选区存为高亮；颜色由浮层色点选择，默认黄 */
  onHighlight?: (color: HighlightColorId) => void
  /** AI 制卡（预设见 card-studio-presets），customText 仅「更多要求」携带 */
  onGenerateCardPreset?: (presetId: string, customText?: string) => void
  cardPresetPending?: boolean
  onDismiss: () => void
}

/** 菜单大致高度，用于决定向上还是向下展开，避免被窗口顶部裁掉。 */
const AI_MENU_HEIGHT = 420
const PALETTE_HEIGHT = 140

export function SelectionToolbar({
  x,
  y,
  onCopy,
  hasSelectionForCopy = false,
  keyEventDocs,
  onAnnotate,
  onReadAloud,
  onAskAgent,
  onAskDeepAnswer,
  deepAnswerPending = false,
  onHighlight,
  onGenerateCardPreset,
  cardPresetPending = false,
  onDismiss,
}: SelectionToolbarProps) {
  const [copied, setCopied] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteBelow, setPaletteBelow] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBelow, setAiBelow] = useState(false)
  const [lastColor, setLastColor] = useState<HighlightColorId>(DEFAULT_HIGHLIGHT_COLOR)

  const activeColor = HIGHLIGHT_COLORS.find((item) => item.id === lastColor) ?? HIGHLIGHT_COLORS[0]
  const aiPending = cardPresetPending || deepAnswerPending
  const showAi = Boolean(onGenerateCardPreset || onAskDeepAnswer || onAskAgent)

  const handleCopy = () => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (paletteOpen || aiOpen) {
          setPaletteOpen(false)
          setAiOpen(false)
          return
        }
        onDismiss()
        return
      }
      // Markdown 编辑器内划词走原生复制，不抢
      if (isMarkdownEditorFocused()) return
      if (shouldHandleReaderCopyShortcut(event, event.target, hasSelectionForCopy)) {
        // 对齐系统 Ctrl+C：复制后保留选区与工具条，不清
        event.preventDefault()
        handleCopy()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    // iframe 内按键冒泡不到主窗口：Foliate/WebDoc 把同一监听挂到内容文档
    const docs = [...new Set((keyEventDocs ?? []).filter((doc) => doc && doc !== document))]
    for (const doc of docs) doc.addEventListener('keydown', onKeyDown as EventListener)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      for (const doc of docs) doc.removeEventListener('keydown', onKeyDown as EventListener)
    }
  }, [onDismiss, onCopy, hasSelectionForCopy, keyEventDocs, paletteOpen, aiOpen])

  useEffect(() => {
    if (!paletteOpen && !aiOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-selection-toolbar-menu], [data-selection-toolbar-trigger]')) return
      setPaletteOpen(false)
      setAiOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [paletteOpen, aiOpen])

  const togglePalette = (event: React.MouseEvent<HTMLButtonElement>) => {
    setPaletteBelow(event.currentTarget.getBoundingClientRect().top < PALETTE_HEIGHT + 56)
    setPaletteOpen((value) => !value)
    setAiOpen(false)
  }

  const toggleAi = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAiBelow(event.currentTarget.getBoundingClientRect().top < AI_MENU_HEIGHT + 56)
    setAiOpen((value) => !value)
    setPaletteOpen(false)
  }

  const applyHighlight = (color: HighlightColorId) => {
    setLastColor(color)
    setPaletteOpen(false)
    setAiOpen(false)
    onHighlight?.(color)
  }

  const handlePickCard = (presetId: string, customText?: string) => {
    setAiOpen(false)
    onGenerateCardPreset?.(presetId, customText)
  }

  const handlePickDirection = (directionId: string) => {
    setAiOpen(false)
    onAskDeepAnswer?.(directionId)
  }

  const handleOpenComposer = () => {
    setAiOpen(false)
    onAskAgent?.()
  }

  return (
    <div
      className="fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-border/80 bg-background/90 p-1 shadow-2xl backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/10 select-none animate-in fade-in zoom-in-95 duration-150"
      style={{ left: x, top: Math.max(8, y - 48) }}
      role="toolbar"
      aria-label="选区操作"
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 gap-1 rounded-lg px-2 text-xs transition-colors',
          copied && 'text-emerald-500 font-medium',
        )}
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        <span>{copied ? '已复制' : '复制'}</span>
      </Button>

      {onHighlight ? (
        <div className="relative flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 rounded-l-lg rounded-r-none px-2 text-xs"
            title={`高亮 · ${activeColor.label}`}
            onClick={() => applyHighlight(lastColor)}
          >
            <span
              className="size-2.5 rounded-full ring-1 ring-black/20 dark:ring-white/30"
              style={{ backgroundColor: activeColor.swatch }}
            />
            <Highlighter className="size-3.5 text-muted-foreground" />
            <span>高亮</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-6 rounded-l-none rounded-r-lg px-0 text-muted-foreground"
            data-selection-toolbar-trigger
            aria-label="选择高亮颜色"
            aria-expanded={paletteOpen}
            onClick={togglePalette}
          >
            <ChevronDown className="size-3" />
          </Button>

          {paletteOpen ? (
            <div
              data-selection-toolbar-menu
              className={cn(
                'absolute left-1/2 z-10 w-max -translate-x-1/2 rounded-xl border border-border/80 bg-card/95 p-1.5 text-card-foreground shadow-2xl backdrop-blur-xl',
                paletteBelow ? 'top-full mt-2' : 'bottom-full mb-2',
              )}
            >
              <div className="flex items-center gap-1.5 px-0.5" role="group" aria-label="高亮颜色">
                {HIGHLIGHT_COLORS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      'size-4 rounded-full ring-1 ring-black/20 transition-transform duration-150 hover:scale-125 cursor-pointer dark:ring-white/30',
                      item.id === lastColor && 'ring-2 ring-foreground',
                    )}
                    style={{ backgroundColor: item.swatch }}
                    title={`高亮 · ${item.label}`}
                    aria-label={`高亮 ${item.label}`}
                    aria-pressed={item.id === lastColor}
                    onClick={() => applyHighlight(item.id)}
                  />
                ))}
              </div>
              {onAnnotate ? (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  onClick={() => {
                    setPaletteOpen(false)
                    onAnnotate()
                  }}
                >
                  <MessageSquarePlus className="size-3.5" />
                  <span>写批注</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : onAnnotate ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-lg px-2 text-xs hover:bg-muted/80"
          onClick={onAnnotate}
        >
          <MessageSquarePlus className="size-3.5 text-muted-foreground" />
          <span>批注</span>
        </Button>
      ) : null}

      {onReadAloud ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-lg px-2 text-xs text-primary hover:bg-primary/10 transition-colors"
          title="从当前划选的句子开始语音朗读"
          onClick={onReadAloud}
        >
          <Headphones className="size-3.5 text-primary" />
          <span>朗读</span>
        </Button>
      ) : null}

      {showAi ? (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 text-xs font-medium text-primary shadow-xs hover:bg-primary/20"
            title="AI 制卡、快速问答或去 Agent 面板细问"
            disabled={aiPending}
            data-selection-toolbar-trigger
            aria-expanded={aiOpen}
            onClick={toggleAi}
          >
            {aiPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            <span>AI</span>
            <ChevronDown className="size-3 opacity-70" />
          </Button>
          {aiOpen ? (
            <SelectionAiMenu
              className={aiBelow ? 'absolute top-full left-1/2 mt-2 -translate-x-1/2' : 'absolute bottom-full left-1/2 mb-2 -translate-x-1/2'}
              cardPending={cardPresetPending}
              answerPending={deepAnswerPending}
              onPickCard={handlePickCard}
              onPickDirection={handlePickDirection}
              onOpenComposer={handleOpenComposer}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
