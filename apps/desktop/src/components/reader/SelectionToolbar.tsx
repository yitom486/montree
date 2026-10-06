import { useEffect, useState } from 'react'
import {
  BotMessageSquare,
  Check,
  ClipboardPaste,
  Copy,
  Loader2,
  MessageSquarePlus,
  Quote,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardPresetMenuContent } from '@/components/reader/CardPresetMenu'
import { DeepAnswerMenuContent } from '@/components/reader/DeepAnswerMenu'
import { isMarkdownEditorFocused } from '@/lib/editor/editor-focus'
import { cn } from '@/lib/utils'
import { shouldHandleReaderCopyShortcut } from '@montree/reader-core'
import {
  HIGHLIGHT_COLORS,
  type HighlightColorId,
} from '@montree/reader-core'

export interface SelectionToolbarProps {
  x: number
  y: number
  readOnly?: boolean
  onCopy: () => void
  /** 快捷键复制门：无阅读选区时不拦截（Electron editMenu 保底） */
  hasSelectionForCopy?: boolean
  /** iframe 阅读器（Foliate/WebDoc）额外监听其 contentDocument，PDF 不传 */
  keyEventDocs?: Document[]
  onAnnotate: () => void
  /** 打开 Agent 面板并带着当前选区去提问 */
  onAskAgent?: () => void
  /**
   * 一键深度问答（P2 菜单驱动）：directionId 见 deep-answer，
   * 答案落对话框；composer 追问入口保留在菜单末项。
   */
  onAskDeepAnswer?: (directionId: string) => void
  deepAnswerPending?: boolean
  /** 在输入框插入「选区」短标记（不贴正文） */
  onAddToChat?: () => void
  /** 将当前选区存为高亮；颜色由色点选择，默认黄 */
  onHighlight?: (color: HighlightColorId) => void
  /**
   * AI 制卡（P1 菜单驱动）：presetId 见 card-studio-presets，
   * customText 仅"更多要求"入口携带；pending 时调用方禁用菜单。
   */
  onGenerateCardPreset?: (presetId: string, customText?: string) => void
  cardPresetPending?: boolean
  onDismiss: () => void
}

export function SelectionToolbar({
  x,
  y,
  readOnly = true,
  onCopy,
  hasSelectionForCopy = false,
  keyEventDocs,
  onAnnotate,
  onAskAgent,
  onAskDeepAnswer,
  deepAnswerPending = false,
  onAddToChat,
  onHighlight,
  onGenerateCardPreset,
  cardPresetPending = false,
  onDismiss,
}: SelectionToolbarProps) {
  const [copied, setCopied] = useState(false)
  const [cardMenuOpen, setCardMenuOpen] = useState(false)
  const [answerMenuOpen, setAnswerMenuOpen] = useState(false)

  const handleCopy = () => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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
  }, [onDismiss, onCopy, hasSelectionForCopy, keyEventDocs])

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

      {readOnly ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-lg px-2 text-xs"
          onClick={() => undefined}
        >
          <ClipboardPaste className="size-3.5" />
          粘贴
        </Button>
      )}

      {onHighlight ? (
        <div
          className="mx-0.5 flex items-center gap-1.5 border-l border-border/60 pl-2 pr-1.5"
          role="group"
          aria-label="划重点"
        >
          <span className="text-[10.5px] font-medium text-muted-foreground">高亮</span>
          <div className="flex items-center gap-1">
            {HIGHLIGHT_COLORS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="size-3.5 rounded-full ring-1 ring-black/20 dark:ring-white/30 transition-transform duration-150 hover:scale-125 cursor-pointer shadow-xs"
                style={{ backgroundColor: item.swatch }}
                title={`划重点 · ${item.label}`}
                aria-label={`划重点 ${item.label}`}
                onClick={() => onHighlight(item.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 rounded-lg px-2 text-xs hover:bg-muted/80"
        onClick={onAnnotate}
      >
        <MessageSquarePlus className="size-3.5 text-muted-foreground" />
        <span>批注</span>
      </Button>

      {onGenerateCardPreset ? (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 rounded-lg border border-primary/25 bg-primary/10 px-2 text-xs font-medium text-primary shadow-xs hover:bg-primary/20"
            title="选方向调 AI 提炼为知识卡片（未连接自动直连）"
            disabled={cardPresetPending}
            onClick={() => setCardMenuOpen((v) => !v)}
          >
            {cardPresetPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            <span>{cardPresetPending ? '制卡中' : '智能制卡'}</span>
          </Button>
          {cardMenuOpen ? (
            <CardPresetMenuContent
              className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2"
              pending={cardPresetPending}
              onPick={(presetId, customText) => {
                setCardMenuOpen(false)
                onGenerateCardPreset(presetId, customText)
              }}
            />
          ) : null}
        </div>
      ) : null}

      {onAddToChat ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-lg px-2 text-xs hover:bg-muted/80"
          title="在输入框插入「选区」标记，正文由 Agent 读取"
          onClick={onAddToChat}
        >
          <Quote className="size-3.5 text-muted-foreground" />
          <span>引用</span>
        </Button>
      ) : null}

      {onAskDeepAnswer || onAskAgent ? (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 text-xs font-medium text-primary shadow-xs hover:bg-primary/20"
            disabled={deepAnswerPending}
            onClick={() => setAnswerMenuOpen((v) => !v)}
          >
            {deepAnswerPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            <span>{deepAnswerPending ? '问答中' : '深度问答'}</span>
          </Button>
          {answerMenuOpen ? (
            <DeepAnswerMenuContent
              className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2"
              pending={deepAnswerPending}
              onPick={(directionId) => {
                setAnswerMenuOpen(false)
                onAskDeepAnswer?.(directionId)
              }}
              onOpenComposer={() => {
                setAnswerMenuOpen(false)
                onAskAgent?.()
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
