import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { ProposalOrigin } from '@/lib/editor/ai-proposals/proposal-types'

const OPEN_STATUSES = new Set(['pending', 'in_progress', undefined, ''])

/**
 * 把 MCP 编辑工具调用关联到当前窗口的活动线程与 ACP toolCallId。
 * MCP tools/call 不携带 ACP toolCallId，因此取活动线程里最近一条仍在进行、
 * 标题匹配该工具的 tool 消息；找不到时 toolCallId 为空（不影响安全性）。
 */
export function currentProposalOrigin(toolName: string): ProposalOrigin {
  const state = useAcpUiStore.getState()
  const thread = state.threads.find((item) => item.id === state.activeThreadId)
  const message = thread ? [...thread.messages].reverse().find((item) =>
    item.role === 'tool' && typeof item.toolTitle === 'string' && item.toolTitle.includes(toolName) &&
    OPEN_STATUSES.has(item.toolStatus as string | undefined)) : undefined
  return { threadId: thread?.id ?? null, toolCallId: message?.toolCallId ?? null }
}
