import { useEffect, useId, useMemo, useState } from 'react'
import {
  Maximize2,
  Copy,
  Check,
  Code2,
  Download,
  Eye,
  GitFork,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { renderMermaidSvg } from '@/lib/preview/mermaid-hydrate'
import { repairMermaidSource } from '@/lib/preview/mermaid-repair'
import { cn } from '@/lib/utils'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export interface MermaidBlockProps {
  source: string
  className?: string
  showToolbar?: boolean
  title?: string
}

/**
 * 全功能交互式 Mermaid 图谱工坊（预览 / Agent / 札记卡片共用）：
 * 1. 声明式 React State 渲染管道，避免 DOM 命令式水合竞态与过期回退
 * 2. 智能语法自适应清洗修复（缺行/连行/缺头自动补齐）
 * 3. 交互式控制台（全屏沉浸平移缩放、SVG 导出、源码查看与复制）
 * 4. 亮暗色主题自适应与 SVG 自适应排版
 */
export function MermaidBlock({
  source,
  className,
  showToolbar = true,
  title,
}: MermaidBlockProps) {
  const theme = useEditorUiStore((s) => s.theme)
  const reactId = useId().replace(/:/g, '')

  const [svgHtml, setSvgHtml] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram')
  const [copied, setCopied] = useState(false)

  const repairedSource = useMemo(() => repairMermaidSource(source), [source])

  useEffect(() => {
    let alive = true
    setIsLoading(true)
    setRenderError(null)

    renderMermaidSvg(repairedSource, theme)
      .then((svg) => {
        if (!alive) return
        setSvgHtml(svg)
        setIsLoading(false)
        setRenderError(null)
      })
      .catch((err) => {
        if (!alive) return
        const msg = err instanceof Error ? err.message : String(err)
        setRenderError(msg)
        setIsLoading(false)
        setSvgHtml(null)
      })

    return () => {
      alive = false
    }
  }, [repairedSource, theme])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(repairedSource)
      setCopied(true)
      toast.success('已复制 Mermaid 拓扑源码')
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // silent
    }
  }

  const handleExportSvg = () => {
    if (!svgHtml) {
      toast.warning('图表尚未完成渲染，暂无法导出')
      return
    }
    const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title || 'montree-diagram'}.svg`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('已导出矢量 SVG 图表')
  }

  const handleFullscreen = () => {
    const setSelectedDiagram = useReaderHudUiStore.getState().setSelectedDiagram
    const diagType = repairedSource.includes('sequenceDiagram')
      ? 'sequence'
      : repairedSource.includes('mindmap')
        ? 'mindmap'
        : 'flowchart'

    setSelectedDiagram({
      diagramId: `diag-${reactId}`,
      diagramType: diagType,
      title: title || '架构交互拓扑图谱',
      mermaidCode: repairedSource,
      summary: '全屏沉浸检视与交互式缩放拓扑',
    })
  }

  return (
    <div
      className={cn(
        'group/mermaid relative rounded-xl border border-border/60 bg-card/90 shadow-2xs transition-all my-2.5 overflow-hidden',
        className,
      )}
      data-mermaid-source={repairedSource}
      data-testid="mermaid-block"
    >
      {/* 顶部微晶浮动工具栏 */}
      {showToolbar && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/20 backdrop-blur-sm text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-[10.5px]">
            <GitFork className="size-3 text-purple-500" />
            <span className="font-semibold text-foreground/80">{title || '架构拓扑图谱'}</span>
          </div>

          <div className="flex items-center gap-1">
            {/* 切换图表 / 源码视图 */}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground cursor-pointer rounded-md"
              onClick={() => setViewMode((m) => (m === 'diagram' ? 'code' : 'diagram'))}
              title={viewMode === 'diagram' ? '查看 Mermaid 源码' : '返回图表视图'}
            >
              {viewMode === 'diagram' ? <Code2 className="size-3" /> : <Eye className="size-3 text-primary" />}
            </Button>

            {/* 复制代码 */}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground cursor-pointer rounded-md"
              onClick={handleCopy}
              title="复制 Mermaid 源码"
            >
              {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            </Button>

            {/* 导出 SVG */}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground cursor-pointer rounded-md"
              onClick={handleExportSvg}
              title="导出高清 SVG 图表"
            >
              <Download className="size-3" />
            </Button>

            {/* 全屏放大检视 */}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-primary cursor-pointer rounded-md"
              onClick={handleFullscreen}
              title="全屏沉浸平移与无级缩放检视"
            >
              <Maximize2 className="size-3" />
            </Button>
          </div>
        </div>
      )}

      {/* 主视图 */}
      {viewMode === 'diagram' ? (
        <div className="min-h-[90px] flex items-center justify-center">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground animate-pulse">
              <Loader2 className="size-4 animate-spin text-purple-500" />
              <span className="text-[11px] font-medium text-foreground/70">正在解析并渲染架构拓扑...</span>
            </div>
          ) : renderError ? (
            <div className="flex flex-col items-center justify-center gap-2 p-5 text-center my-2">
              <div className="inline-flex items-center gap-1.5 text-amber-500 text-xs font-semibold">
                <AlertCircle className="size-3.5" />
                <span>图表解析微调中</span>
              </div>
              <p className="text-[10.5px] text-muted-foreground font-mono max-w-sm line-clamp-2">
                {renderError}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10.5px] gap-1 px-2.5 mt-1 border-border/70"
                onClick={() => setViewMode('code')}
              >
                <Code2 className="size-3" />
                <span>查看 Mermaid 源代码</span>
              </Button>
            </div>
          ) : svgHtml ? (
            <div
              className="w-full flex items-center justify-center p-3 overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto transition-all animate-in fade-in duration-300"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
              data-testid="mermaid-block"
              data-mermaid-source={repairedSource}
            />
          ) : null}
        </div>
      ) : (
        <pre className="p-3 text-[11px] font-mono leading-relaxed bg-muted/40 text-foreground overflow-x-auto whitespace-pre select-text">
          <code>{repairedSource}</code>
        </pre>
      )}
    </div>
  )
}
