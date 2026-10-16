import { useMemo } from 'react'
import { groupChatTimeline } from '@montree/chat-core'
import type {
  ChatMessage,
  ChatTimelineItem,
  GroupChatTimelineOptions,
} from '@montree/chat-core'

export type UseChatTimelineOptions = GroupChatTimelineOptions

/**
 * 聊天时间线无头 hook（M2）：纯 `useMemo` 包裹 core 的 `groupChatTimeline`。
 * 只吃 `ChatMessage[]` + 分组参数，不读 store、不碰 ACP。
 */
export function useChatTimeline(
  messages: ChatMessage[],
  opts: UseChatTimelineOptions = {},
): ChatTimelineItem[] {
  const { pendingToolCallId, visibleIds, scopeKey, nowMs } = opts
  return useMemo(
    () => groupChatTimeline(messages, { pendingToolCallId, visibleIds, scopeKey, nowMs }),
    [messages, pendingToolCallId, visibleIds, scopeKey, nowMs],
  )
}
