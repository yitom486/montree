import { parsePresentResult, type MontreePresentResult } from '@montree/contracts'
import type { ChatMessage } from './chat-message'

/** 工具标识可带 MCP 命名空间；文件路径与 schema 文件不是工具调用。 */
export function isPresentToolTitle(title?: string): boolean {
  return /(?:^|[.:]|__)montree_present$/i.test(title?.trim() ?? '')
}

export function presentRecoveryToolCallIds(messages: ChatMessage[]): string[] {
  return messages.filter(m => m.role === 'tool' && m.toolStatus === 'completed' && !m.presentResult && m.toolCallId &&
    (!m.toolContentText || m.toolContentText === m.toolTitle || m.toolContentText.includes('The output was large and was saved to:'))
  ).map(m => m.toolCallId!).slice(-20)
}

/** 只补当前线程已有的成功工具消息；不新增消息，不替换已验证结果。 */
export function recoverPresentToolMessages(messages: ChatMessage[], outputs: Array<{toolCallId: string; text: string}>): ChatMessage[] {
  const byId = new Map(outputs.map(row => [row.toolCallId, row.text]))
  return messages.map(message => {
    const text = message.toolCallId ? byId.get(message.toolCallId) : undefined
    if (!text || message.role !== 'tool' || message.toolStatus !== 'completed' || message.presentResult) return message
    const result = parsePresentResult(text)
    return result ? {...message, text, toolContentText: text, presentResult: result, streaming: false} : message
  })
}

/**
 * `montree_present` 结果 enrich：工具文本 JSON → `presentResult` 挂载。
 * 与提议/章计划 enrich 同形：流式未完成且回合未收尾时跳过；
 * 解析失败保持原样（展示层给可读失败，不吞消息）。
 */
export function enrichToolMessageWithPresentResult(
  message: ChatMessage,
  isActiveStatus: (status: string | undefined) => boolean,
): ChatMessage {
  if (message.role !== 'tool' || message.presentResult) return message
  if (message.streaming || isActiveStatus(message.toolStatus)) {
    if (message.turnEnded !== true) return message
  }
  const text = message.toolContentText || message.text
  if (!text || (!text.includes('chapter-comparison') && !text.includes('html-artifact') && !text.includes('component-ui') && !text.includes('react-artifact'))) {
    return message
  }
  let parsed: MontreePresentResult | null = null
  try {
    parsed = parsePresentResult(text)
  } catch {
    return message
  }
  if (!parsed) return message
  return { ...message, presentResult: parsed }
}
