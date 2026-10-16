import { lazy } from 'react'
import { cn } from './cn'

/**
 * 聊天正文懒加载入口：streamdown + remark/rehype + KaTeX 进独立分块，
 * 不进入首屏。首屏只保留 Bubble 外壳与纯文本回退（本文件仅依赖 react + cn）。
 * 整搬自 `apps/desktop/src/components/markdown/AgentMarkdown.lazy.tsx`（改名）。
 */
export const ChatMarkdownLazy = lazy(() =>
  import('./chat-markdown').then((m) => ({ default: m.ChatMarkdown })),
)

export function ChatMarkdownFallback({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]', className)}>
      {text}
    </div>
  )
}
