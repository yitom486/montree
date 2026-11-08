import { useAcpUiStore } from '@/stores/acp-ui-store'

export { SELECTION_CHAT_MARKER, appendSelectionChatMarker } from './selection-chat-marker'

/** 只读阅读器划选后：Agent 面板已打开时才聚焦输入框（Markdown 等勿调用） */
export function focusAgentComposerOnReaderSelection(): void {
  useAcpUiStore.getState().requestComposerFocus()
}

/**
 * 选区工具栏「带着选区问 Agent」：开面板、插入短标记，不贴选区正文。
 * sticky 仍保留，发送时冻结为本轮快照，工具读取真实选区。
 */
export function addSelectionMarkerToComposer(): void {
  useAcpUiStore.getState().insertComposerSelectionMarker()
}
