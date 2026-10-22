import { useAcpUiStore } from '@/stores/acp-ui-store'
import type { ProposalOrigin } from '@/lib/editor/ai-proposals/proposal-types'

const OPEN_STATUSES = new Set(['pending', 'in_progress', undefined, ''])

/**
 * 主进程把 MCP `_meta` 里的 ACP toolCallId 放在此内部参数中（见 montree-mcp-server `withAcpToolCallId`）。
 * 取出并从参数中删除，避免进入文档工具的参数校验。
 */
export function takeAcpToolCallId(values: Record<string, unknown>): string | null {
  const value = values.__acpToolCallId
  delete values.__acpToolCallId
  return typeof value === 'string' && value ? value : null
}

/**
 * 把 MCP 编辑工具调用关联到当前窗口的活动线程与 ACP toolCallId。
 * Agent 在 MCP 请求 `_meta` 里带了 toolCallId 时按它精确关联；
 * 否则退回启发式：活动线程里最近一条仍在进行、标题匹配该工具的 tool 消息；
 * 找不到时 toolCallId 为空（不影响安全性）。
 */
export function currentProposalOrigin(toolName: string, explicitToolCallId: string | null = null): ProposalOrigin {
  const state = useAcpUiStore.getState()
  const thread = state.threads.find((item) => item.id === state.activeThreadId)
  if (explicitToolCallId) return { threadId: thread?.id ?? null, toolCallId: explicitToolCallId }
  const message = thread ? [...thread.messages].reverse().find((item) =>
    item.role === 'tool' && typeof item.toolTitle === 'string' && item.toolTitle.includes(toolName) &&
    OPEN_STATUSES.has(item.toolStatus as string | undefined)) : undefined
  return { threadId: thread?.id ?? null, toolCallId: message?.toolCallId ?? null }
}
