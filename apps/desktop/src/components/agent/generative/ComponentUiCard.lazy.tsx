import { Suspense, lazy } from 'react'
import type { PresentComponentUi } from '@montree/contracts'
import type { GenerativeSubmitPayload } from './ComponentUiCard'

export type { GenerativeSubmitPayload }

const LazyCard = lazy(() =>
  import('./ComponentUiCard').then((m) => ({ default: m.ComponentUiCard })),
)

/**
 * 生成式 UI 懒加载入口（G2）：首屏不进包，命中 component-ui 结果时才加载
 * 官方 GenerativeUIRender 所在分块。fallback 为轻量占位，不抛错误。
 */
export function ComponentUiCardLazy(props: {
  result: PresentComponentUi
  threadId: string
  prompting?: boolean
  onSubmit?: (payload: GenerativeSubmitPayload) => void
  onLocateChapter?: (flatIndex: number, excerpt?: string) => void
  className?: string
}) {
  return (
    <Suspense
      fallback={
        <div
          className="rounded-xl border border-border/60 bg-card px-3 py-2 text-[11px] text-muted-foreground"
          data-testid="component-ui-loading"
        >
          正在加载交互界面…
        </div>
      }
    >
      <LazyCard {...props} />
    </Suspense>
  )
}
