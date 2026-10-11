import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { formatDuration, isToolActiveStatus } from '@/stores/acp-chat-types'
import { isProposalPromotedToAgent } from '@/lib/agent/promote-mark-proposals'
import { isChapterPlanPromotedToAgent } from '@/lib/agent/promote-chapter-mark-plans'
import {
  classifyToolResultKind,
  isPromotedToolResultKind,
  readableToolTitle,
} from '@/lib/agent/tool-display-model'

/**
 * 聊天时间线纯分组（R1）。
 *
 * 输入只读，输出只含引用与派生摘要；不改消息顺序、不去重、不合并。
 * key 稳定：单条用消息 id；工作记录用组内首条 id（尾部追加不改变 key，
 * 流式更新不 remount；历史前补改变首条时才换 key，属可接受的一次性重建）。
 */
export type ChatTimelineItem =
  | { kind: 'message'; key: string; message: AcpChatMessage }
  | {
      kind: 'work-log'
      key: string
      messages: AcpChatMessage[]
      /** 工具调用条数（非消息条数，不冒充步骤数） */
      toolCallCount: number
      isActive: boolean
      hasFailure: boolean
      hasAwaitingApproval: boolean
      startedAt: number
      /** 进行中为 null（展示时用 nowMs 换算“历时”） */
      endedAt: number | null
      durationLabel: string
      /** 进行中当前操作标题；静止组为 null */
      currentAction: string | null
    }

export interface GroupChatTimelineOptions {
  /** 当前待审批的 toolCallId；命中时该工具提升为单条，审批按钮不被折叠吞掉 */
  pendingToolCallId?: string | null
  nowMs?: number
}

/** 富业务卡片提升判定（原 isRichToolMessage 语义，改走统一分类）。 */
export function isRichToolMessage(msg: AcpChatMessage): boolean {
  return (
    msg.role === 'tool' && isPromotedToolResultKind(classifyToolResultKind(msg))
  )
}

function isActivityRole(msg: AcpChatMessage): boolean {
  return msg.role === 'thought' || msg.role === 'tool' || msg.role === 'plan'
}

export function groupChatTimeline(
  messages: AcpChatMessage[],
  opts?: GroupChatTimelineOptions,
): ChatTimelineItem[] {
  const pendingToolCallId = opts?.pendingToolCallId ?? null
  const nowMs = opts?.nowMs ?? Date.now()
  const items: ChatTimelineItem[] = []
  let buffer: AcpChatMessage[] = []

  const flush = () => {
    if (buffer.length === 0) return
    const group = buffer
    buffer = []
    const startedAt = group[0]?.createdAt ?? nowMs
    const isActive = group.some((m) => m.streaming)
    const endedAt = isActive
      ? null
      : Math.max(startedAt, ...group.map((m) => m.updatedAt ?? m.createdAt))
    const toolCallCount = group.filter((m) => m.role === 'tool').length
    const hasFailure = group.some((m) => m.role === 'tool' && m.toolStatus === 'failed')
    const hasAwaitingApproval =
      pendingToolCallId != null &&
      group.some((m) => m.role === 'tool' && m.toolCallId === pendingToolCallId)
    // 当前操作只看仍在运行的工具：已完成的不能描述为当前动作；
    // 多个并行时表达数量，不伪造串行顺序；无运行工具时回退“工作中”。
    const runningTools = group.filter(
      (m) => m.role === 'tool' && (m.streaming || isToolActiveStatus(m.toolStatus)),
    )
    const currentAction = isActive
      ? runningTools.length === 1
        ? runningTools[0]!.toolTitle?.trim()
          ? readableToolTitle(runningTools[0]!.toolTitle)
          : '工作中'
        : runningTools.length > 1
          ? `${runningTools.length} 个工具并行执行`
          : '工作中'
      : null
    items.push({
      kind: 'work-log',
      key: `work-log:${group[0]!.id}`,
      messages: group,
      toolCallCount,
      isActive,
      hasFailure,
      hasAwaitingApproval,
      startedAt,
      endedAt,
      durationLabel: formatDuration(Math.max(0, (endedAt ?? nowMs) - startedAt)),
      currentAction,
    })
  }

  const single = (message: AcpChatMessage) => {
    items.push({ kind: 'message', key: `msg:${message.id}`, message })
  }

  for (const msg of messages) {
    if (isActivityRole(msg)) {
      // 待审批工具：提升为单条，保证审批按钮永远在折叠容器外
      if (
        msg.role === 'tool' &&
        pendingToolCallId != null &&
        msg.toolCallId === pendingToolCallId
      ) {
        flush()
        single(msg)
        continue
      }
      // 失败工具：提升为单条，错误摘要在主时间线可见
      if (msg.role === 'tool' && msg.toolStatus === 'failed') {
        flush()
        single(msg)
        continue
      }
      if (
        msg.role === 'tool' &&
        msg.markProposal &&
        !isProposalPromotedToAgent(messages, msg.markProposal.id)
      ) {
        flush()
        single(msg)
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
          single(msg)
        }
        continue
      }
      if (msg.role === 'tool' && msg.chapterMarkPlan?.length) {
        const hide = msg.chapterMarkPlan.every((row) =>
          isChapterPlanPromotedToAgent(messages, row.id),
        )
        if (!hide) {
          flush()
          single(msg)
        }
        continue
      }
      if (isRichToolMessage(msg)) {
        flush()
        single(msg)
        continue
      }
      buffer.push(msg)
      continue
    }
    flush()
    single(msg)
  }
  flush()
  return items
}
