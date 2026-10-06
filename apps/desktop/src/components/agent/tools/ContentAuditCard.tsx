import { useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileSearch,
  Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ContentAuditHit } from '@montree/contracts'

export interface ContentAuditPayload {
  query: string
  total: number
  truncated?: boolean
  limit?: number
  hits: ContentAuditHit[]
}

interface ContentAuditCardProps {
  payload: ContentAuditPayload
  onHighlightAnchor?: (anchor: string) => void
  onNavigateHit?: (hit: ContentAuditHit) => void
  className?: string
}

function resolveSourceBadge(source: ContentAuditHit['source']): { label: string; className: string } {
  switch (source) {
    case 'book-index':
    case 'pdf-native':
      return {
        label: 'PDF 语料库',
        className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
      }
    case 'editor-buffer':
      return {
        label: '编辑器实时',
        className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
      }
    case 'workspace-file':
      return {
        label: '工作区文档',
        className: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20',
      }
    case 'ebook-section':
      return {
        label: '电子书分卷',
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
      }
    default:
      return {
        label: '文档索引',
        className: 'bg-muted text-muted-foreground border-border/40',
      }
  }
}

function formatLocator(hit: ContentAuditHit): string {
  const loc = hit.locator
  if (!loc) return ''
  if (loc.pageNumber != null) return `第 ${loc.pageNumber} 页`
  if (loc.chapterTitle) return loc.chapterTitle
  if (loc.filePath) {
    const parts = loc.filePath.replace(/\\/g, '/').split('/')
    const base = parts[parts.length - 1] || loc.filePath
    return loc.lineStart != null ? `${base}:${loc.lineStart}` : base
  }
  return ''
}

export function ContentAuditCard({
  payload,
  onHighlightAnchor,
  onNavigateHit,
  className,
}: ContentAuditCardProps) {
  const [expandedIndices, setExpandedIndices] = useState<number[]>([0, 1]) // 默认展开前两项
  const hits = payload.hits || []

  const toggleExpand = (index: number) => {
    setExpandedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    )
  }

  const handleLocate = (hit: ContentAuditHit) => {
    if (onNavigateHit) {
      onNavigateHit(hit)
    }
    if (onHighlightAnchor) {
      onHighlightAnchor(hit.text)
    } else {
      window.dispatchEvent(
        new CustomEvent('montree:anchor-highlight', { detail: hit.text }),
      )
    }
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-sm backdrop-blur-sm transition-all text-card-foreground',
        className,
      )}
      data-testid="content-audit-card"
    >
      {/* 头部摘要 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/80">
            <FileSearch className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-xs font-semibold text-foreground">
                深度内容审计探针
              </h4>
              <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.2 text-[10px] font-medium text-primary">
                "{payload.query}"
              </span>
            </div>
            <p className="truncate text-[10px] text-muted-foreground">
              命中 <span className="font-semibold text-foreground">{payload.total}</span> 处原句
              {payload.truncated ? ` · 显示前 ${hits.length} 条` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
          <FileCode2 className="size-3 text-muted-foreground/70" />
          <span>只读取证</span>
        </div>
      </div>

      {/* 命中条目清单 */}
      <div className="divide-y divide-border/40 p-2 space-y-1.5">
        {hits.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            全库未探得包含此关键词的内容片段
          </div>
        ) : (
          hits.map((hit, idx) => {
            const isExpanded = expandedIndices.includes(idx)
            const badge = resolveSourceBadge(hit.source)
            const locText = formatLocator(hit)

            return (
              <div
                key={idx}
                className="rounded-lg bg-background/50 border border-border/40 p-2 text-xs transition-colors hover:bg-muted/30 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    onClick={() => toggleExpand(idx)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 cursor-pointer select-none"
                  >
                    <button
                      type="button"
                      className="size-4 shrink-0 rounded p-0 text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.2 text-[9.5px] font-mono border font-medium',
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                    {locText ? (
                      <span className="truncate text-[10.5px] font-medium text-muted-foreground">
                        {locText}
                      </span>
                    ) : null}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[10.5px] text-primary hover:bg-primary/10 hover:text-primary shrink-0 cursor-pointer"
                    onClick={() => handleLocate(hit)}
                  >
                    <span>定位</span>
                    <ArrowUpRight className="size-3" />
                  </Button>
                </div>

                {isExpanded ? (
                  <div className="pl-5 pt-0.5 space-y-1">
                    <p className="text-[11px] leading-relaxed text-foreground/90 italic font-serif bg-muted/20 p-2 rounded-md border-l-2 border-primary/40">
                      "{hit.text}"
                    </p>
                  </div>
                ) : (
                  <p className="pl-5 text-[10.5px] text-muted-foreground truncate italic">
                    "{hit.text}"
                  </p>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
