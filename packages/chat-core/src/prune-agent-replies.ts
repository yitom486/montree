import type { ChatMessage } from './chat-message'

/**
 * 回合结束后压缩 Agent 正文气泡：自最近一条用户消息起，
 * 只保留最后一条非空 agent 回复；thought/tool/plan 保留（会并入「工作了」折叠组）。
 * 对齐 Cursor 等：过程步骤折叠，终局答复单独展示。
 */
export function pruneIntermediateAgentReplies(
  messages: ChatMessage[],
): ChatMessage[] {
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIdx = i
      break
    }
  }
  const turnStart = lastUserIdx + 1

  const agentIdsInTurn: string[] = []
  for (let i = turnStart; i < messages.length; i++) {
    const m = messages[i]!
    if (m.role !== 'agent') continue
    if (!m.text.trim()) continue
    agentIdsInTurn.push(m.id)
  }

  const keepAgentId =
    agentIdsInTurn.length > 0 ? agentIdsInTurn[agentIdsInTurn.length - 1] : null

  return messages.filter((m, index) => {
    if (index < turnStart) return true
    if (m.role !== 'agent') return true
    if (!m.text.trim()) return false
    return keepAgentId != null && m.id === keepAgentId
  })
}
