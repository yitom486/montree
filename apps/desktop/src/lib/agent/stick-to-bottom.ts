export function resolveScrollViewport(
  contentEl: HTMLElement | null | undefined,
): HTMLElement | null {
  if (!contentEl) return null
  // assistant-ui ThreadPrimitive.Viewport 结构优先
  const threadViewport = contentEl.closest('[data-assistant-ui-thread-viewport]')
  if (threadViewport instanceof HTMLElement) return threadViewport
  // 向上找到最近的纵向滚动祖先
  let ancestor = contentEl.parentElement
  while (ancestor) {
    const style = getComputedStyle(ancestor)
    if (/(auto|scroll)/.test(style.overflowY)) return ancestor
    ancestor = ancestor.parentElement
  }
  // 无排版环境（happy-dom 单测）回落到直接父级
  const parent = contentEl.parentElement
  return parent instanceof HTMLElement ? parent : null
}

/** 历史分页：初次只看末尾，向上滚动 5 条 5 条向前补。 */
export const CHAT_HISTORY_INITIAL_COUNT = 5
export const CHAT_HISTORY_PAGE_STEP = 5

/**
 * 聊天可见窗口切片（纯函数）。
 * - start 为 null：贴底锚定，取末尾 count 条（新消息自然进入视野）；
 * - start 为数字：冻结窗口 [start, start+count)，新消息到来不移位（供未贴底时保持位置）。
 * 越界钳制；总量不足返回全部。
 */
export function sliceChatWindow<T>(messages: T[], start: number | null, count: number): T[] {
  if (messages.length <= count || start === null) return messages.slice(-count)
  const clamped = Math.max(0, Math.min(start, messages.length - 1))
  return messages.slice(clamped, clamped + count)
}
