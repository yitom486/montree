import { lazy, Suspense } from 'react'
import type { MindmapArtifact } from '@/lib/agent/context/mindmap-artifact'

// Markmap（d3 + markmap-lib）体积较大，聊天首屏不引入；与文档内 Markmap 块共用同一实现
const MarkmapBlockLazy = lazy(() =>
  import('@/components/markdown/MarkmapBlock').then((module) => ({ default: module.MarkmapBlock })),
)

/**
 * 对话内思维导图卡：把 `montree_present` 生成的思维导图快照交给 Markmap 渲染。
 * Markmap 负责树布局、自动 fit、缩放/拖拽、节点折叠与全屏，替代原先固定 608px 宽的单侧 SVG。
 */
export function MindmapPresentCard({ artifact }: { artifact: MindmapArtifact }) {
  return (
    <div data-testid="mindmap-present-card" data-node-count={artifact.nodeCount}>
      <Suspense
        fallback={
          <div
            role="status"
            className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-muted/20 text-xs text-muted-foreground"
          >
            正在加载思维导图…
          </div>
        }
      >
        <MarkmapBlockLazy
          source={artifact.source}
          title={artifact.title}
          initialHeight={400}
          // 详情展开出子节点时默认只展开到分类层，点击圆圈再展开明细
          initialExpandLevel={artifact.detailNodeCount > 0 ? 2 : -1}
        />
      </Suspense>
    </div>
  )
}
