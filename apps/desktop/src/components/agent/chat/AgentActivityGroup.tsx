import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import {
  AgentChatItem,
  AgentChatItemBody,
  useAgentChatOpen,
} from '@/components/agent/chat/AgentChatItem'
import { AgentMessageBubble } from '@/components/agent/chat/AgentMessageBubble'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { formatDuration } from '@/stores/acp-chat-types'
import { useAcpPendingPermission } from '@/stores/acp-ui-store'
import { isProposalPromotedToAgent } from '@/lib/agent/promote-mark-proposals'
import { isChapterPlanPromotedToAgent } from '@/lib/agent/promote-chapter-mark-plans'
import type { ChapterMarkPlanSelectPayload } from '@/components/agent/propose/ChapterMarkPlanCard'

interface AgentActivityGroupProps {
  messages: AcpChatMessage[]
  /** 用于进行中实时刷新时长 */
  nowMs?: number
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
}

export function AgentActivityGroup({ messages, nowMs, onChapterPlanSelect }: AgentActivityGroupProps) {
  const pendingPermission = useAcpPendingPermission()
  const awaitingPermission = messages.some(
    (m) =>
      m.role === 'tool' &&
      pendingPermission?.toolCallId &&
      m.toolCallId === pendingPermission.toolCallId,
  )
  const active = messages.some((m) => m.streaming) || awaitingPermission
  const [open, setOpen] = useAgentChatOpen(active)

  const startedAt = messages[0]?.createdAt ?? Date.now()
  const endedAt = useMemo(() => {
    if (active) return nowMs ?? Date.now()
    return Math.max(
      startedAt,
      ...messages.map((m) => m.updatedAt ?? m.createdAt),
    )
  }, [active, messages, nowMs, startedAt])

  const durationLabel = formatDuration(Math.max(0, endedAt - startedAt))
  const stepCount = messages.length
  const toolCount = messages.filter((m) => m.role === 'tool').length
  const thoughtCount = messages.filter((m) => m.role === 'thought').length
  const planCount = messages.filter((m) => m.role === 'plan').length

  const summary = active
    ? awaitingPermission
      ? `等待批准 · ${durationLabel}`
      : `工作中 · ${durationLabel}`
    : `工作了 ${durationLabel} · ${stepCount} 步`

  const sub =
    !active && (toolCount > 0 || thoughtCount > 0 || planCount > 0)
      ? [
          thoughtCount > 0 ? `思考 ${thoughtCount}` : null,
          planCount > 0 ? `计划 ${planCount}` : null,
          toolCount > 0 ? `工具 ${toolCount}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  const groupId = messages.map((m) => m.id).join('+')

  return (
    <AgentChatItem
      variant="card"
      tone={active ? 'activity-active' : 'activity'}
      streaming={active}
      probe="activity"
      messageId={groupId}
      role="activity"
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {active ? (
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

export type AgentTimelineItem =
  | { type: 'single'; message: AcpChatMessage }
  | { type: 'activity'; messages: AcpChatMessage[] }

/**
 * 判断是否是包含可视化富卡片的 tool 消息（图表/互引/全文审查/章节建议等）。
 * 这类组件具备高交互价值与精美视觉，不应被折叠进后台活动盒（ActivityGroup），
 * 而应提升（Promote）到聊天主流中直接向用户展示。
 */
export function isRichToolMessage(msg: AcpChatMessage): boolean {
  if (msg.role !== 'tool') return false
  const title = msg.toolTitle || ''
  const detail = msg.toolContentText || msg.text || ''

  // 1. 图表推演卡片（Mermaid / 流程推演）
  if (title.includes('montree_generate_diagram') || detail.includes('mermaidCode')) {
    return true
  }
  // 2. 跨章互引卡片
  if (title.includes('montree_cross_reference') || detail.includes('chapterDistribution')) {
    return true
  }
  // 3. 全文审查卡片
  if (title.includes('montree_inspect_content') || detail.includes('"hits"')) {
    return true
  }
  // 4. 章节建议卡片
  if (title.includes('montree_suggest_chapters') || detail.includes('"chapters"')) {
    return true
  }

  return false
}

/** 将连续 thought/tool 收成活动组，对齐 Cursor「Worked for」 */
export function groupAgentMessages(messages: AcpChatMessage[]): AgentTimelineItem[] {
  const items: AgentTimelineItem[] = []
  let buffer: AcpChatMessage[] = []

  const flush = () => {
    if (buffer.length === 0) return
    items.push({ type: 'activity', messages: buffer })
    buffer = []
  }

  for (const msg of messages) {
    if (msg.role === 'thought' || msg.role === 'tool' || msg.role === 'plan') {
      if (
        msg.role === 'tool' &&
        msg.markProposal &&
        !isProposalPromotedToAgent(messages, msg.markProposal.id)
      ) {
        flush()
        items.push({ type: 'single', message: msg })
        continue
      }
      if (
        msg.role === 'tool' &&
        msg.markProposal &&
        isProposalPromotedToAgent(messages, msg.markProposal.id)
      ) {
        continue
      }
      if (msg.role === 'tool' && msg.markProposals?.length) {
        const hide = msg.markProposals.every((row) =>
          isProposalPromotedToAgent(messages, row.proposal.id),
        )
        if (!hide) {
          flush()
          items.push({ type: 'single', message: msg })
        }
        continue
      }
      if (msg.role === 'tool' && msg.chapterMarkPlan?.length) {
        const hide = msg.chapterMarkPlan.every((row) =>
          isChapterPlanPromotedToAgent(messages, row.id),
        )
        if (!hide) {
          flush()
          items.push({ type: 'single', message: msg })
        }
        continue
      }
      // 富交互卡片（思维导图、架构推演图、实体互引等）提升至主时间线
      if (isRichToolMessage(msg)) {
        flush()
        items.push({ type: 'single', message: msg })
        continue
      }
      buffer.push(msg)
      continue
    }
    flush()
    items.push({ type: 'single', message: msg })
  }
  flush()
  return items
}
