import type { ChapterMarkPlanEntry } from '@montree/annotations'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

export function isChapterPlanPromotedToAgent(
  messages: AcpChatMessage[],
  entryId: string,
): boolean {
  return messages.some(
    (message) =>
      message.role === 'agent' &&
      message.chapterMarkPlan?.some((row) => row.id === entryId),
  )
}

function mergeChapterPlans(
  existing: ChapterMarkPlanEntry[] | undefined,
  incoming: ChapterMarkPlanEntry[],
): ChapterMarkPlanEntry[] {
  const merged = [...(existing ?? [])]
  for (const item of incoming) {
    if (merged.some((row) => row.id === item.id)) continue
    merged.push(item)
  }
  return merged
}

function collectToolChapterPlans(messages: AcpChatMessage[]): ChapterMarkPlanEntry[] {
  const rows: ChapterMarkPlanEntry[] = []
  for (const message of messages) {
    if (message.role !== 'tool' || !message.chapterMarkPlan?.length) continue
    for (const entry of message.chapterMarkPlan) {
      if (entry.status === 'dismissed') continue
      rows.push(entry)
    }
  }
  return rows
}

/** 回合结束时：把章级建议挂到最近一条 Agent 回复下方。 */
export function promoteChapterMarkPlansToLastAgent(
  messages: AcpChatMessage[],
): AcpChatMessage[] {
  const incoming = collectToolChapterPlans(messages)
  if (incoming.length === 0) return messages

  let lastAgentIdx = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!
    if (message.role === 'agent' && !message.streaming && message.text.trim()) {
      lastAgentIdx = i
      break
    }
  }
  if (lastAgentIdx < 0) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'agent' && !messages[i]?.streaming) {
        lastAgentIdx = i
        break
      }
    }
  }
  if (lastAgentIdx < 0) return messages

  return messages.map((message, idx) =>
    idx === lastAgentIdx
      ? { ...message, chapterMarkPlan: mergeChapterPlans(message.chapterMarkPlan, incoming) }
      : message,
  )
}

export function resolveChapterMarkPlanOnMessages(
  messages: AcpChatMessage[],
  entryId: string,
  status: ChapterMarkPlanEntry['status'],
): AcpChatMessage[] {
  return messages.map((message) => {
    let next = message
    if (message.chapterMarkPlan?.some((row) => row.id === entryId)) {
      next = {
        ...next,
        chapterMarkPlan: message.chapterMarkPlan.map((row) =>
          row.id === entryId ? { ...row, status } : row,
        ),
      }
    }
    if (
      message.role === 'tool' &&
      message.chapterMarkPlan?.some((row) => row.id === entryId)
    ) {
      next = {
        ...next,
        chapterMarkPlan: message.chapterMarkPlan!.map((row) =>
          row.id === entryId ? { ...row, status } : row,
        ),
      }
    }
    return next
  })
}

/** 用户选定一章：标记 selected，其余 pending 项 dismiss。 */
export function selectChapterMarkPlanOnMessages(
  messages: AcpChatMessage[],
  entryId: string,
): AcpChatMessage[] {
  return messages.map((message) => {
    if (!message.chapterMarkPlan?.length) return message
    return {
      ...message,
      chapterMarkPlan: message.chapterMarkPlan.map((row) => {
        if (row.id === entryId) return { ...row, status: 'selected' as const }
        if (row.status === 'pending') return { ...row, status: 'dismissed' as const }
        return row
      }),
    }
  })
}
