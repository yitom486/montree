import React, { useEffect, useState } from 'react'
import {
  Check,
  Code2,
  Copy,
  Download,
  GitCommit,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { DiagramViewerCard, type DiagramPayload } from './tools/DiagramViewerCard'
import { Button } from '@/components/ui/button'

export interface DiagramModalProps {
  isOpen: boolean
  onClose: () => void
  diagram: DiagramPayload | null
  onHighlightAnchor?: (anchorExcerpt: string) => void
  onPinToDoc?: (diagram: DiagramPayload) => void
}

export const DiagramModal: React.FC<DiagramModalProps> = ({
  isOpen,
  onClose,
  diagram,
  onHighlightAnchor,
  onPinToDoc,
}) => {
  const [zoomLevel, setZoomLevel] = useState(100)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !diagram) return null

  const handleZoomIn = () => setZoomLevel((z) => Math.min(200, z + 15))
  const handleZoomOut = () => setZoomLevel((z) => Math.max(50, z - 15))
  const handleResetZoom = () => setZoomLevel(100)

  const handleCopyMermaid = () => {
    if (!diagram.mermaidCode) return
    navigator.clipboard.writeText(diagram.mermaidCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleExportSvg = () => {
    const svgEl = document.querySelector('#diagram-modal-body svg')
    if (!svgEl) return
    const svgData = new XMLSerializer().serializeToString(svgEl)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${diagram.title || 'diagram'}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 select-none"
      role="dialog"
      aria-modal="true"
      aria-label={diagram.title}
    >
      {/* 磨砂黑曜石背景遮罩 */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-200"
      />

      {/* 弹窗主体 */}
      <div className="relative z-10 w-full max-w-5xl max-h-[92vh] flex flex-col rounded-3xl border border-border/70 dark:border-white/10 bg-card/95 dark:bg-[#0c0c10]/95 shadow-2xl backdrop-blur-2xl ring-1 ring-black/5 dark:ring-white/5 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* 头部标题与控制条 */}
        <div className="px-6 py-3.5 border-b border-border/60 flex items-center justify-between gap-4 bg-muted/20">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-xl bg-primary/10 text-primary">
              <GitCommit className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-foreground truncate">
                {diagram.title || '交互式时序图谱'}
              </h3>
              <p className="text-[10px] text-muted-foreground font-mono truncate">
                {diagram.diagramType} · {diagram.diagramId}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
            {/* 缩放控制器 */}
            <div className="flex items-center gap-0.5 bg-muted/60 rounded-lg p-0.5 border border-border/50 text-xs">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 rounded"
                title="缩小"
                onClick={handleZoomOut}
              >
                <ZoomOut className="size-3.5" />
              </Button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-1.5 text-[10.5px] font-mono hover:text-foreground cursor-pointer"
                title="重置缩放"
              >
                {zoomLevel}%
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 rounded"
                title="放大"
                onClick={handleZoomIn}
              >
                <ZoomIn className="size-3.5" />
              </Button>
            </div>

            {/* 复制代码 */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 px-2.5"
              onClick={handleCopyMermaid}
              title="复制 Mermaid 语法源码"
            >
              {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              <span>{copied ? '已复制' : '源码'}</span>
            </Button>

            {/* 导出 SVG */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 px-2.5"
              onClick={handleExportSvg}
              title="导出高清矢量 SVG"
            >
              <Download className="size-3" />
              <span>SVG</span>
            </Button>

            {/* 关闭按钮 */}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg hover:text-foreground ml-1"
              onClick={onClose}
              title="关闭弹窗 (Esc)"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* 弹窗内容区：带缩放平移与图表完整卡片 */}
        <div
          id="diagram-modal-body"
          className="p-6 overflow-auto flex-1 transition-transform duration-100"
          style={{
            transform: zoomLevel !== 100 ? `scale(${zoomLevel / 100})` : undefined,
            transformOrigin: 'top center',
          }}
        >
          <DiagramViewerCard
            payload={diagram}
            onHighlightAnchor={onHighlightAnchor}
            onPinToDoc={onPinToDoc}
          />
        </div>
      </div>
    </div>
  )
}
