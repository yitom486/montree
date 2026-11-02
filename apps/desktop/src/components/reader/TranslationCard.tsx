import { useMemo, useState } from 'react'
import { Check, Copy, Loader2, RefreshCw, X } from 'lucide-react'
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type TextMessagePartProps,
} from '@assistant-ui/react'
import { Button } from '@/components/ui/button'
import { AnchoredSurface } from '@/components/shared/AnchoredSurface'
import type { ReaderTranslationState } from '@/hooks/reader/useReaderTranslation'

/**
 * 划词翻译卡：非模态锚定浮层，主译文是唯一视觉重点。
 * 流式文本交给 assistant-ui 的 external store runtime + parts 管线；
 * 卡片外壳不套聊天气泡、Thread Viewport 或 Composer。
 */
function TranslationText({ text, status }: TextMessagePartProps) {
  return (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">
      {text}
      {status.type === 'running' ? (
        <span className="ml-0.5 inline-block h-3.5 w-px animate-pulse bg-primary align-[-2px]" />
      ) : null}
    </div>
  )
}

function TranslationMessage() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Parts components={{ Text: TranslationText }} />
    </MessagePrimitive.Root>
  )
}

const TRANSLATION_MESSAGE_COMPONENTS = { Message: TranslationMessage }

export function TranslationCard({
  translation,
  onClose,
  onRetry,
  onCopy,
}: {
  translation: ReaderTranslationState
  onClose: () => void
  onRetry: () => void
  onCopy: () => void
}) {
  const [copied, setCopied] = useState(false)
  const messages = useMemo(
    () => [
      {
        id: 'translation',
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: translation.text }],
      },
    ],
    [translation.text],
  )
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: translation.phase === 'recognizing' || translation.phase === 'preparing' || translation.phase === 'streaming',
    onNew: async () => {},
    onCancel: async () => {},
  })

  const handleCopy = () => {
    onCopy()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const pending = translation.phase === 'recognizing' || translation.phase === 'preparing' || translation.phase === 'streaming'

  return (
    <AnchoredSurface
      x={translation.position.x}
      y={translation.position.y}
      label="划词翻译"
      interactive
      autoFocus={false}
      onDismiss={onClose}
      className="w-[380px] p-0"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="shrink-0">译</span>
          <span className="truncate">{translation.targetLabel}</span>
          {pending ? <Loader2 className="size-3 animate-spin text-primary" /> : null}
        </span>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          aria-label="关闭翻译"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <p className="line-clamp-2 border-l-2 border-border/70 pl-2 text-[11px] leading-relaxed text-muted-foreground">
          {translation.sourceText}
        </p>

        {translation.phase === 'recognizing' || translation.phase === 'preparing' ? (
          <div role="status" className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-primary" />
            {translation.phase === 'recognizing' ? '正在识别选中文字…' : '正在翻译…'}
          </div>
        ) : translation.phase === 'error' ? (
          <p className="py-1 text-sm text-destructive">{translation.error || '翻译失败'}</p>
        ) : (
          <AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root>
              <ThreadPrimitive.MessageByIndex index={0} components={TRANSLATION_MESSAGE_COMPONENTS} />
            </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
        )}
      </div>

      <div className="flex items-center justify-end gap-1 border-t border-border/60 px-2 py-1.5">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          disabled={!translation.text.trim()}
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          {copied ? '已复制' : '复制'}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          disabled={pending}
          onClick={onRetry}
        >
          <RefreshCw className="size-3.5" />
          重试
        </Button>
      </div>
    </AnchoredSurface>
  )
}
