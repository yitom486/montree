import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import {
  AgentChatItem,
  AgentChatItemBody,
  useAgentChatOpen,
} from '@/components/agent/chat/AgentChatItem'
import { AgentMessageBubble } from '@/components/agent/chat/AgentMessageBubble'
import type { ChatTimelineItem } from '@/lib/agent/chat-timeline'
import type { ChapterMarkPlanSelectPayload } from '@/components/agent/propose/ChapterMarkPlanCard'

export type WorkLogItem = Extract<ChatTimelineItem, { kind: 'work-log' }>

interface AgentActivityGroupProps {
  group: WorkLogItem
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
}

/**
 * 工作记录：连续思考 / 工具 / 计划的折叠组。
 * 摘要只说真实操作（工具调用条数 + 历时），不用消息条数冒充步骤数。
 * 待审批与失败工具已由分组提升为单条，不会落进本组被折叠吞掉。
 */
export function AgentActivityGroup({ group, onChapterPlanSelect }: AgentActivityGroupProps) {
  const { messages } = group
  const [open, setOpen] = useAgentChatOpen(group.isActive)

  const thoughtCount = messages.filter((m) => m.role === 'thought').length
  const planCount = messages.filter((m) => m.role === 'plan').length
  const failedCount = messages.filter(
    (m) => m.role === 'tool' && m.toolStatus === 'failed',
  ).length

  const summary = group.isActive
    ? group.hasAwaitingApproval
      ? `等待批准 · 历时 ${group.durationLabel}`
      : `${group.currentAction ?? '工作中'} · 历时 ${group.durationLabel}`
    : `工作记录 · 工具调用 ${group.toolCallCount} · 历时 ${group.durationLabel}`

  const sub = [
    thoughtCount > 0 ? `思考 ${thoughtCount}` : null,
    planCount > 0 ? `计划 ${planCount}` : null,
    failedCount > 0 ? `失败 ${failedCount}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <AgentChatItem
      variant="card"
      tone={group.isActive ? 'activity-active' : 'activity'}
      streaming={group.isActive}
      probe="activity"
      messageId={group.key}
      role="activity"
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {group.isActive ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-500" />
        ) : open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
          {summary}
          {sub ? <span className="ml-1.5 font-normal opacity-80">（{sub}）</span> : null}
        </span>
      </button>

      {open ? (
        <AgentChatItemBody className="space-y-2 border-border/30 px-2 py-2">
          {messages.map((msg) => (
            <AgentMessageBubble
              key={msg.id}
              message={msg}
              onChapterPlanSelect={onChapterPlanSelect}
            />
          ))}
        </AgentChatItemBody>
      ) : null}
    </AgentChatItem>
  )
}
