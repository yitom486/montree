import { useMemo, useState } from 'react'
import { ArrowRight, BookmarkPlus, Check, Copy, Loader2, RefreshCw, X } from 'lucide-react'
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type TextMessagePartProps,
} from '@assistant-ui/react'
import { Button } from '@/components/ui/button'
import { TranslationSurface } from './TranslationSurface'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  onSave,
}: {
  translation: ReaderTranslationState
  onClose: () => void
  onRetry: () => void
  onCopy: () => void
  onSave: () => void
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

  const pending = translation.phase === 'recognizing' || translation.phase === 'preparing' || translation.phase === 'streaming' || translation.phase === 'enriching'

  return (
    <TranslationSurface key={translation.requestId} x={translation.position.x} y={translation.position.y} onClose={onClose}>
      <div data-translation-drag tabIndex={0} aria-label="拖动翻译卡，方向键移动" className="flex shrink-0 touch-none cursor-grab select-none items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="shrink-0">译</span>
          <span className="truncate">{translation.details?.sourceLanguage || '自动识别'}</span>
          <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
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

      <ScrollArea type="always" className="min-h-0 overflow-hidden [&_[data-slot=scroll-area-viewport]]:max-h-[min(26rem,calc(100dvh-7rem))]">
      <div role="region" aria-label="译文与解读" tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !['Home', 'End'].includes(event.key)) return
          const viewport = event.currentTarget.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
          viewport?.scrollTo({ top: event.key === 'Home' ? 0 : viewport.scrollHeight })
          event.preventDefault()
        }}
        className="min-h-0 space-y-2 overflow-y-auto px-3 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
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
        {translation.phase === 'enriching' ? (
          <p role="status" className="text-xs text-muted-foreground">正在补充词句解读…</p>
        ) : null}
        {translation.details?.phrases.length ? (
          <section aria-label="关键短语" className="border-t border-border/60 pt-2">
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">关键短语</h3>
            <dl className="space-y-1.5 text-xs leading-relaxed">
              {translation.details.phrases.map((item) => (
                <div key={item.text}>
                  <dt className="font-medium text-foreground">{item.text}</dt>
                  <dd className="mt-0.5 text-muted-foreground">{item.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        {translation.details?.terms.length ? (
          <section aria-label="专有名词" className="border-t border-border/60 pt-2">
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">专有名词</h3>
            <dl className="space-y-1.5 text-xs leading-relaxed">
              {translation.details.terms.map((item) => (
                <div key={item.text}>
                  <dt className="font-medium text-foreground">{item.text}</dt>
                  <dd className="mt-0.5 text-muted-foreground">{item.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>
      </ScrollArea>
      {translation.saveError ? <p role="alert" className="shrink-0 border-t border-border/60 px-3 py-2 text-xs text-destructive">{translation.saveError}</p> : null}

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 border-t border-border/60 px-2 py-1.5">
        {translation.canSave ? (
          <Button type="button" size="xs" variant="ghost" className="mr-auto h-7 gap-1 text-xs"
            disabled={translation.phase !== 'done' || translation.saving || translation.saved || !translation.text.trim()}
            onClick={onSave}>
            {translation.saving ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              : translation.saved ? <Check className="size-3.5 text-primary" /> : <BookmarkPlus className="size-3.5" />}
            {translation.saved ? '已存批注' : translation.saving ? '保存中…' : '存为批注'}
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          disabled={!translation.text.trim()}
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
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
    </TranslationSurface>
  )
}
