import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { fileApi } from '@/api/file-api'
import { isOk } from '@montree/contracts'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { appApi } from '@/api/app-api'
import { Button } from '@/components/ui/button'
import {
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RefreshCw,
  Sun,
  Moon,
  Coffee,
  ExternalLink,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface DocxViewerProps {
  filePath: string
  className?: string
}

export type DocxPaperTheme = 'auto' | 'dark' | 'sepia' | 'print'

export function DocxViewer({ filePath, className }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appTheme = useEditorUiStore((state) => state.theme)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(100)
  const [paperTheme, setPaperTheme] = useState<DocxPaperTheme>('auto')
  const [pageCount, setPageCount] = useState<number | null>(null)

  const loadAndRenderDocx = useCallback(async () => {
    if (!filePath || !containerRef.current) return
    setLoading(true)
    setError(null)

    try {
      const res = await fileApi.readBinaryFile(filePath)
      if (!isOk(res)) {
        setError(res.error.message || '无法读取 DOCX 文件')
        setLoading(false)
        return
      }

      // 清理前一次渲染的 DOM
      containerRef.current.innerHTML = ''

      // 创建文档专用的挂载子容器
      const mountNode = document.createElement('div')
      mountNode.className = 'docx-render-host'
      containerRef.current.appendChild(mountNode)

      // 纯前端高保真渲染
      await renderAsync(res.value.data.buffer, mountNode, undefined, {
        className: 'docx-document-wrapper',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        renderChanges: false,
        experimental: true,
      })

      // 统计分页数量
      const pages = mountNode.querySelectorAll('.docx-document-wrapper > section, .docx-document-wrapper > article')
      if (pages.length > 0) {
        setPageCount(pages.length)
      } else {
        setPageCount(null)
      }

      setLoading(false)
    } catch (err: unknown) {
      console.error('[DocxViewer] Render failed:', err)
      setError(err instanceof Error ? err.message : 'DOCX 文档解析失败')
      setLoading(false)
    }
  }, [filePath])

  useEffect(() => {
    void loadAndRenderDocx()
  }, [loadAndRenderDocx])

  const fileName = filePath.split(/[/\\]/).pop() ?? filePath

  // 计算最终呈现的纸张主题（默认 auto 跟随 Montree 全局主题）
  const effectiveTheme = paperTheme === 'auto' ? appTheme : paperTheme

  const cyclePaperTheme = () => {
    setPaperTheme((curr) => {
      if (curr === 'auto') return 'dark'
      if (curr === 'dark') return 'sepia'
      if (curr === 'sepia') return 'print'
      return 'auto'
    })
  }

  const handleOpenExternal = async () => {
    if (!filePath) return
    const fileUrl = filePath.startsWith('file://') ? filePath : `file:///${filePath.replace(/\\/g, '/')}`
    await appApi.openExternal(fileUrl)
  }

  // 根据当前生效主题计算高保真护眼滤镜
  const themeFilterClass = useMemo(() => {
    if (effectiveTheme === 'dark') {
      return '[filter:invert(0.88)_hue-rotate(180deg)_contrast(1.1)] [&_img]:[filter:invert(1)_hue-rotate(180deg)]'
    }
    if (effectiveTheme === 'sepia') {
      return '[filter:sepia(0.35)_contrast(0.95)_brightness(0.95)]'
    }
    return ''
  }, [effectiveTheme])

  const getThemeLabel = () => {
    if (paperTheme === 'auto') {
      return `跟随主题 (${effectiveTheme === 'dark' ? '暗黑护眼' : effectiveTheme === 'sepia' ? '麦香暖色' : '纸张白'})`
    }
    if (paperTheme === 'dark') return '暗黑护眼'
    if (paperTheme === 'sepia') return '麦香暖色'
    return '经典打印白'
  }

  return (
    <div className={cn('relative flex h-full w-full flex-col bg-background text-foreground', className)}>
      {/* 顶部现代化操作条 */}
      <div className="flex flex-wrap items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-xs backdrop-blur-sm">
        {/* 左侧：文件信息与分页 */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <FileText className="size-4 text-primary" />
            <span className="max-w-[240px] truncate" title={fileName}>
              {fileName}
            </span>
          </span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-primary">
            DOCX 视图
          </span>
          {pageCount && (
            <span className="text-[11px] text-muted-foreground">
              共 {pageCount} 页
            </span>
          )}
        </div>

        {/* 右侧：缩放控制、纸张主题、系统打开、刷新 */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => Math.max(50, z - 10))}
              title="缩小"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <ZoomOut className="size-3" />
            </Button>
            <span className="min-w-10 text-center font-mono text-[11px] text-foreground select-none">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => Math.min(200, z + 10))}
              title="放大"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <ZoomIn className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom(100)}
              title="恢复 100%"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
            </Button>
          </div>

          {/* 纸张主题切换 */}
          <Button
            variant="outline"
            size="xs"
            onClick={cyclePaperTheme}
            title="点击切换纸张主题：自动跟随 / 暗黑护眼 / 麦香暖色 / 原版打印白"
            className="h-7 gap-1 text-[11px]"
          >
            {effectiveTheme === 'dark' ? (
              <Moon className="size-3 text-primary" />
            ) : effectiveTheme === 'sepia' ? (
              <Coffee className="size-3 text-amber-500" />
            ) : (
              <Sun className="size-3 text-warning" />
            )}
            <span>{getThemeLabel()}</span>
          </Button>

          {/* 系统应用打开（无损深度编辑） */}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void handleOpenExternal()}
            title="在操作系统默认的 Microsoft Word 或 WPS 中打开并无损编辑"
            className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            <span>Word 中编辑</span>
          </Button>

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void loadAndRenderDocx()}
            title="重新渲染"
            disabled={loading}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* 核心渲染主区域 */}
      <div className="relative flex-1 overflow-auto bg-muted/20 p-4 md:p-8 montree-sheet-scroll">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-xs">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">正在高保真解析 Word 文档排版...</span>
          </div>
        )}

        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="size-8 text-destructive" />
            <div className="text-sm font-medium text-destructive">{error}</div>
            <Button variant="outline" size="sm" onClick={() => void loadAndRenderDocx()} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              重试加载
            </Button>
          </div>
        )}

        {/* 文档外层缩放与自适应滤镜容器 */}
        <div
          className="flex min-h-full items-start justify-center transition-all duration-150"
          style={{
            transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
            transformOrigin: 'top center',
          }}
        >
          <div
            ref={containerRef}
            className={cn(
              'docx-preview-container max-w-full rounded-md shadow-xl transition-all duration-200',
              themeFilterClass,
            )}
          />
        </div>
      </div>
    </div>
  )
}
