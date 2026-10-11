export function resolveScrollViewport(
  contentEl: HTMLElement | null | undefined,
): HTMLElement | null {
  if (!contentEl) return null
  // 旧 Radix 结构：最近的命名 viewport。
  const legacy = contentEl.closest('[data-slot=scroll-area-viewport]')
  if (legacy instanceof HTMLElement) return legacy
  // 社区 Conversation 结构：向上找到最近的纵向滚动祖先
  //（StickToBottom 内容区经 scrollClassName 得 overflow-y-auto）。
  let ancestor = contentEl.parentElement
  while (ancestor) {
    const style = getComputedStyle(ancestor)
    if (/(auto|scroll)/.test(style.overflowY)) return ancestor
    ancestor = ancestor.parentElement
  }
  // 无排版环境（happy-dom 单测手动给几何量）回落到直接父级，保持旧语义。
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
