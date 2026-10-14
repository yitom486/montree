import { useEffect, useRef, useState } from 'react'
import { BeuiAgentActivity, BeuiActivityRow } from './BeuiAgentActivity'
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
  running?: boolean
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  onEditMessage?: (text: string) => void
}

/** 轻量工具行：标题+目标+状态，一行；按需展开单个调用的完整详情。 */
function WorkLogToolRow({ message }: { message: AcpChatMessage }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [message.id])
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
    <BeuiActivityRow label={display.title} target={display.targetSummary}
      stateLabel={{ 'in-progress': '执行中', pending: '待执行', completed: '已完成', failed: '失败', cancelled: '已取消', unknown: '未知', 'awaiting-approval': '等待批准' }[display.state]}
      icon={<ToolStateIcon state={aiState} />} meta={display.durationMs != null ? formatDuration(display.durationMs) : undefined}
      open={open} onToggle={() => setOpen(value => !value)} failure={display.errorHeadline}>
      <AgentToolCallCard message={message} bare detailsOnly />
    </BeuiActivityRow>
  )
}

/**
 * 工作记录：运行中展示思考与最新普通工具；回合落定自动收起一次。
 * 用户选择跨 chunk 保留，落定后可手动查看历史（回合 key 稳定）。
 * 摘要只说真实操作与状态计数；无可信时间省略历时，不估算耗时。
 */
export function AgentActivityGroup({ group, running, onChapterPlanSelect, onEditMessage }: AgentActivityGroupProps) {
  const isRunning = running ?? group.isActive
  const liveThought = group.messages.some(message => message.role === 'thought' && message.streaming)
  const latestTool = group.messages.findLast(message => message.role === 'tool')
  const [open, setOpen] = useState(liveThought)
  const userToggled = useRef(false)
  useEffect(() => {
    if ((liveThought || (isRunning && latestTool)) && !userToggled.current) setOpen(true)
  }, [liveThought, isRunning, latestTool?.id])
  const wasRunning = useRef(isRunning)
  useEffect(() => {
    if (wasRunning.current && !isRunning) setOpen(false)
    wasRunning.current = isRunning
  }, [isRunning])
  // 固定思考区在前；运行中只展示最新普通调用，完整历史由完成后的工作记录保留。
  const thoughts = group.messages.filter(message => message.role !== 'tool')
  const tools = isRunning ? (latestTool ? [latestTool] : []) : group.messages.filter(message => message.role === 'tool')

  const doneCount =
    group.completedCount + group.failedCount + group.cancelledCount
  const summary = isRunning
    ? group.hasAwaitingApproval
      ? `等待批准${group.hasTrustedTime ? ` · 历时 ${group.durationLabel}` : ''}`
      : `${liveThought && group.toolCallCount === 0 ? '思考中' : '工作中'}${group.toolCallCount > 0 ? ` · ${doneCount}/${group.toolCallCount}` : ''}${group.hasTrustedTime ? ` · 历时 ${group.durationLabel}` : ''}`
    : `${group.toolCallCount === 0 && group.thoughtCount > 0 ? '已思考' : `工作记录 · 工具调用 ${group.toolCallCount}`}${group.hasTrustedTime ? ` · 历时 ${group.durationLabel}` : ''}`

  const sub = [
    group.thoughtCount > 0 && group.toolCallCount > 0 ? `思考 ${group.thoughtCount}` : null,
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
      tone={isRunning ? 'activity-active' : 'activity'}
      streaming={isRunning}
      probe="activity"
      messageId={group.key}
      role="activity"
      className={isRunning ? 'agent-beam-ring agent-beam-ring-amber' : undefined}
    >
      <BeuiAgentActivity heading={summary}
        description={sub}
        status={group.hasAwaitingApproval ? 'approval' : isRunning ? 'working' : group.hasFailure ? 'failed' : group.unknownCount ? 'unknown' : group.cancelledCount ? 'cancelled' : 'complete'}
        open={open} onToggle={() => { userToggled.current = true; setOpen(value => !value) }}>
        <AgentChatItemBody className={cn('space-y-1 border-border/30 px-2 py-2')}>
          {[...thoughts, ...tools].map((msg) =>
            msg.role === 'tool' ? (
              <WorkLogToolRow key={isRunning ? 'latest-tool' : msg.id} message={msg} />
            ) : (
              <AgentMessageBubble
                key={msg.id}
                message={msg}
                onChapterPlanSelect={onChapterPlanSelect}
                onEditMessage={onEditMessage}
              />
            ),
          )}
        </AgentChatItemBody>
      </BeuiAgentActivity>
    </AgentChatItem>
  )
}
