import { useRef, useState } from 'react'

export interface ChatComposerProps {
  onSend(text: string): void
  disabled?: boolean
  placeholder?: string
  className?: string
}

/**
 * 最小输入条（S2）：textarea + 发送按钮，不写应用主题。
 * - Enter 发送（`preventDefault`，不插入换行），Shift+Enter 换行；
 * - IME 组合中（`isComposing` / keyCode 229 / composition 事件三重守卫）不发送；
 * - 空白文本不发送（按钮 disabled + submit 内二次守卫）。
 */
export function ChatComposer({
  onSend,
  disabled = false,
  placeholder = '输入消息…',
  className,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('')
  const composingRef = useRef(false)
  const canSend = draft.trim().length > 0 && !disabled

  function submit(): void {
    if (!canSend) return
    const text = draft
    setDraft('')
    onSend(text)
  }

  return (
    <div className={className} data-testid="chat-composer">
      <textarea
        data-testid="chat-composer-input"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return
          if (e.nativeEvent.isComposing || composingRef.current) return
          if ((e.nativeEvent as unknown as { keyCode?: number }).keyCode === 229) return
          e.preventDefault()
          submit()
        }}
      />
      <button
        type="button"
        data-testid="chat-composer-send"
        disabled={!canSend}
        onClick={() => submit()}
      >
        发送
      </button>
    </div>
  )
}
