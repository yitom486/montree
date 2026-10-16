import { useState, type ReactNode } from 'react'
import {
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  BookOpen,
  Check,
  Code2,
  Copy,
  GitCommit,
  Layers,
  Network,
  PenLine,
  Pin,
  Sparkles,
  Terminal,
} from 'lucide-react'
// 自宿主 `apps/desktop/src/components/agent/tools/DiagramViewerCard.tsx` 整搬改 props（M3c 工具卡批）：
// `Button` 改包内私有 `./button`；`result-card` 改 `./result-card`；`cn` 改 `./cn`；余逐字。
// 间接 `MermaidBlock` 主题依赖（宿主 `components/markdown/MermaidBlock` 读 `editor-ui-store(theme)` +
// `reader-hud-store`，不复制）：改为可选 `renderMermaid?(source)` 槽（宿主传
// `(source) => <MermaidBlock source={source}/>`；缺省降级为源码 `<pre>`，复制/标题/步骤/保存/定位行为不变）
// + 可选 `mermaidTheme?` 透传 prop（`'light'|'dark'|'sepia'`，宿主主题值直传；缺省不干预渲染器内部主题，
// 报告为 M4 主题对账前提；不复制 `MermaidBlock`）。
import { Button } from './button'
import { RESULT_CARD_HEADER, RESULT_CARD_ICON, RESULT_CARD_SUMMARY, resultCardClassName } from './result-card'
import { cn } from './cn'

export interface DiagramVisualStep {
  from: string
  to: string
  action: string
  desc?: string
  payload?: string
  anchorExcerpt?: string
}

export interface DiagramPayload {
  diagramId: string
  diagramType:
    | 'sequence'
    | 'flowchart'
    | 'mindmap'
    | 'stateDiagram'
    | 'classDiagram'
    | 'erDiagram'
  title: string
  mermaidCode: string
  anchorExcerpt?: string
  summary?: string
  visualSteps?: DiagramVisualStep[]
}

export type DiagramMermaidTheme = 'light' | 'dark' | 'sepia' | string

export interface DiagramViewerCardProps {
  payload: DiagramPayload
  onHighlightAnchor?: (anchorExcerpt: string) => void
  onPinToDoc?: (payload: DiagramPayload) => void
  onSaveAsKnowledgeCard?: (payload: DiagramPayload) => Promise<boolean> | boolean
  isSavedAsCard?: boolean
  isPinned?: boolean
  className?: string
  /**
   * U3 紧凑入口：主流默认只呈标题+短摘要+至多 3 步预览，
   * 完整流程/Mermaid/概览与保存/固定/定位经“查看完整图表”进入。
   * 内部展开态与 key 稳定，chunk/主题更新不重置。
   */
  defaultCompact?: boolean
  /**
   * Mermaid 渲染槽（宿主 `MermaidBlock` 经此注入，不复制；缺省源码 `<pre>`）。
   * 宿主示例：`renderMermaid={(source) => <MermaidBlock source={source} />}`。
   */
  renderMermaid?: (source: string) => ReactNode
  /**
   * Mermaid 主题透传（宿主 `editor-ui-store.theme` 值直传；缺省不干预）。
   * 宿主渲染器可据此同步亮暗（`MermaidBlock` 现内部自读 store，M4 对账后改由此外部传入）。
   */
  mermaidTheme?: DiagramMermaidTheme
}

