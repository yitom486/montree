import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning'
import {
  Check,
  Circle,
  ListTodo,
  Loader2,
} from 'lucide-react'
import { AgentChatItem, AgentChatItemBody } from '@yitom/chat-ui'
import { cn } from '@/lib/utils'
import { summarizePlanProgress } from '@yitom/chat-core'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

interface AgentPlanCardProps {
  message: AcpChatMessage
}

function StatusIcon({ status }: { status?: string }) {
  if (status === 'completed') {
    return <Check className="size-3.5 shrink-0 text-emerald-500" />
  }
  if (status === 'in_progress') {
    return <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none text-amber-500" />
  }
  if (status === 'cancelled') {
    return <Circle className="size-3.5 shrink-0 text-muted-foreground/50" />
  }
  return <Circle className="size-3.5 shrink-0 text-muted-foreground/70" />
}

export function AgentPlanCard({ message }: AgentPlanCardProps) {
  const entries = message.planEntries ?? []
  const summary = summarizePlanProgress(entries)
  const active = Boolean(message.streaming) || summary.active

  const title = active
    ? `计划 · ${summary.completed}/${summary.total}`
    : `计划完成 · ${summary.completed}/${summary.total}`

  return (
    <AgentChatItem
      variant="card"
      tone="plan"
      streaming={active}
      probe="plan"
      messageId={message.id}
      role="plan"
    >
      <Reasoning defaultOpen={false} isStreaming={active} className="mb-0">
      <ReasoningTrigger
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 min-h-11 text-left focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ListTodo className="size-3.5 shrink-0 text-sky-500" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
          {title}
        </span>
      </ReasoningTrigger>

      <ReasoningContent>
        <AgentChatItemBody className="space-y-1">
          <ul className="space-y-1">
            {entries.map((entry, index) => (
              <li
                key={`${index}-${entry.content.slice(0, 24)}`}
                className="flex items-start gap-2 text-[11px] leading-relaxed"
              >
                <StatusIcon status={entry.status} />
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words [overflow-wrap:anywhere]',
                    entry.status === 'completed' && 'text-muted-foreground line-through',
                    entry.status === 'in_progress' && 'text-foreground',
                    entry.status === 'pending' && 'text-muted-foreground',
                  )}
                >
                  {entry.content}
                  {entry.priority ? (
                    <span className="ml-1.5 text-[10px] opacity-60">{entry.priority}</span>
                  ) : null}
                </span>
              </li>
            ))}
            {entries.length === 0 ? (
              <li className="text-[10px] text-muted-foreground">暂无计划条目</li>
            ) : null}
          </ul>
        </AgentChatItemBody>
      </ReasoningContent>
      </Reasoning>
    </AgentChatItem>
  )
}
