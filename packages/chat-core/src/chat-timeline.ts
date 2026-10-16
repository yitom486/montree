import type { ChatMessage } from './chat-message'
import { formatDuration, isToolActiveStatus } from './chat-message'
import { isProposalPromotedToAgent } from './mark-promotion'
import { isChapterPlanPromotedToAgent } from './chapter-mark-plans'
import {
  classifyToolResultKind,
  isPromotedToolResultKind,
  readableToolTitle,
} from './tool-display-model'

/**
 * 聊天时间线纯分组（U1）：按真实 user 回合归属，同一回合的普通调用汇总为
 * 一条工作记录；assistant 文本保留顺序、不拼接；富结果保留自身事件位置。
 *
 * 输入只读，输出只含引用与派生摘要；不改消息顺序、不去重、不合并文本。
 * key 稳定：单条用消息 id；工作记录用“作用域+回合”归属（尾部追加/切分页
 * 不改变 key，不 remount；用户展开选择跨 chunk/落定保留）。
 * 纯展示读消息，不 mutate/store 回写。
 */
export type ChatTimelineItem =
  | { kind: 'message'; key: string; message: ChatMessage }
  | {
      kind: 'work-log'
      key: string
      turnKey: string
      /** 可见窗口内的普通过程（顺序保留，只做展示） */
      messages: ChatMessage[]
      /** 整回合普通工具调用数（含窗口外未加载；详情只放可见） */
      toolCallCount: number
      hiddenToolCallCount: number
      /** 已落定（completed）的普通调用数，用于运行进度 done/total */
      completedCount: number
      /** 整回合最后一个落定（completed/failed/cancelled）的普通调用 */
      lastEvent: { title: string; ok: boolean } | null
      thoughtCount: number
      planCount: number
      failedCount: number
      cancelledCount: number
      unknownCount: number
      isActive: boolean
      hasFailure: boolean
      hasAwaitingApproval: boolean
      /** 首条过程有可信 createdAt 才计时；否则省略历时，不估算 */
      hasTrustedTime: boolean
      startedAt: number
      /** 进行中为 null（展示时用 nowMs 换算“历时”） */
      endedAt: number | null
      durationLabel: string
      /** 进行中当前操作标题（只看可见仍在运行的工具）；静止组为 null */
      currentAction: string | null
    }

export interface GroupChatTimelineOptions {
  /** 当前待审批的 toolCallId；命中时该工具提升为单条，审批按钮不被折叠吞掉 */
  pendingToolCallId?: string | null
  nowMs?: number
  /**
   * 可见窗口消息 id 集合；缺省全部可见。
   * 派生先在完整历史进行（回合归属与计数），再适配窗口：窗口外的普通调用
   * 计入 toolCallCount 并注明未加载，不算成可见调用、不渲染。
   */
  visibleIds?: Set<string> | null
  /** 回合 key 作用域（线程 id）：切线程不串状态；缺省 'default' */
  scopeKey?: string
}

/** 富业务卡片提升判定（原 isRichToolMessage 语义，改走统一分类）。 */
export function isRichToolMessage(msg: ChatMessage): boolean {
  return (
    msg.role === 'tool' && isPromotedToolResultKind(classifyToolResultKind(msg))
  )
}

function isActivityRole(msg: ChatMessage): boolean {
  return msg.role === 'thought' || msg.role === 'tool' || msg.role === 'plan'
}

interface TurnSlice {
  key: string
  /** 整回合消息（含窗口外，用于归属与计数） */
  all: ChatMessage[]
}

/** 按真实 user 边界切回合；user 之前的历史前缀自成独立片段，不跨边界合并。 */
function splitTurns(messages: ChatMessage[], scopeKey: string): TurnSlice[] {
  const turns: TurnSlice[] = []
  let current: ChatMessage[] | null = null
  let currentKey = ''
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (current && current.length > 0) turns.push({ key: currentKey, all: current })
      currentKey = `turn:${scopeKey}:${msg.id}`
      current = [msg]
      continue
    }
    if (!current) {
      currentKey = `prefix:${scopeKey}`
      current = []
    }
    current.push(msg)
  }
  if (current && current.length > 0) turns.push({ key: currentKey, all: current })
  return turns
}

/**
 * 单条提升判定（与旧逻辑同语义，只是不再按连续段切分）：
 * 待审批/失败/未去重提议/富结果各自独立为主时间线单条；已去重提议直接跳过。
 */
function classifySingle(
  msg: ChatMessage,
  allMessages: ChatMessage[],
  pendingToolCallId: string | null,
): boolean {
  if (!isActivityRole(msg)) return true
  if (
    msg.role === 'tool' &&
    pendingToolCallId != null &&
    msg.toolCallId === pendingToolCallId
  ) {
    return true
  }
  if (msg.role === 'tool' && msg.toolStatus === 'failed') return true
  if (msg.role === 'tool' && msg.markProposal) {
    return !isProposalPromotedToAgent(allMessages, msg.markProposal.id)
  }
  if (msg.role === 'tool' && msg.markProposals?.length) {
    return !msg.markProposals.every((row) =>
      isProposalPromotedToAgent(allMessages, row.proposal.id),
    )
  }
  if (msg.role === 'tool' && msg.chapterMarkPlan?.length) {
    return !msg.chapterMarkPlan.every((row) =>
      isChapterPlanPromotedToAgent(allMessages, row.id),
    )
  }
  if (isRichToolMessage(msg)) return true
  return false
}

