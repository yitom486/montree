// BeUI context-menu visual reference (MIT © 2026 Saurabh Chauhan), see ../LICENSE.beui.
import { useRef, useState, type ReactElement, type RefObject } from 'react'
import { ContextMenu } from 'radix-ui'
import { toast } from 'sonner'
import { useAcpUiStore } from '@/stores/acp-ui-store'

interface Snapshot { text: string; start: number; end: number; value: string; threadId?: string; message?: { text: string; role: string } }
const ITEM = 'flex cursor-default items-center rounded-lg px-2.5 py-2 text-xs outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40 motion-reduce:transition-none'

export function AgentContextMenu({ children, textareaRef, selectionRoot, onDraftChange, onQuote, getMessage, onScrollToBottom }: {
  children: ReactElement
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  selectionRoot?: RefObject<HTMLDivElement | null>
  onDraftChange?: (text: string) => void
  onQuote?: (text: string) => void
  getMessage?: (id: string) => { text: string; role: string } | undefined
  onScrollToBottom?: () => void
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ text: '', start: 0, end: 0, value: '' })
  const origin = useRef<HTMLElement | null>(null)
  const editable = Boolean(textareaRef?.current && !textareaRef.current.disabled && !textareaRef.current.readOnly)
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text) } catch { toast.error('无法访问剪贴板，请使用 Ctrl+C') }
  }
  const replaceSelection = (text: string) => {
    const input = textareaRef?.current
    if (!input || !input.isConnected || input.disabled || input.readOnly) return
    if (input.value !== snapshot.value || useAcpUiStore.getState().activeThreadId !== snapshot.threadId) { toast.info('输入内容或会话已变化，请重新打开菜单'); return }
    onDraftChange?.(snapshot.value.slice(0, snapshot.start) + text + snapshot.value.slice(snapshot.end))
    requestAnimationFrame(() => { if (input.isConnected) { input.focus({ preventScroll: true }); input.setSelectionRange(snapshot.start + text.length, snapshot.start + text.length) } })
  }
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild onContextMenu={(event) => {
        const input = textareaRef?.current
        const selection = window.getSelection()
        const selectedHere = selection?.anchorNode && event.currentTarget.contains(selection.anchorNode)
        const id = (event.target as HTMLElement).closest('[data-agent-message-id]')?.getAttribute('data-agent-message-id')
        origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setSnapshot({ text: input ? input.value.slice(input.selectionStart, input.selectionEnd) : selectedHere ? selection!.toString() : '',
          start: input?.selectionStart ?? 0, end: input?.selectionEnd ?? 0, value: input?.value ?? '', threadId: useAcpUiStore.getState().activeThreadId, message: id ? getMessage?.(id) : undefined })
      }}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content aria-label={textareaRef ? '输入框操作' : '聊天操作'} collisionPadding={8}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (document.activeElement === document.body && origin.current?.isConnected) origin.current.focus({ preventScroll: true }) }}
          className="z-[70] min-w-44 max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto rounded-xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-xl origin-[var(--radix-context-menu-content-transform-origin)] motion-safe:animate-[surface-in_160ms_ease-out] motion-reduce:animate-none">
          <ContextMenu.Item className={ITEM} disabled={!snapshot.text} onSelect={() => void copy(snapshot.text)}>复制选中文字</ContextMenu.Item>
          {textareaRef ? <>
            <ContextMenu.Item className={ITEM} disabled={!editable || !snapshot.text} onSelect={() => { void navigator.clipboard.writeText(snapshot.text).then(() => replaceSelection('')).catch(() => toast.error('无法访问剪贴板，请使用 Ctrl+X')) }}>剪切</ContextMenu.Item>
            <ContextMenu.Item className={ITEM} disabled={!editable} onSelect={() => { void navigator.clipboard.readText().then(replaceSelection).catch(() => toast.error('无法读取剪贴板，请使用 Ctrl+V')) }}>粘贴文本</ContextMenu.Item>
          </> : <>
            {snapshot.message?.text ? <ContextMenu.Item className={ITEM} onSelect={() => void copy(snapshot.message!.text)}>复制消息原文</ContextMenu.Item> : null}
            <ContextMenu.Item className={ITEM} disabled={!snapshot.text || !onQuote} onSelect={() => onQuote?.(snapshot.text)}>引用选中文字</ContextMenu.Item>
          </>}
          <ContextMenu.Separator className="my-1 h-px bg-border/60" />
          <ContextMenu.Item className={ITEM} onSelect={(event) => {
            event.preventDefault()
            const input = textareaRef?.current
            if (input) { input.focus(); input.select(); setSnapshot({ ...snapshot, text: input.value, start: 0, end: input.value.length, value: input.value }) }
            else if (selectionRoot?.current) { const range = document.createRange(); range.selectNodeContents(selectionRoot.current); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); setSnapshot({ ...snapshot, text: selection?.toString() ?? '' }) }
          }}>全选</ContextMenu.Item>
          {onScrollToBottom ? <ContextMenu.Item className={ITEM} onSelect={onScrollToBottom}>回到底部</ContextMenu.Item> : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
