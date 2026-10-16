// BeUI Message Bubble 视觉适配，MIT © 2026 Saurabh Chauhan，见 ../LICENSE.beui。
// 保留宿主宽度、附件与动作槽，Motion 改用 CSS，不接管会话或视口。
import type { ReactNode } from 'react'
import { cn } from './cn'

export type BuiMessageFrom = 'user' | 'assistant' | 'system'

interface BuiMessageProps {
  from: BuiMessageFrom
  streaming?: boolean
  actions?: ReactNode
  className?: string
  children: ReactNode
}

// 入场动效只引用全局已落地的 bui keyframes，不新增样式；reduced-motion 由全局统关。
const ENTER_ANIMATION = 'beui-message-in 240ms cubic-bezier(0.16,1,0.3,1) both'

function BuiMessageActions({ children }: { children: ReactNode }) {
  // hover 与键盘焦点才显：鼠标悬停走 group-hover，Tab 进入按钮走 focus-within，避免常驻挤占正文。
  return (
    <div
      aria-label="消息操作"
      className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100"
    >
      {children}
    </div>
  )
}

export function BuiMessage({ from, streaming = false, actions, className, children }: BuiMessageProps) {
  if (from === 'system') {
    return (
      <div
        data-bui-message="system"
        className={cn('bui-anim px-1 py-0.5 text-center text-[11px] text-muted-foreground', className)}
        style={{ animation: ENTER_ANIMATION }}
      >
        {children}
      </div>
    )
  }

  if (from === 'user') {
    return (
      <div
        data-bui-message="user"
        data-slot="message-bubble"
        data-align="end"
        className={cn('bui-anim group flex w-full justify-end', className)}
        style={{ animation: ENTER_ANIMATION }}
      >
        <div data-slot="message-bubble-content" className="relative min-w-9 max-w-[85%] rounded-2xl rounded-br-md border border-border/50 bg-secondary px-3.5 py-2.5 text-[13px] leading-relaxed text-secondary-foreground shadow-xs">
          <div className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</div>
          {actions ? <BuiMessageActions>{actions}</BuiMessageActions> : null}
        </div>
      </div>
    )
  }

  return (
    <div
      data-bui-message="assistant"
      data-slot="message-bubble"
      data-align="start"
      className={cn('bui-anim group w-full min-w-0', className)}
      style={{ animation: ENTER_ANIMATION }}
    >
      <div
        data-slot="message-bubble-content"
        className={cn(
          'min-w-0 w-full rounded-2xl border border-border/35 bg-muted/15 px-3 py-2 text-[13px] leading-relaxed text-foreground',
          streaming && 'agent-beam-ring agent-beam-ring-emerald rounded-lg',
        )}
      >
        <div className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</div>
        {actions ? <BuiMessageActions>{actions}</BuiMessageActions> : null}
      </div>
    </div>
  )
}
