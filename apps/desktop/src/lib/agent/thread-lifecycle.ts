/**
 * 对话线程生命周期事件（取消 / 清空 / 删除），供编辑器修改建议层撤回该线程的未处理建议。
 * 独立小模块，避免 store 直接依赖编辑器实现。
 */
export type ThreadLifecycleEvent = { kind: 'cancel' | 'clear' | 'delete'; threadId: string }
const listeners = new Set<(event: ThreadLifecycleEvent) => void>()
export function onThreadLifecycle(listener: (event: ThreadLifecycleEvent) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function emitThreadLifecycle(event: ThreadLifecycleEvent): void {
  for (const listener of listeners) {
    try { listener(event) } catch (error) { console.warn('[thread-lifecycle] listener failed', error) }
  }
}
