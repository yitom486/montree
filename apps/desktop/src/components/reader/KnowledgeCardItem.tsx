import React, { useState } from 'react'
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
} from 'lucide-react'
import type { ReadingMark, ReadingMarkCategory } from '@montree/contracts'
import { filterRedundantKeyPoints, resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'

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
  const resolved = resolveCardMeta(mark)
  const category = resolved.category

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
    const textToCopy = `【${titleText}】\n${resolved.displayNote || mark.excerpt || ''}${
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
              className="font-semibold text-[11px] text-foreground truncate max-w-[150px]"
              title={resolved.title || mark.label}
            >
              {resolved.title || mark.label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-muted-foreground shrink-0">
          <span className="text-[10px] font-mono mr-0.5">{formattedTime}</span>

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

      {/* 卡片正文（普通笔记，若为结构化序列化内容则已自动提炼至各属性，不展示 raw JSON） */}
      {resolved.displayNote && (
        <p className="text-foreground text-[11px] leading-relaxed mb-2">
          {resolved.displayNote}
        </p>
      )}

      {/* 核心概念与规约标签（复读摘录的要点 pill 直接隐藏，见 filterRedundantKeyPoints） */}
      {(() => {
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

      {/* AI 研判洞见 Callout */}
      {resolved.aiSummary && (
        <div className="p-2 rounded-lg bg-muted/40 border border-border/60 text-[10.5px] text-muted-foreground leading-normal space-y-1 mb-2">
          <div className="flex items-center gap-1 font-medium text-primary text-[10px]">
            <Sparkles className="w-3 h-3" />
            <span>AI 研读洞见</span>
          </div>
          <div>{resolved.aiSummary}</div>
        </div>
      )}

      {/* 时序/流转图谱交互入口 */}
      {(resolved.diagramId || resolved.category === 'diagram') && (
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium flex items-center gap-1">
            <Network className="w-3 h-3" />
            <span>时序交互图谱</span>
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenDiagram?.(resolved.diagramId || mark.id)
            }}
            className="flex items-center gap-1 text-[10.5px] text-primary hover:text-primary/80 font-medium cursor-pointer"
          >
            <span>展开时序图</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}
