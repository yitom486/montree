/**
 * 长会话渲染提醒节流：静态 Skill 只在会话开场发一次，长会话经上下文压缩
 * 会丢失渲染习惯（调卡片工具 vs 手写 React/裸 HTML）。每隔 N 轮重贴一次
 * 速览（`MONTREE_RENDER_HINT_REFRESH`），与 turn-context 相互独立。
 *
 * 仅内存计数（Map 按线程），切换/删除线程后自然失效；形态照抄
 * `should-attach-turn-context`（纯决策函数 + take/reset）。
 */

/** 未换线程时，每隔多少轮重贴一次渲染速览 */
export const RENDER_HINT_REFRESH_INTERVAL = 10

export function nextRenderHintCount(
  turnsSinceRefresh: number,
  interval = RENDER_HINT_REFRESH_INTERVAL,
): { attach: boolean; next: number } {
  const next = turnsSinceRefresh + 1
  if (next >= interval) return { attach: true, next: 0 }
  return { attach: false, next }
}

/** 按对话线程保存计数：仅内存，切换/删除线程后自然失效 */
const refreshCountByThread = new Map<string, number>()

export function shouldRefreshRenderHint(threadId: string): boolean {
  const { attach, next } = nextRenderHintCount(refreshCountByThread.get(threadId) ?? 0)
  refreshCountByThread.set(threadId, next)
  return attach
}

export function resetRenderHintRefresh(threadId?: string): void {
  if (threadId) {
    refreshCountByThread.delete(threadId)
    return
  }
  refreshCountByThread.clear()
}
