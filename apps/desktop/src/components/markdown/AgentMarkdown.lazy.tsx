import { lazy } from 'react'
import { cn } from '@/lib/utils'

/**
 * Agent 正文懒加载入口：streamdown + remark/rehype + KaTeX 进独立分块，
 * 不进入首屏。首屏只保留 Bubble 外壳与纯文本回退（本文件仅依赖 react + cn）。
 */
export const AgentMarkdownLazy = lazy(() =>
  import('@/components/markdown/AgentMarkdown').then((m) => ({ default: m.AgentMarkdown })),
)

export function AgentMarkdownFallback({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]', className)}>
      {text}
    </div>
  )
}
