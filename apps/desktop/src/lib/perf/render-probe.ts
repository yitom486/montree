/**
 * 渲染计数探针：组件每次 render 递增 `window.__montreeRenderCounts[id]`。
 * 开销为一次对象写入；E2E 用它断言切换文档时聊天面板等外壳区域零重渲染。
 */
declare global {
  interface Window { __montreeRenderCounts?: Record<string, number> }
}

export function useRenderProbe(id: string): void {
  if (typeof window === 'undefined') return
  const counts = (window.__montreeRenderCounts ??= {})
  counts[id] = (counts[id] ?? 0) + 1
}
