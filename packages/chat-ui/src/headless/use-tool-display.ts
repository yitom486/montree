import { useMemo } from 'react'
import { toToolDisplayModel } from '@montree/chat-core'
import type { ChatMessage, ToolDisplayModel } from '@montree/chat-core'

/**
 * 工具展示模型无头 hook（M2）：纯 `useMemo` 包裹 core 的 `toToolDisplayModel`。
 * 只读单条 `ChatMessage`，不读 store、不碰 ACP。
 */
export function useToolDisplay(
  message: ChatMessage,
  opts?: { needsApproval?: boolean },
): ToolDisplayModel {
  const needsApproval = opts?.needsApproval
  return useMemo(
    () => toToolDisplayModel(message, { needsApproval }),
    [message, needsApproval],
  )
}
