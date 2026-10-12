export type ThemeTransitionTarget = 'light' | 'dark' | 'sepia'

/**
 * 驱动 View Transitions 原生主题平滑过渡：
 * 1. 切换瞬间为 root 加上 .theme-transitioning，屏蔽所有局部元素各自的 transition；
 * 2. 由浏览器分别捕获旧状态和新状态的 GPU 贴图快照，在合成器线程统一做交叉淡化（180ms）；
 * 3. 动画完成后，延迟两帧（double requestAnimationFrame）再卸载屏蔽类，消除次生动效。
 */
export function applyThemeWithViewTransition(
  nextTheme: ThemeTransitionTarget,
  applyFn: () => void,
): void {
  if (typeof document === 'undefined') {
    applyFn()
    return
  }

  const root = document.documentElement
  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const hasStartViewTransition =
    typeof document.startViewTransition === 'function'

  if (!hasStartViewTransition || prefersReduced) {
    applyFn()
    root.classList.remove('light', 'sepia', 'dark')
    root.classList.add(nextTheme)
    return
  }

  root.classList.add('theme-transitioning')

  try {
    const transition = document.startViewTransition(() => {
      applyFn()
      root.classList.remove('light', 'sepia', 'dark')
      root.classList.add(nextTheme)
    })

    transition.finished
      .catch(() => {
        // 如果连续切换被打断，捕获被中止的 Promise 异常
      })
      .finally(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            root.classList.remove('theme-transitioning')
          })
        })
      })
  } catch {
    // 降级兜底
    applyFn()
    root.classList.remove('light', 'sepia', 'dark')
    root.classList.add(nextTheme)
    root.classList.remove('theme-transitioning')
  }
}
