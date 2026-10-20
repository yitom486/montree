import { lazy, Suspense, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ListTree, Network, Pencil } from 'lucide-react'
import type { ReaderUnit } from '@yitom/reader-core'
import {
  buildReaderUnitTree,
  readerUnitsToMarkmap,
  shouldExpandReaderUnitNode,
  type ReaderUnitTreeNode,
} from '@/lib/reader/reader-unit-tree'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const MarkmapBlock = lazy(() => import('@/components/markdown/MarkmapBlock').then((m) => ({ default: m.MarkmapBlock })))

export interface TocViewOption {
  id: string
  label: string
  count: number
}

export interface ReaderUnitOutlineProps {
  units: ReaderUnit[]
  currentUnitId?: string
  collapsed?: boolean
  onToggle: () => void
  onSelectUnit: (unit: ReaderUnit) => void
  onEditToc?: () => void
  outlineNotice?: string
  tocViews?: TocViewOption[]
  activeTocView?: string
  onSelectTocView?: (viewId: string) => void
}

function OutlineTreeNode({
  node,
  depth,
  currentUnitId,
  onSelectUnit,
}: {
  node: ReaderUnitTreeNode
  depth: number
  currentUnitId?: string
  onSelectUnit: (unit: ReaderUnit) => void
}) {
  const hasChildren = node.children.length > 0
  const [expanded, setExpanded] = useState(() => shouldExpandReaderUnitNode(depth))
  // Web 文档的分组节点沿用“组 href = 首个子项 href”的约定：
  // 这类节点点击标题只折叠，不重复跳到首个子项。
  const isGroup = hasChildren && node.children[0]?.unit.href === node.unit.href
  const isActive = !isGroup && currentUnitId === node.unit.href

  return (
    <li>
      <div
        className="flex items-center gap-0.5"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            aria-label={expanded ? '折叠' : '展开'}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <button
          type="button"
          className={cn(
            'min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-xs transition-colors hover:bg-accent/50 hover:text-foreground',
            isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
            isGroup && 'font-medium text-foreground',
          )}
          title={node.unit.label}
          aria-expanded={isGroup ? expanded : undefined}
          onClick={() => {
            if (isGroup) {
              setExpanded((value) => !value)
              return
            }
            onSelectUnit(node.unit)
          }}
        >
          {node.unit.label}
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <OutlineTreeNode
              key={`${child.unit.href}-${child.unit.label}-${child.unit.level}`}
              node={child}
              depth={depth + 1}
              currentUnitId={currentUnitId}
              onSelectUnit={onSelectUnit}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function ReaderUnitOutline({
  units,
  currentUnitId,
  collapsed = false,
  onToggle,
  onSelectUnit,
  onEditToc,
  outlineNotice,
  tocViews,
  activeTocView,
  onSelectTocView,
}: ReaderUnitOutlineProps) {
  const [showMindmap, setShowMindmap] = useState(false)
  const tree = useMemo(() => buildReaderUnitTree(units), [units])
  const mindmapSource = useMemo(() => readerUnitsToMarkmap(units), [units])

  return (
    <section
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden bg-sidebar',
        collapsed && 'shrink-0 border-r border-border/60',
      )}
    >
      <div className="flex w-full shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          <ListTree className="size-3.5 shrink-0" />
          目录
        </button>
        {tocViews && tocViews.length > 1 ? (
          <div className="flex shrink-0 items-center rounded-md border border-border/50 bg-muted/40 p-0.5 text-[10px]">
            {tocViews.map((view) => {
              const active = view.id === activeTocView
              return (
                <button
                  key={view.id}
                  type="button"
                  className={cn(
                    'rounded px-1.5 py-0.5 font-medium transition-colors',
                    active
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => onSelectTocView?.(view.id)}
                  title={`${view.label}（共 ${view.count} 项）`}
                >
                  {view.label}
                  <span className="ml-0.5 opacity-70">({view.count})</span>
                </button>
              )
            })}
          </div>
        ) : units.length > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-[10px] font-normal normal-case text-muted-foreground/80">
            <button
              type="button"
              className="rounded p-0.5 hover:bg-accent/50 hover:text-foreground"
              aria-label="导图视图"
              title="全景思维导图"
              onClick={() => setShowMindmap(true)}
            >
              <Network className="size-3" />
            </button>
            {onEditToc ? (
              <button
                type="button"
                className="rounded p-0.5 hover:bg-accent/50 hover:text-foreground"
                aria-label="校正目录"
                title="校正目录"
                onClick={onEditToc}
              >
                <Pencil className="size-3" />
              </button>
            ) : null}
            {units.length}
          </span>
        ) : null}
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          {outlineNotice ? (
            <p className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-950 dark:text-amber-100">
              {outlineNotice}
            </p>
          ) : null}
          {units.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">暂无目录</p>
          ) : (
            <ul className="space-y-0.5 p-2">
              {tree.map((node) => (
                <OutlineTreeNode
                  key={`${node.unit.href}-${node.unit.label}-${node.unit.level}`}
                  node={node}
                  depth={0}
                  currentUnitId={currentUnitId}
                  onSelectUnit={onSelectUnit}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {showMindmap && (
        <Dialog open={showMindmap} onOpenChange={setShowMindmap}>
          <DialogContent className="flex h-[90vh] w-[95vw] max-w-6xl flex-col p-4">
            <DialogHeader className="shrink-0 pb-2">
              <DialogTitle className="flex items-center gap-2">
                <Network className="size-4 text-primary" />
                书籍全景思维导图
              </DialogTitle>
              <DialogDescription>
                支持滚轮无级缩放、自由拖动画布、点击圆圈节点折叠/展开章节分支。
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 rounded-lg border border-border/50 bg-background/50 p-2">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    正在加载思维导图引擎…
                  </div>
                }
              >
                <MarkmapBlock
                  source={mindmapSource}
                  showToolbar={true}
                  initialHeight={
                    typeof window !== 'undefined'
                      ? Math.max(300, Math.floor(window.innerHeight * 0.72))
                      : 500
                  }
                  title="书籍目录思维导图"
                />
              </Suspense>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
