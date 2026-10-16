import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
// 自 `apps/desktop/src/components/agent/chat/AgentChatItem.tsx` 整搬（M3b 纯展示批）：
// `Message/MessageContent` 改引包内 `./message-shell`（宿主 `ai-elements/message` 逐字复刻，
// 仅 `from` 类型以内联联合替代 `ai` 的 `UIMessage["role"]` 以免引入 `ai` 依赖）；
// `logAcpLayoutProbe` 改引包内 `./layout-probe`（宿主 DEV 探针逐字复刻）；`cn` 改 `./cn`。
import { Message, MessageContent } from './message-shell'
import { logAcpLayoutProbe } from './layout-probe'
import { cn } from './cn'

/**
 * 聊天条目统一壳：宽度 / 换行 / 对齐只在这里定义。
 * 流式与终态共用同一 DOM 壳；内容插槽可换，壳不换。
 *
 * 折叠状态由 AI Elements / Radix 管理，不要进 Zustand。
 * Zustand 只放会话消息、连接、权限等跨层数据。
 */

export type AgentChatItemVariant = 'bubble' | 'card' | 'system'

export type AgentChatItemTone =
  | 'default'
  | 'user'
  | 'agent'
  | 'tool'
  | 'tool-pending'
  | 'thought'
  | 'plan'
  | 'activity'
  | 'activity-active'

/** 列表列宽约束：ScrollArea 内所有条目祖先应带上 */
export const AGENT_CHAT_COL_CLASS =
  'min-w-0 max-w-full overflow-x-hidden'

/** 可折叠区块正文：长路径 / pre 不得撑开列 */
export const AGENT_CHAT_BODY_CLASS =
  'min-w-0 max-w-full space-y-1.5 overflow-x-hidden border-t border-border/40 px-2.5 py-2'

/** 长文本 / 工具输出 */
export const AGENT_CHAT_PRE_CLASS =
  'max-h-40 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]'

interface AgentChatItemProps {
  variant: AgentChatItemVariant
  tone?: AgentChatItemTone
  /** bubble：用户靠右，其余靠左；card/system 忽略 */
  align?: 'start' | 'end'
  streaming?: boolean
  /** 子节点已自带气泡外观时，只保留消息布局与探针。 */
  bare?: boolean
  probe?: string
  messageId?: string
  role?: string
  className?: string
  children: ReactNode
}

function cardToneClass(tone: AgentChatItemTone): string {
  switch (tone) {
    case 'tool':
      return 'border-border/50 bg-muted/15'
    case 'tool-pending':
      return 'border-amber-500/45 bg-amber-500/[0.07]'
    case 'thought':
      return 'border-border/40 bg-muted/10'
    case 'plan':
      return 'border-border/50 bg-muted/10'
    case 'activity':
      return 'border-border/40 bg-muted/10'
    case 'activity-active':
      return 'border-amber-500/20 bg-amber-500/[0.04]'
    default:
      return 'border-border/50 bg-muted/15'
  }
}

function cardActiveRing(tone: AgentChatItemTone, streaming?: boolean): string | false {
  if (!streaming) return false
  if (tone === 'tool-pending' || tone === 'activity-active') return false
  if (tone === 'tool') return 'border-amber-500/25 bg-amber-500/5'
  if (tone === 'plan') return 'border-sky-500/25 bg-sky-500/5'
  if (tone === 'activity') return 'border-amber-500/20 bg-amber-500/[0.04]'
  return false
}

function useLayoutProbe(
  rootRef: RefObject<HTMLDivElement | null>,
  meta: {
    probe?: string
    messageId?: string
    role?: string
    streaming?: boolean
  },
) {
  const prevStreaming = useRef(meta.streaming)
  useEffect(() => {
    const flipped = prevStreaming.current !== meta.streaming
    prevStreaming.current = meta.streaming
    const id = window.requestAnimationFrame(() => {
      logAcpLayoutProbe(rootRef.current, {
        tag: 'AgentChatItem',
        role: meta.role ?? meta.probe,
        messageId: meta.messageId,
        streaming: Boolean(meta.streaming),
        force: flipped,
      })
    })
    return () => window.cancelAnimationFrame(id)
  }, [rootRef, meta.messageId, meta.probe, meta.role, meta.streaming])
}


export function AgentChatItemBody({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <div className={cn(AGENT_CHAT_BODY_CLASS, className)}>{children}</div>
}

export function AgentChatItem({
  variant,
  tone = 'default',
  align = 'start',
  streaming,
  bare = false,
  probe,
  messageId,
  role,
  className,
  children,
}: AgentChatItemProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutProbe(rootRef, { probe, messageId, role, streaming })

  if (variant === 'system') {
    return (
      <div
        ref={rootRef}
        data-acp-probe={probe ?? 'system'}
        className={cn(
          AGENT_CHAT_COL_CLASS,
          'px-1 py-0.5 text-center text-[10px] text-muted-foreground/70',
          className,
        )}
      >
        {children}
      </div>
    )
  }

  if (variant === 'bubble') {
    const isUser = tone === 'user'
    return (
      <Message
        ref={rootRef}
        from={isUser ? 'user' : 'assistant'}
        data-acp-probe={probe ?? (isUser ? 'user' : 'agent')}
        data-agent-message-id={messageId}
        // assistant-ui 跟滚库的展开暂停（pauseFollowOnExpand）只认 data-message-id：
        // 缺之点击 summary/aria-expanded 折叠时照常跟底，summary 被顶出鼠标（“向上展开”）。
        data-message-id={messageId}
        className={cn(AGENT_CHAT_COL_CLASS, 'max-w-full animate-fade-slide-in', align === 'end' && 'items-end')}
      >
        {bare ? children : (
          <MessageContent
            className={cn(
              'text-[13px] leading-relaxed',
              isUser
                ? 'max-w-[85%] rounded-2xl rounded-tr-xs border border-border/70 bg-secondary px-3.5 py-2.5 text-secondary-foreground shadow-xs group-[.is-user]:bg-secondary group-[.is-user]:text-secondary-foreground'
                : 'w-full px-1 py-1 text-foreground',
              className,
            )}
          >
            {children}
          </MessageContent>
        )}
      </Message>
    )
  }

  // card：工具 / 思考 / 计划 / 活动组
  return (
    <div
      ref={rootRef}
      data-acp-probe={probe ?? tone}
      data-message-id={messageId}
      className={cn(
        AGENT_CHAT_COL_CLASS,
        'rounded-xl border transition-colors',
        cardToneClass(tone),
        cardActiveRing(tone, streaming),
        className,
      )}
    >
      {children}
    </div>
  )
}
