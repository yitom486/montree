export type ThemeTransitionTarget = 'light' | 'dark' | 'sepia'

const themeParticipants = new Set<(theme: ThemeTransitionTarget) => Promise<void>>()
let themeRevision = 0

/** 隔离帧参与同一次截图；缺失确认最多等待 160ms，不阻塞主题切换。 */
export function registerThemeParticipant(apply: (theme: ThemeTransitionTarget) => Promise<void>): () => void {
  themeParticipants.add(apply)
  return () => { themeParticipants.delete(apply) }
}

import { notifyArtifactThemeParticipants } from '@montree/chat-ui'

async function syncThemeParticipants(theme: ThemeTransitionTarget): Promise<void> {
  // 包内隔离帧集合（M4 主题回执修复）：与宿主集合同一次过渡、同 160ms 上限；
  // 必须在早退判断之前启动——迁移后帧只注册在包内集合，宿主集为空时不能直接 return
  const packageSync = Promise.resolve().then(() => notifyArtifactThemeParticipants(theme)).catch(() => {})
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      themeParticipants.size
        ? Promise.all([...themeParticipants].map((apply) => Promise.resolve().then(() => apply(theme)).catch(() => {})))
        : Promise.resolve(),
      packageSync,
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 160) }),
    ])
  } finally { clearTimeout(timeout) }
}

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
  const revision = ++themeRevision
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
    void syncThemeParticipants(nextTheme)
    return
  }

  root.classList.add('theme-transitioning')

  try {
    const transition = document.startViewTransition(() => {
      if (revision !== themeRevision) return
      applyFn()
      root.classList.remove('light', 'sepia', 'dark')
      root.classList.add(nextTheme)
      return syncThemeParticipants(nextTheme)
    })

    transition.finished
      .catch(() => {
        // 如果连续切换被打断，捕获被中止的 Promise 异常
      })
      .finally(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (revision === themeRevision) root.classList.remove('theme-transitioning')
          })
        })
      })
  } catch {
    // 降级兜底
    applyFn()
    root.classList.remove('light', 'sepia', 'dark')
    root.classList.add(nextTheme)
    void syncThemeParticipants(nextTheme)
    root.classList.remove('theme-transitioning')
  }
}
