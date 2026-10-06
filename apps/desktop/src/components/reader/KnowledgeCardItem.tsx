import React, { useMemo, useState } from 'react'
import {
  Sparkles,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Trash2,
  Copy,
  Check,
  ArrowUpRight,
  MapPin,
  Network,
  Maximize2,
  Layers,
  GitCommit,
} from 'lucide-react'
import type { ReadingMark, ReadingMarkCategory } from '@montree/contracts'
import { filterRedundantKeyPoints, resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { parseDiagramFromMark } from '@/lib/reader/marks/diagram-mark-parser'
import { renderAgentMarkdown } from '@/lib/agent/agent-markdown'

export interface KnowledgeCardItemProps {
  mark: ReadingMark
  isActive?: boolean
  onToggleCollapse: () => void
  onPolish?: () => void
  onDelete?: () => void
  onOpenDiagram?: (diagramId: string) => void
  onAnchorClick?: () => void
  onCardClick?: () => void
  onHover?: (hovering: boolean) => void
  /** 出处：卡片主人的章节归属（如“第一章 北美的外貌”），缺省不显示 */
  sourceLabel?: string
}

export const KnowledgeCardItem: React.FC<KnowledgeCardItemProps> = ({
  mark,
  isActive = false,
  onToggleCollapse,
  onPolish,
  onDelete,
  onOpenDiagram,
  onAnchorClick,
  onCardClick,
  onHover,
  sourceLabel,
}) => {
  const [copied, setCopied] = useState(false)
  const [isStepsExpanded, setIsStepsExpanded] = useState(false)
  const [isNoteExpanded, setIsNoteExpanded] = useState(false)
  const resolved = resolveCardMeta(mark)
  const category = resolved.category
  const diagramPayload = useMemo(() => parseDiagramFromMark(mark), [mark])

  const getBadgeStyle = (cat: ReadingMarkCategory) => {
    switch (cat) {
      case 'concept':
        return {
          style: { backgroundColor: 'var(--card-concept-bg)', color: 'var(--card-concept-text)' },
          label: '概念',
        }
      case 'quote':
        return {
          style: { backgroundColor: 'var(--card-quote-bg)', color: 'var(--card-quote-text)' },
          label: '引用',
        }
      case 'method':
        return {
          style: { backgroundColor: 'var(--card-method-bg)', color: 'var(--card-method-text)' },
          label: '方法',
        }
      case 'diagram':
        return {
          style: { backgroundColor: 'var(--card-diagram-bg)', color: 'var(--card-diagram-text)' },
          label: '时序图谱',
        }
      case 'question':
        return {
          style: { backgroundColor: 'var(--card-question-bg)', color: 'var(--card-question-text)' },
          label: '思考',
        }
      default:
        return {
          style: { backgroundColor: 'var(--muted)', color: 'var(--foreground)' },
          label: '札记',
        }
    }
  }

  const badge = getBadgeStyle(category)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const titleText = resolved.title || mark.label || mark.excerpt || '知识卡片'
    const noteText = diagramPayload
      ? `【核心解读】\n${diagramPayload.summary || ''}\n\n【推演步骤】\n${(diagramPayload.visualSteps || []).map((s, i) => `${i + 1}. ${s.action}: ${s.desc || ''}`).join('\n')}`
      : resolved.displayNote || mark.excerpt || ''
    const textToCopy = `【${titleText}】\n${noteText}${
      resolved.aiSummary ? `\nAI 研判：${resolved.aiSummary}` : ''
    }`
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const formattedTime = mark.createdAt
    ? new Date(mark.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  // 1. 单行折叠态（极简流线）
  if (mark.collapsed) {
    return (
      <div
        id={`card-${mark.id}`}
        data-card-id={mark.id}
        onClick={() => {
          onCardClick?.()
          onToggleCollapse()
        }}
        onMouseEnter={() => onHover?.(true)}
        onMouseLeave={() => onHover?.(false)}
        className={`group px-3 py-2 rounded-xl border transition-all duration-200 cursor-pointer text-xs flex items-center justify-between gap-2.5 shadow-sm select-none ${
          isActive
            ? 'bg-card border-primary ring-1 ring-primary'
            : 'bg-card/70 hover:bg-card border-border/70 hover:border-border'
        }`}
        title="点击展开完整卡片并居中定位"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
            style={badge.style}
          >
            {badge.label}
          </span>
          <span className="text-[11px] text-foreground truncate">
            {resolved.title || mark.label || mark.excerpt || '札记'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono text-muted-foreground">
            {formattedTime}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapse()
            }}
            className="p-0.5 rounded text-muted-foreground group-hover:text-foreground transition-colors cursor-pointer"
            title="展开"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  // 2. 完整多功能卡片模式
  return (
    <div
      id={`card-${mark.id}`}
      data-card-id={mark.id}
      onClick={() => onCardClick?.()}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={`group p-3.5 rounded-xl border transition-all duration-200 text-xs shadow-sm select-none cursor-pointer ${
        isActive
          ? 'bg-card border-primary ring-1 ring-primary shadow-md'
          : 'bg-card/70 hover:bg-card border-border/70 hover:border-border'
      }`}
    >
      {/* 头部：分类徽标 + 标题 + 工具栏 */}
      <div className="flex items-center justify-between gap-1 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="px-2 py-0.5 rounded text-[10px] font-medium shrink-0"
            style={badge.style}
          >
            {badge.label}
          </span>
          {(resolved.title || mark.label) && (
            <span
              className="font-semibold text-[11px] text-foreground truncate max-w-[140px]"
              title={resolved.title || mark.label}
            >
              {resolved.title || mark.label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-muted-foreground shrink-0">
          <span className="text-[10px] font-mono mr-0.5">{formattedTime}</span>

          {/* 弹窗全屏放大检视 */}
          {(diagramPayload || mark.category === 'diagram') && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenDiagram?.(diagramPayload?.diagramId || mark.id)
              }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-primary transition-all cursor-pointer"
              title="弹窗全屏放大检视（大图/推演）"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}

          {/* AI 润色提炼 */}
          {onPolish && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onPolish()
              }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-primary transition-all cursor-pointer"
              title="AI 提炼润色"
            >
              <Sparkles className="w-3 h-3" />
            </button>
          )}

          {/* 复制 */}
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all cursor-pointer"
            title="复制卡片内容"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>

          {/* 折叠 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapse()
            }}
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            title="折叠为单行模式"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>

          {/* 删除 */}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-destructive transition-all cursor-pointer"
              title="删除卡片"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 出处：卡片主人的章节归属，点击同样定位正文 */}
      {sourceLabel && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAnchorClick?.()
          }}
          title={`定位到${sourceLabel}`}
          className="mb-1.5 flex max-w-full items-center gap-1 text-[10px] text-muted-foreground/80 transition-colors hover:text-primary cursor-pointer"
        >
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{sourceLabel}</span>
        </button>
      )}

      {/* 原文摘录引文 */}
      {mark.excerpt && (
        <div
          onClick={onAnchorClick}
          className="text-[11px] text-muted-foreground italic mb-2 border-l-2 border-primary/50 pl-2 hover:text-foreground flex items-start justify-between gap-1 transition-colors cursor-pointer"
          title="点击在正文中定位"
        >
          <span className="line-clamp-2">"{mark.excerpt}"</span>
          <ArrowUpRight className="w-3 h-3 shrink-0 opacity-40 group-hover:opacity-100 text-primary transition-opacity" />
        </div>
      )}

      {/* A. 若为结构化图谱/流程推演卡片：展现精美专属微晶组件 */}
      {diagramPayload ? (
        <div className="space-y-2 mb-2">
          {/* 1. 核心解读 Callout */}
          {diagramPayload.summary && (
            <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-[11px] text-foreground/90 leading-relaxed space-y-1">
              <div className="flex items-center gap-1 font-semibold text-primary text-[10.5px]">
                <Sparkles className="w-3 h-3" />
                <span>核心解读</span>
              </div>
              <div className="leading-relaxed">{diagramPayload.summary}</div>
            </div>
          )}

          {/* 2. 推演流转步骤（带折叠与展开） */}
          {diagramPayload.visualSteps && diagramPayload.visualSteps.length > 0 && (
            <div className="rounded-lg border border-border/70 bg-muted/30 overflow-hidden">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsStepsExpanded((v) => !v)
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3 h-3 text-primary" />
                  <span>流转步骤 ({diagramPayload.visualSteps.length} 步)</span>
                </span>
                <span className="flex items-center gap-0.5 text-[10px] text-primary font-normal">
                  <span>{isStepsExpanded ? '收起步骤' : '展开步骤'}</span>
                  {isStepsExpanded ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </button>

              {isStepsExpanded ? (
                <div className="px-2.5 pb-2 pt-1 space-y-1.5 border-t border-border/50 text-[10.5px]">
                  {diagramPayload.visualSteps.map((step, idx) => (
                    <div
                      key={idx}
                      className="p-1.5 rounded bg-background/80 border border-border/40 space-y-0.5"
                    >
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <span className="size-4 rounded-full bg-primary/10 text-primary text-[9px] flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="truncate">{step.action}</span>
                        {step.from && step.to && (
                          <span className="text-[9.5px] text-muted-foreground font-normal ml-auto shrink-0 truncate max-w-[110px]">
                            {step.from} → {step.to}
                          </span>
                        )}
                      </div>
                      {step.desc && (
                        <p className="text-[10px] text-muted-foreground pl-5 leading-normal">
                          {step.desc}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-2.5 pb-2 pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">首步：</span>
                  {diagramPayload.visualSteps[0]?.action}
                  {diagramPayload.visualSteps.length > 1 && (
                    <span className="ml-1 opacity-70">
                      … 等 {diagramPayload.visualSteps.length} 步
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3. 架构图表微晶预览卡片（点击全屏放大） */}
          <div
            onClick={(e) => {
              e.stopPropagation()
              onOpenDiagram?.(diagramPayload.diagramId || mark.id)
            }}
            className="p-2.5 rounded-lg border border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 transition-colors cursor-pointer group/diag flex items-center justify-between gap-2"
            title="点击打开弹窗大图检视"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="size-7 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                <Network className="size-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-foreground truncate">
                  {diagramPayload.title || '架构图谱'}
                </div>
                <div className="text-[9.5px] text-muted-foreground font-mono truncate">
                  {diagramPayload.diagramType} · 点击全屏放大检视
                </div>
              </div>
            </div>
            <button
              type="button"
              className="p-1 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 group-hover/diag:bg-purple-500 group-hover/diag:text-white transition-all shrink-0"
              title="全屏放大检视"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* B. 普通卡片正文（富文本 Markdown 渲染与折叠） */
        resolved.displayNote && (
          <div className="mb-2">
            <div
              className={`text-foreground text-[11px] leading-relaxed transition-all ${
                !isNoteExpanded && resolved.displayNote.length > 150 ? 'line-clamp-4' : ''
              }`}
              dangerouslySetInnerHTML={{
                __html: renderAgentMarkdown(resolved.displayNote),
              }}
            />
            {resolved.displayNote.length > 150 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsNoteExpanded((v) => !v)
                }}
                className="mt-1 text-[10px] text-primary hover:text-primary/80 font-medium flex items-center gap-0.5 cursor-pointer"
              >
                <span>{isNoteExpanded ? '收起全文' : '展开全文'}</span>
                {isNoteExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
        )
      )}

      {/* 核心概念与规约标签 */}
      {!diagramPayload &&
        (() => {
          const visibleKeyPoints = filterRedundantKeyPoints(resolved.keyPoints, mark.excerpt)
          return visibleKeyPoints.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {visibleKeyPoints.map((kp, idx) => (
                <span
                  key={idx}
                  className="px-1.5 py-0.5 rounded text-[9.5px] bg-muted/60 text-muted-foreground border border-border/50"
                >
                  {kp}
                </span>
              ))}
            </div>
          ) : null
        })()}

      {/* AI 研判洞见 Callout（非图谱卡片且有 aiSummary 时展示） */}
      {!diagramPayload && resolved.aiSummary && (
        <div className="p-2 rounded-lg bg-muted/40 border border-border/60 text-[10.5px] text-muted-foreground leading-normal space-y-1 mb-2">
          <div className="flex items-center gap-1 font-medium text-primary text-[10px]">
            <Sparkles className="w-3 h-3" />
            <span>AI 研读洞见</span>
          </div>
          <div>{resolved.aiSummary}</div>
        </div>
      )}

      {/* 时序/流转图谱交互入口 */}
      {(resolved.diagramId || resolved.category === 'diagram' || diagramPayload) && (
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium flex items-center gap-1">
            <Network className="w-3 h-3" />
            <span>时序交互图谱</span>
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenDiagram?.(diagramPayload?.diagramId || resolved.diagramId || mark.id)
            }}
            className="flex items-center gap-1 text-[10.5px] text-primary hover:text-primary/80 font-medium cursor-pointer"
          >
            <span>展开时序图大图</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}
