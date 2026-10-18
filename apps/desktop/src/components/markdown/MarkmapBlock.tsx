import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap, type IMarkmapOptions } from 'markmap-view'
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Copy,
  Check,
  Code2,
  Eye,
  Download,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface MarkmapBlockProps {
  source: string
  className?: string
  showToolbar?: boolean
  title?: string
  initialHeight?: number
  allowFullscreen?: boolean
}

// 惰性单例 Transformer，解析 Markdown AST 为 Markmap 树节点
let cachedTransformer: Transformer | null = null
function getTransformer(): Transformer {
  if (!cachedTransformer) {
    cachedTransformer = new Transformer()
  }
  return cachedTransformer
}

export function MarkmapBlock({
  source,
  className,
  showToolbar = true,
  title,
  initialHeight = 420,
  allowFullscreen = true,
}: MarkmapBlockProps) {
  const theme = useEditorUiStore((s) => s.theme)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const markmapRef = useRef<Markmap | null>(null)

  const [renderError, setRenderError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram')
  const [copied, setCopied] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // 1. 解析 Markdown 为 Markmap 数据结构
  const rootData = useMemo(() => {
    try {
      const transformer = getTransformer()
      const { root } = transformer.transform(source || '# 暂无内容')
      setRenderError(null)
      return root
    } catch (err) {
      const msg = err instanceof Error ? err.message : '思维导图解析失败'
      setRenderError(msg)
      return null
    }
  }, [source])

  // 视图切换时清理 SVG 绑定
  useEffect(() => {
    if (viewMode !== 'diagram') {
      markmapRef.current?.destroy()
      markmapRef.current = null
    }
  }, [viewMode])

  // 组件卸载时释放实例
  useEffect(() => {
    return () => {
      markmapRef.current?.destroy()
      markmapRef.current = null
    }
  }, [])

  // 2. 初始化与更新 Markmap 实例
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !rootData || viewMode !== 'diagram') return

    let isSubscribed = true

    try {
      if (!markmapRef.current) {
        // 创建新实例
        const options: Partial<IMarkmapOptions> = {
          duration: 250,
          maxWidth: 260,
          spacingHorizontal: 80,
          spacingVertical: 12,
          style: (id: string) =>
            theme === 'dark'
              ? `#${id}.markmap { --markmap-code-bg: #1f2937; --markmap-code-color: #e5e7eb; --markmap-circle-open-bg: #374151; --markmap-text-color: #f3f4f6; --markmap-a-color: #60a5fa; --markmap-a-hover-color: #93c5fd; }`
              : '',
        }
        markmapRef.current = Markmap.create(svg, options, rootData)
      } else {
        // 更新现有实例数据
        markmapRef.current.setData(rootData)
      }

      // 调整视图适配
      requestAnimationFrame(() => {
        if (isSubscribed && markmapRef.current) {
          void markmapRef.current.fit()
        }
      })
    } catch (err) {
      if (isSubscribed) {
        setRenderError(err instanceof Error ? err.message : 'Markmap 渲染失败')
      }
    }

    return () => {
      isSubscribed = false
    }
  }, [rootData, viewMode, theme])

  // 缩放控制动作
  const handleZoomIn = () => {
    markmapRef.current?.rescale(1.25)
  }

  const handleZoomOut = () => {
    markmapRef.current?.rescale(0.8)
  }

  const handleFit = () => {
    void markmapRef.current?.fit()
  }

  const handleCopySource = async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      toast.success('已复制思维导图源码')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败')
    }
  }

  const handleExportSvg = () => {
    const svg = svgRef.current
    if (!svg) return
    try {
      const serializer = new XMLSerializer()
      const svgString = serializer.serializeToString(svg)
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title || 'markmap'}.svg`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('思维导图 SVG 已导出')
    } catch {
      toast.error('导出 SVG 失败')
    }
  }

  return (
    <div
      className={cn(
        'group relative my-3 flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 shadow-xs transition-all',
        className,
      )}
      data-testid="markmap-block"
    >
      {/* 顶部工具栏 */}
      {showToolbar && (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/40 bg-muted/30 px-3 text-xs text-muted-foreground backdrop-blur-xs">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <span className="truncate">{title || '思维导图 (Markmap)'}</span>
          </div>

          <div className="flex items-center gap-1">
            {viewMode === 'diagram' && !renderError && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={handleZoomIn}
                  title="放大"
                >
                  <ZoomIn className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={handleZoomOut}
                  title="缩小"
                >
                  <ZoomOut className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={handleFit}
                  title="适应视图"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={handleExportSvg}
                  title="导出 SVG"
                >
                  <Download className="size-3.5" />
                </Button>
                {allowFullscreen && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsModalOpen(true)}
                    title="全屏放大查看"
                  >
                    <Maximize2 className="size-3.5" />
                  </Button>
                )}
              </>
            )}

            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={handleCopySource}
              title="复制 Markdown"
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={() => setViewMode(viewMode === 'diagram' ? 'code' : 'diagram')}
              title={viewMode === 'diagram' ? '查看源码' : '查看图谱'}
            >
              {viewMode === 'diagram' ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
        </div>
      )}

      {/* 视图内容区 */}
      <div
        className="relative w-full overflow-hidden bg-background/50"
        style={{ height: `${initialHeight}px` }}
      >
        {renderError ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-destructive">
            <AlertCircle className="mb-2 size-6" />
            <p className="font-semibold">思维导图生成失败</p>
            <p className="mt-1 max-w-md text-muted-foreground">{renderError}</p>
          </div>
        ) : viewMode === 'code' ? (
          <div className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground">
            <pre className="whitespace-pre-wrap">{source}</pre>
          </div>
        ) : (
          <svg
            ref={svgRef}
            data-testid="markmap-svg"
            className="size-full select-none"
            style={{
              colorScheme: theme === 'dark' ? 'dark' : 'light',
            }}
          />
        )}
      </div>

      {/* 放大全屏弹窗 */}
      {allowFullscreen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="flex h-[90vh] w-[95vw] max-w-6xl flex-col p-4">
            <DialogHeader className="shrink-0 pb-2">
              <DialogTitle>{title || '思维导图全景浏览'}</DialogTitle>
              <DialogDescription>
                支持滚轮无级缩放、按住鼠标左键自由拖动画布、点击圆圈节点折叠/展开分支。
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 rounded-lg border border-border/50 bg-background/50 p-2">
              <MarkmapBlock
                source={source}
                showToolbar={true}
                initialHeight={typeof window !== 'undefined' ? Math.max(300, Math.floor(window.innerHeight * 0.72)) : 500}
                title={title}
                allowFullscreen={false}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
