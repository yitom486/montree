import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { formatDuration, toToolDisplayModel, type ChatMessage, type ChatTimelineItem } from '@montree/chat-core'
import { AgentChatItem, AgentChatItemBody } from './AgentChatItem'
import { BeuiAgentActivity, BeuiActivityRow } from './BeuiAgentActivity'
import { ChatMessageBubble } from './agent-message-bubble'
import { AgentToolCallCard } from './agent-tool-call-card'
import { ToolStateIcon } from './tool-shell'

export type ChatWorkLogItem = Extract<ChatTimelineItem, { kind: 'work-log' }>

type ActivityContextProps = Pick<ComponentProps<typeof ChatMessageBubble>,
  | 'resolveMarkProposal'
  | 'pendingPermission'
  | 'theme'
  | 'navFlatIndex'
  | 'onPermissionRespond'
  | 'onDismissProposedMark'
  | 'onRecoverChapter'
  | 'onPromptSelectText'
  | 'onChapterPlanSelect'
  | 'onEditMessage'
  | 'threadId'
  | 'prompting'
  | 'onGenerativeSubmit'
  | 'renderBusinessResult'
  | 'renderPlanCard'
>

export interface ChatActivityGroupProps extends ActivityContextProps {
  group: ChatWorkLogItem
  running?: boolean
}

/** 轻量工具行：摘要保持可见，单次展开直接展示详情；新工具复用行但重置详情。 */
function WorkLogToolRow({ message, ...context }: { message: ChatMessage } & ActivityContextProps) {
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
      <AgentToolCallCard
        message={message}
        bare
        detailsOnly
        pending={context.pendingPermission}
        onRespond={context.onPermissionRespond}
        onRecoverChapter={context.onRecoverChapter}
        onPromptSelectText={context.onPromptSelectText}
        navFlatIndex={context.navFlatIndex}
        businessResultSlot={context.renderBusinessResult?.(message, {
          threadId: context.threadId,
          prompting: context.prompting,
          onGenerativeSubmit: context.onGenerativeSubmit,
        })}
      />
    </BeuiActivityRow>
  )
}

/**
 * 工作记录的展开、进度与工具行统一实现；业务状态和操作全部由调用方传入。
 * 手动选择跨 chunk 保留，运行转落定时自动收起一次，之后可展开完整历史。
 */
export function ChatActivityGroup({ group, running, ...context }: ChatActivityGroupProps) {
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
  const thoughts = group.messages.filter(message => message.role !== 'tool')
  const tools = isRunning ? (latestTool ? [latestTool] : []) : group.messages.filter(message => message.role === 'tool')

  const doneCount = group.completedCount + group.failedCount + group.cancelledCount
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
  ].filter(Boolean).join(' · ')

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
        <AgentChatItemBody className="space-y-1 border-border/30 px-2 py-2">
          {[...thoughts, ...tools].map((message) =>
            message.role === 'tool' ? (
              <WorkLogToolRow key={isRunning ? 'latest-tool' : message.id} message={message} {...context} />
            ) : (
              <ChatMessageBubble key={message.id} message={message} {...context} />
            ),
          )}
        </AgentChatItemBody>
      </BeuiAgentActivity>
    </AgentChatItem>
  )
}
