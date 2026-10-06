/**
 * 卡片轨跟随通道（统一方案）。
 *
 * 规则（见 `.plan/marginalia-text-linkage`）：
 * - 离散位置（章节键）走 zustand（`reader-navigation-store` + 各阅读器透传的
 *   `currentChapterKey`），变更才重渲染；
 * - 连续进度（书级分数 0~1）走本事件通道，直达卡片轨 DOM，不经过 React state，
 *   滚动过程零重渲染。各阅读器（EPUB iframe 滚动 / PDF 翻页 / WebDoc）统一调
 *   `emitRailFollow` 上报，卡片轨统一订阅跟随——而不是各格式自搞一套。
 */

export const RAIL_FOLLOW_EVENT = 'montree:rail-follow'

export function emitRailFollow(fraction: number): void {
  if (!Number.isFinite(fraction)) return
  window.dispatchEvent(new CustomEvent<number>(RAIL_FOLLOW_EVENT, { detail: fraction }))
}

export function subscribeRailFollow(handler: (fraction: number) => void): () => void {
  const onFollow = (e: Event) => {
    const f = (e as CustomEvent<number>).detail
    if (typeof f === 'number' && Number.isFinite(f)) handler(f)
  }
  window.addEventListener(RAIL_FOLLOW_EVENT, onFollow)
  return () => window.removeEventListener(RAIL_FOLLOW_EVENT, onFollow)
}

/**
 * 反向联动：点正文标记 → 卡片轨滚动到对应卡并闪现。
 * 与跟随通道一样走 window 事件，不经过 React state。
 */
export const RAIL_FOCUS_EVENT = 'montree:rail-focus'

export function emitRailFocus(markId: string): void {
  if (!markId) return
  window.dispatchEvent(new CustomEvent<string>(RAIL_FOCUS_EVENT, { detail: markId }))
}

export function subscribeRailFocus(handler: (markId: string) => void): () => void {
  const onFocus = (e: Event) => {
    const id = (e as CustomEvent<string>).detail
    if (typeof id === 'string' && id) handler(id)
  }
  window.addEventListener(RAIL_FOCUS_EVENT, onFocus)
  return () => window.removeEventListener(RAIL_FOCUS_EVENT, onFocus)
}