export function groupChatTimeline(
  messages: ChatMessage[],
  opts?: GroupChatTimelineOptions,
): ChatTimelineItem[] {
  const pendingToolCallId = opts?.pendingToolCallId ?? null
  const nowMs = opts?.nowMs ?? Date.now()
  const visibleIds = opts?.visibleIds ?? null
  const scopeKey = opts?.scopeKey ?? 'default'
  const isVisible = (msg: ChatMessage): boolean =>
    visibleIds == null || visibleIds.has(msg.id)

  const items: ChatTimelineItem[] = []

  for (const turn of splitTurns(messages, scopeKey)) {
    // 整回合普通过程（窗口内外都计，保证计数诚实）
    const ordinaryAll = turn.all.filter(
      (m) => isActivityRole(m) && !classifySingle(m, messages, pendingToolCallId),
    )
    const ordinaryVisible = ordinaryAll.filter(isVisible)
    const toolCallCount = ordinaryAll.filter((m) => m.role === 'tool').length
    const visibleToolCount = ordinaryVisible.filter((m) => m.role === 'tool').length
    const completedCount = ordinaryAll.filter(
      (m) => m.role === 'tool' && m.toolStatus === 'completed',
    ).length
    // 最近事件：整回合最后一个落定的普通调用（只报真实终态，不含运行中）
    let lastEvent: { title: string; ok: boolean } | null = null
    for (let i = ordinaryAll.length - 1; i >= 0; i -= 1) {
      const m = ordinaryAll[i]!
      if (m.role !== 'tool') continue
      if (m.toolStatus === 'completed' || m.toolStatus === 'failed' || m.toolStatus === 'cancelled') {
        lastEvent = {
          title: readableToolTitle(m.toolTitle),
          ok: m.toolStatus === 'completed',
        }
        break
      }
    }

    const failedAll = turn.all.filter((m) => m.role === 'tool' && m.toolStatus === 'failed')
    const cancelledCount = turn.all.filter(
      (m) => m.role === 'tool' && m.toolStatus === 'cancelled',
    ).length
    const unknownCount = turn.all.filter(
      (m) => m.role === 'tool' && m.toolStatus !== 'completed' && m.toolStatus !== 'failed' && m.toolStatus !== 'cancelled' && !m.streaming,
    ).length

    const activeAll = ordinaryAll.some((m) => m.streaming)
    const startedAt = ordinaryAll[0]?.createdAt ?? nowMs
    const hasTrustedTime = typeof ordinaryAll[0]?.createdAt === 'number'
    const endedAt = activeAll
      ? null
      : Math.max(startedAt, ...ordinaryAll.map((m) => m.updatedAt ?? m.createdAt ?? startedAt))
    const durationLabel = hasTrustedTime
      ? formatDuration(Math.max(0, (endedAt ?? nowMs) - startedAt))
      : ''

    // 当前操作只看可见仍在运行的工具：已完成的不能描述为当前动作；
    // 多个并行时表达数量，不伪造串行顺序；无运行工具时回退“工作中”。
    const runningVisible = ordinaryVisible.filter(
      (m) => m.role === 'tool' && (m.streaming || isToolActiveStatus(m.toolStatus)),
    )
    const currentAction = activeAll
      ? runningVisible.length === 1
        ? runningVisible[0]!.toolTitle?.trim()
          ? readableToolTitle(runningVisible[0]!.toolTitle)
          : '工作中'
        : runningVisible.length > 1
          ? `${runningVisible.length} 个工具并行执行`
          : '工作中'
      : null

    const bufferedIds = new Set(ordinaryVisible.map((m) => m.id))
    let workLogEmitted = false
    const emitWorkLog = () => {
      workLogEmitted = true
      items.push({
        kind: 'work-log',
        key: `work-log:${turn.key}`,
        turnKey: turn.key,
        messages: ordinaryVisible,
        toolCallCount,
        hiddenToolCallCount: toolCallCount - visibleToolCount,
        completedCount,
        lastEvent,
        thoughtCount: ordinaryAll.filter((m) => m.role === 'thought').length,
        planCount: ordinaryAll.filter((m) => m.role === 'plan').length,
        failedCount: failedAll.length,
        cancelledCount,
        unknownCount,
        isActive: activeAll,
        hasFailure: failedAll.length > 0,
        hasAwaitingApproval:
          pendingToolCallId != null &&
          ordinaryAll.some((m) => m.role === 'tool' && m.toolCallId === pendingToolCallId),
        hasTrustedTime,
        startedAt,
        endedAt,
        durationLabel,
        currentAction,
      })
    }

    // 按回合内原顺序发射：工作记录置于首次过程位置，文本/结果各归其位。
    for (const msg of turn.all) {
      if (!isVisible(msg)) continue
      if (bufferedIds.has(msg.id)) {
        if (!workLogEmitted) emitWorkLog()
        continue
      }
      if (isActivityRole(msg) && !classifySingle(msg, messages, pendingToolCallId)) {
        continue
      }
      items.push({ kind: 'message', key: `msg:${msg.id}`, message: msg })
    }
  }
  return items
}
