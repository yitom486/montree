import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import {
  AgentChatItem,
  AgentChatItemBody,
} from '@/components/agent/chat/AgentChatItem'
import { AgentMessageBubble } from '@/components/agent/chat/AgentMessageBubble'
import { AgentToolCallCard } from '@/components/agent/tools/AgentToolCallCard'
import { ToolStateIcon } from '@/components/ai-elements/tool'
import type { ChatTimelineItem } from '@/lib/agent/chat-timeline'
import { formatDuration, type AcpChatMessage } from '@/stores/acp-chat-types'
import { toToolDisplayModel } from '@/lib/agent/tool-display-model'
import type { ChapterMarkPlanSelectPayload } from '@/components/agent/propose/ChapterMarkPlanCard'
import { cn } from '@/lib/utils'

export type WorkLogItem = Extract<ChatTimelineItem, { kind: 'work-log' }>

interface AgentActivityGroupProps {
  group: WorkLogItem
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
}

/** 轻量工具行：标题+目标+状态，一行；按需展开单个调用的完整详情。 */
function WorkLogToolRow({ message }: { message: AcpChatMessage }) {
  const [open, setOpen] = useState(false)
  const display = toToolDisplayModel(message)
  const aiState =
    display.state === 'in-progress'
      ? 'running'
      : display.state === 'failed'
        ? 'error'
        : display.state === 'cancelled'
          ? 'cancelled'
          : display.state === 'completed'
            ? 'completed'
            : display.state === 'awaiting-approval'
              ? 'awaiting-approval'
              : display.state === 'pending'
                ? 'pending'
                : 'unknown'
  return (
    <div className="min-w-0 rounded-lg border border-transparent">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <ToolStateIcon state={aiState} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
          {display.title}
          {display.targetSummary ? (
            <span className="ml-1.5 font-normal text-muted-foreground">
              {display.targetSummary}
            </span>
          ) : null}
        </span>
        {display.durationMs != null ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {formatDuration(display.durationMs)}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="min-w-0 pb-1 pl-2">
          <AgentToolCallCard message={message} bare detailsOnly />
        </div>
      ) : null}
    </div>
  )
}

/**
 * 工作记录：同一用户回合的普通过程汇总，默认收起（运行中亦然）。
 * 用户打开/关闭选择跨 chunk/落定保留（key 按回合归属稳定，不 remount）。
 * 摘要只说真实操作与状态计数；无可信时间省略历时，不估算耗时。
 */
export function AgentActivityGroup({ group, onChapterPlanSelect }: AgentActivityGroupProps) {
  const [open, setOpen] = useState(false)

  const doneCount =
    group.completedCount + group.failedCount + group.cancelledCount
  const summary = group.isActive
    ? group.hasAwaitingApproval
      ? `等待批准${group.hasTrustedTime ? ` · 历时 ${group.durationLabel}` : ''}`
      : `${group.currentAction ?? '工作中'}${group.toolCallCount > 0 ? ` · ${doneCount}/${group.toolCallCount}` : ''}${group.hasTrustedTime ? ` · 历时 ${group.durationLabel}` : ''}`
    : `工作记录 · 工具调用 ${group.toolCallCount}${group.hasTrustedTime ? ` · 历时 ${group.durationLabel}` : ''}`

  const sub = [
    group.thoughtCount > 0 ? `思考 ${group.thoughtCount}` : null,
    group.planCount > 0 ? `计划 ${group.planCount}` : null,
    group.failedCount > 0 ? `失败 ${group.failedCount}` : null,
    group.cancelledCount > 0 ? `已取消 ${group.cancelledCount}` : null,
    group.unknownCount > 0 ? `未知 ${group.unknownCount}` : null,
    group.hiddenToolCallCount > 0 ? `含未加载 ${group.hiddenToolCallCount} 条` : null,
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
        title={group.lastEvent ? `${summary}（最近：${group.lastEvent.title}${group.lastEvent.ok ? '完成' : '未成功'}）` : summary}
        className="relative flex min-h-[44px] w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setOpen((v) => !v)}
      >
        {group.isActive ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-500 motion-reduce:animate-none" />
        ) : open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
          {summary}
          {group.isActive && group.lastEvent ? (
            <span className="ml-1.5 font-normal opacity-90">
              · {group.lastEvent.ok ? '✓' : '✗'} {group.lastEvent.title}
            </span>
          ) : null}
          {sub ? <span className="ml-1.5 font-normal opacity-80">（{sub}）</span> : null}
        </span>
        {group.isActive ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-2.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-muted"
          >
            <span className="block h-full w-full animate-pulse rounded-full bg-gradient-to-r from-transparent via-emerald-500/70 to-transparent motion-reduce:animate-none" />
          </span>
        ) : null}
      </button>

      {open ? (
        <AgentChatItemBody className={cn('space-y-1 border-border/30 px-2 py-2')}>
          {group.messages.map((msg) =>
            msg.role === 'tool' ? (
              <WorkLogToolRow key={msg.id} message={msg} />
            ) : (
              <AgentMessageBubble
                key={msg.id}
                message={msg}
                onChapterPlanSelect={onChapterPlanSelect}
              />
            ),
          )}
        </AgentChatItemBody>
      ) : null}
    </AgentChatItem>
  )
}