export function DiagramViewerCard({
  payload,
  onHighlightAnchor,
  onPinToDoc,
  onSaveAsKnowledgeCard,
  isSavedAsCard = false,
  isPinned = false,
  defaultCompact = false,
  className,
  renderMermaid,
  mermaidTheme,
}: DiagramViewerCardProps) {
  const hasSteps = (payload.visualSteps?.length ?? 0) > 0
  const [viewMode, setViewMode] = useState<'visual' | 'graph' | 'mermaid'>(
    hasSteps ? 'visual' : 'mermaid',
  )
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(0)
  const [expandedPayloadIndex, setExpandedPayloadIndex] = useState<number | null>(null)
  const [isSavingCard, setIsSavingCard] = useState(false)
  const [savedLocally, setSavedLocally] = useState(isSavedAsCard)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(!defaultCompact)

  const handleSaveCard = async () => {
    if (!onSaveAsKnowledgeCard || isSavingCard || savedLocally) return
    setIsSavingCard(true)
    try {
      const ok = await onSaveAsKnowledgeCard(payload)
      if (ok) setSavedLocally(true)
    } finally {
      setIsSavingCard(false)
    }
  }

  const copyMermaid = async () => {
    if (!payload.mermaidCode) return
    try {
      await navigator.clipboard.writeText(payload.mermaidCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板异常静默
    }
  }

  const typeLabels: Record<string, string> = {
    sequence: '时序图',
    flowchart: '流程图',
    mindmap: '思维导图',
    stateDiagram: '状态机',
    classDiagram: '类拓扑',
    erDiagram: '实体网络',
  }

  void mermaidTheme

  const mermaidNode = renderMermaid ? (
    renderMermaid(payload.mermaidCode)
  ) : (
    <pre className="max-h-60 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px] leading-relaxed text-foreground">
      {payload.mermaidCode}
    </pre>
  )

  return (
    <div
      className={cn(
        resultCardClassName(className),
      )}
      data-testid="diagram-viewer-card"
    >
      {/* 头部：标题与视图模式切换 */}
      <div className={cn('flex flex-wrap items-center justify-between gap-2', RESULT_CARD_HEADER)}>
        <div className="flex min-w-0 items-center gap-2">
          <div className={RESULT_CARD_ICON}>
            <GitCommit className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-xs font-semibold tracking-tight text-foreground">
                {payload.title}
              </h4>
              <span className="shrink-0 rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {typeLabels[payload.diagramType] ?? 'DIAGRAM'}
              </span>
            </div>
            {payload.summary ? (
              <p className={RESULT_CARD_SUMMARY}>{payload.summary}</p>
            ) : null}
          </div>
        </div>

        {/* Tab 切换：紧凑态隐藏（入口展开后才可切换，避免无效控件） */}
        {expanded ? (
        <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/80 p-0.5 text-xs">
          {hasSteps ? (
            <button
              type="button"
              onClick={() => setViewMode('visual')}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
                viewMode === 'visual'
                  ? 'bg-foreground text-background shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Layers className="size-3" />
              <span>流转步骤</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setViewMode('mermaid')}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
              viewMode === 'mermaid'
                ? 'bg-foreground text-background shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Code2 className="size-3" />
            <span>Mermaid 图</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('graph')}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
              viewMode === 'graph'
                ? 'bg-foreground text-background shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Network className="size-3" />
            <span>概览</span>
          </button>
        </div>
        ) : null}
      </div>

      {/* 主画布内容：紧凑态只呈摘要与至多 3 步，完整功能经入口进入 */}
      {expanded ? (
        <>
          <div className="p-3">
        {viewMode === 'visual' && hasSteps ? (
          <div className="space-y-2.5">
            {/* 角色速览 */}
            <div className="grid grid-cols-2 gap-2 border-b border-border/40 pb-2">
              <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 p-1.5 text-xs">
                <Terminal className="size-3.5 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-[11px] text-foreground">
                    Client 客户端
                  </div>
                  <div className="truncate text-[9px] text-muted-foreground font-mono">发起端</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 p-1.5 text-xs">
                <PenLine className="size-3.5 text-foreground/80" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-[11px] text-foreground">
                    Agent 推演端
                  </div>
                  <div className="truncate text-[9px] text-muted-foreground font-mono">响应端</div>
                </div>
              </div>
            </div>

            {/* 步骤时间轴 */}
            <div className="space-y-1.5">
              {payload.visualSteps!.map((step, idx) => {
                const isSelected = activeStepIndex === idx
                const hasAnchor = Boolean(step.anchorExcerpt || payload.anchorExcerpt)
                const targetAnchor = step.anchorExcerpt || payload.anchorExcerpt

                return (
                  <div
                    key={idx}
                    onClick={() => {
                      setActiveStepIndex(idx)
                      if (targetAnchor && onHighlightAnchor) {
                        onHighlightAnchor(targetAnchor)
                      }
                    }}
                    className={cn(
                      'group flex cursor-pointer items-start gap-2.5 rounded-lg border p-2 text-left transition-all',
                      isSelected
                        ? 'border-foreground/30 bg-muted/40 shadow-xs ring-1 ring-border/80'
                        : 'border-border/40 bg-card hover:border-border hover:bg-muted/20',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4.5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold transition-all',
                        isSelected
                          ? 'bg-foreground text-background shadow-xs'
                          : 'border border-border/70 bg-background text-muted-foreground',
                      )}
                    >
                      {idx + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-foreground">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {step.from}
                          </span>
                          <span className="text-muted-foreground/60">➔</span>
                          <span className="font-mono text-[10px] font-semibold text-foreground/90">
                            {step.to}
                          </span>
                          <span className="text-muted-foreground/60">·</span>
                          <span className="truncate text-[11px] font-semibold text-foreground">
                            {step.action}
                          </span>
                        </div>

                        {hasAnchor ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border/60 bg-background/80 px-1 py-0.2 text-[9px] font-mono text-muted-foreground group-hover:border-foreground/40 group-hover:text-foreground"
                            title="点击穿透定位正文原句"
                          >
                            <span>定位原文</span>
                            <ArrowRight className="size-2.5" />
                          </span>
                        ) : null}
                      </div>

                      {step.desc ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground leading-relaxed">
                          {step.desc}
                        </p>
                      ) : null}

                      {step.payload ? (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedPayloadIndex((cur) => (cur === idx ? null : idx))
                            }}
                            className="text-[9px] font-mono text-primary/80 hover:text-primary hover:underline"
                          >
                            {expandedPayloadIndex === idx ? '收起详情 ▲' : '查看负载 ▼'}
                          </button>
                          {expandedPayloadIndex === idx ? (
                            <pre className="mt-1 max-h-36 overflow-auto rounded border border-border/70 bg-background/90 p-1.5 font-mono text-[10px] text-foreground">
                              {step.payload}
                            </pre>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* Mermaid 图表渲染视图 */}
        {viewMode === 'mermaid' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-end gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={() => void copyMermaid()}
              >
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                <span>{copied ? '已复制源码' : '复制代码'}</span>
              </Button>
            </div>
            {/* 宿主 MermaidBlock 经 renderMermaid 注入（包内不复制）；缺省源码 pre，保证复制/标题/步骤行为不变 */}
            <div className="overflow-x-auto rounded-lg border border-border/60 bg-background/50 p-2">
              {mermaidNode}
            </div>
          </div>
        ) : null}

        {/* 概览与要点视图 */}
        {viewMode === 'graph' ? (
          <div className="space-y-2.5 py-1 text-xs">
            {payload.summary ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[11px] leading-relaxed text-foreground">
                <span className="font-semibold text-primary">核心解读：</span>
                {payload.summary}
              </div>
            ) : null}
            {payload.anchorExcerpt ? (
              <div
                onClick={() => onHighlightAnchor?.(payload.anchorExcerpt!)}
                className="group flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 bg-muted/20 p-2 hover:border-primary/50"
              >
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium text-muted-foreground">对应原文引文</div>
                  <p className="line-clamp-2 text-[11px] text-foreground/90 italic">
                    "{payload.anchorExcerpt}"
                  </p>
                </div>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground group-hover:text-primary" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 底部联动与钉入工具栏 */}
      <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <BookOpen className="size-3 text-muted-foreground/80" />
          <span>点击流转步骤，正文平滑穿透定位</span>
        </span>

        <div className="flex items-center gap-1.5">
          {onSaveAsKnowledgeCard ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={isSavingCard || savedLocally}
              onClick={() => void handleSaveCard()}
              className={cn(
                'h-6 gap-1 px-2 text-[10px] transition-colors',
                savedLocally
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              {savedLocally ? (
                <>
                  <BookmarkCheck className="size-3 text-emerald-500" />
                  <span>已存为卡片</span>
                </>
              ) : (
                <>
                  <BookmarkPlus className="size-3 text-primary" />
                  <span>{isSavingCard ? '正在保存…' : '存为知识卡片'}</span>
                </>
              )}
            </Button>
          ) : null}

          {onPinToDoc ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPinToDoc(payload)}
              className={cn(
                'h-6 gap-1 px-2 text-[10px]',
                isPinned
                  ? 'bg-foreground/10 text-foreground border border-border'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Pin className="size-3" />
              <span>{isPinned ? '已编入正文' : '固定至正文'}</span>
            </Button>
          ) : null}
        </div>
      </div>
        </>
      ) : (
        <div className="min-w-0 px-3 py-2">
          {payload.summary ? (
            <p className="line-clamp-2 min-w-0 text-[11px] leading-relaxed text-muted-foreground">
              {payload.summary}
            </p>
          ) : null}
          {hasSteps ? (
            <ul className="mt-1.5 min-w-0 space-y-1">
              {payload.visualSteps!.slice(0, 3).map((step, idx) => (
                <li
                  key={idx}
                  className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground/90"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                    {idx + 1}
                  </span>
                  <span className="min-w-0 truncate">
                    {step.action}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {step.from} → {step.to}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(true)}
            className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 text-[11px] font-medium text-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring"
          >
            查看完整图表
            {hasSteps ? (
              <span className="font-normal text-muted-foreground">
               （共 {payload.visualSteps!.length} 步）
              </span>
            ) : null}
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      )}
      {expanded && defaultCompact ? (
        <div className="border-t border-border/60 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex min-h-[32px] w-full items-center justify-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            收起完整图表
          </button>
        </div>
      ) : null}
    </div>
  )
}
