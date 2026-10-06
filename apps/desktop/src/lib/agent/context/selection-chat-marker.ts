/** 选区工具栏「加入对话」写入输入框的短标记；正文仍走 sticky / montree_get_selection */
export const SELECTION_CHAT_MARKER = '「选区」'

export function appendSelectionChatMarker(draft: string): string {
  if (draft.includes(SELECTION_CHAT_MARKER)) return draft
  if (!draft.trim()) return SELECTION_CHAT_MARKER
  return /\s$/.test(draft)
    ? `${draft}${SELECTION_CHAT_MARKER}`
    : `${draft} ${SELECTION_CHAT_MARKER}`
}
