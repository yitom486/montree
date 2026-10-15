import { parsePresentResult, type MontreePresentResult } from '@montree/contracts'
import type { AcpChatMessage } from '@/stores/acp-chat-types'

/** 工具标识可带 MCP 命名空间；文件路径与 schema 文件不是工具调用。 */
export function isPresentToolTitle(title?: string): boolean {
  return /(?:^|[.:]|__)montree_present$/i.test(title?.trim() ?? '')
}

/**
 * `montree_present` 结果 enrich：工具文本 JSON → `presentResult` 挂载。
 * 与提议/章计划 enrich 同形：流式未完成且回合未收尾时跳过；
 * 解析失败保持原样（展示层给可读失败，不吞消息）。
 */
export function enrichToolMessageWithPresentResult(
  message: AcpChatMessage,
  isActiveStatus: (status: string | undefined) => boolean,
): AcpChatMessage {
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
