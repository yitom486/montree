// Beautiful UI 视觉参考，本地适配；MIT © 2026 Shane Levine，见 ../LICENSE.beautiful-ui。
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type BuiMessageFrom = 'user' | 'assistant' | 'system'

interface BuiMessageProps {
  from: BuiMessageFrom
  streaming?: boolean
  actions?: ReactNode
  className?: string
  children: ReactNode
}

// 入场动效只引用全局已落地的 bui keyframes，不新增样式；reduced-motion 由全局统关。
const ENTER_ANIMATION = 'bui-fade-up 240ms cubic-bezier(0.23,1,0.32,1) both'

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
        className={cn('bui-anim group flex w-full justify-end', className)}
        style={{ animation: ENTER_ANIMATION }}
      >
        <div className="min-w-0 max-w-[85%] rounded-2xl rounded-br-md border border-border/60 bg-secondary px-3.5 py-2.5 text-[13px] leading-relaxed text-secondary-foreground">
          <div className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</div>
          {actions ? <BuiMessageActions>{actions}</BuiMessageActions> : null}
        </div>
      </div>
    )
  }

  return (
    <div
      data-bui-message="assistant"
      className={cn('bui-anim group w-full min-w-0', className)}
      style={{ animation: ENTER_ANIMATION }}
    >
      <div
        className={cn(
          'min-w-0 px-1 py-1 text-[13px] leading-relaxed text-foreground',
          streaming && 'agent-beam-ring agent-beam-ring-emerald rounded-lg',
        )}
      >
        <div className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</div>
        {actions ? <BuiMessageActions>{actions}</BuiMessageActions> : null}
      </div>
    </div>
  )
}
