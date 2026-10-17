import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Code2,
  Columns2,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  Moon,
  RefreshCw,
  Sun,
  SunMoon,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDocumentReader } from '@/hooks/agent/useDocumentReader'
import { appApi } from '@/api/app-api'
import { fileApi } from '@/api/file-api'
import { isOk } from '@yitom/contracts'
import { toast } from 'sonner'
import { useEditorUiStore, type AppTheme } from '@/stores/editor-ui-store'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import {
  extractLocalImageRefsFromHtml,
  replaceImageSrcInHtml,
} from '@/lib/editor/markdown-images'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  keymap,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { html } from '@codemirror/lang-html'
import { buildThemeExtensions } from '@/lib/editor/codemirror-theme'

export type HtmlViewMode = 'preview' | 'split' | 'source'
export type HtmlPreviewTheme = 'auto' | 'light' | 'dark'

interface HtmlViewerProps {
  filePath: string
  content: string
  onChange?: (newContent: string) => void
  readOnly?: boolean
  className?: string
}

interface HtmlSourceEditorProps {
  value: string
  onChange?: (val: string) => void
  readOnly?: boolean
  theme: AppTheme
}

/** CodeMirror 6 驱动的 HTML 源代码高亮编辑器 */
const HtmlSourceEditor = memo(function HtmlSourceEditor({
  value,
  onChange,
  readOnly = false,
  theme,
}: HtmlSourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isInternalChangeRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        foldGutter(),
        indentOnInput(),
        html(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        buildThemeExtensions(theme, 13),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isInternalChangeRef.current) {
            const next = update.state.doc.toString()
            onChangeRef.current?.(next)
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [readOnly, theme])

  // 外部值变化时同步回编辑器（例如重新加载、撤销）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentDoc = view.state.doc.toString()
    if (currentDoc !== value) {
      isInternalChangeRef.current = true
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      })
      isInternalChangeRef.current = false
    }
  }, [value])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-[var(--editor)] [&_.cm-editor]:h-full [&_.cm-scroller]:h-full"
    />
  )
})

export const HtmlViewer = memo(function HtmlViewer({
  filePath,
  content,
  onChange,
  readOnly = false,
  className,
}: HtmlViewerProps) {
  const appTheme = useEditorUiStore((state) => state.theme)
  const [viewMode, setViewMode] = useState<HtmlViewMode>('preview')
  const [previewTheme, setPreviewTheme] = useState<HtmlPreviewTheme>('auto')
  const [zoom, setZoom] = useState(100)
  const [reloadKey, setReloadKey] = useState(0)
  const [isReloading, setIsReloading] = useState(false)

  // 预览防抖值（避免在 split 模式打字时频繁全量刷新 iframe）
  const [debouncedContent, setDebouncedContent] = useState(content)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedContent(content)
    }, 200)
    return () => clearTimeout(timer)
  }, [content])

  // 本地图片解析与 Base64 缓存映射
  const imageRefs = useMemo(() => {
    return extractLocalImageRefsFromHtml(debouncedContent, filePath)
  }, [debouncedContent, filePath])

  const imageDataCacheRef = useRef<Map<string, string>>(new Map())
  const [, setImageCacheTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function resolveLocalImages() {
      let updated = false
      for (const ref of imageRefs) {
        if (!imageDataCacheRef.current.has(ref.absolutePath)) {
          const res = await fileApi.readImage(ref.absolutePath)
          if (cancelled) return
          if (isOk(res)) {
            imageDataCacheRef.current.set(ref.absolutePath, res.value.dataUrl)
            updated = true
          }
        }
      }
      if (updated && !cancelled) {
        setImageCacheTick((v) => v + 1)
      }
    }
    void resolveLocalImages()
    return () => {
      cancelled = true
    }
  }, [imageRefs])

  // 将相对图片替换为 DataUrl，并注入可选的主题覆盖 CSS
  const renderedDoc = useMemo(() => {
    const replacements: Record<string, string> = {}
    for (const ref of imageRefs) {
      const dataUrl = imageDataCacheRef.current.get(ref.absolutePath)
      if (dataUrl) {
        replacements[ref.src] = dataUrl
      }
    }
    const htmlWithImages = replaceImageSrcInHtml(debouncedContent, replacements)

    if (previewTheme === 'auto') {
      return htmlWithImages
    }

    const themeStyle =
      previewTheme === 'dark'
        ? `
<style id="montree-theme-override">
  :root { color-scheme: dark; }
  html, body {
    background-color: #121214 !important;
    color: #e4e4e7 !important;
  }
  a { color: #60a5fa !important; }
</style>`
        : `
<style id="montree-theme-override">
  :root { color-scheme: light; }
  html, body {
    background-color: #ffffff !important;
    color: #18181b !important;
  }
  a { color: #2563eb !important; }
</style>`

    if (htmlWithImages.includes('</head>')) {
      return htmlWithImages.replace('</head>', `${themeStyle}\n</head>`)
    }
    return `${themeStyle}\n${htmlWithImages}`
  }, [debouncedContent, imageRefs, previewTheme])

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const sourceBody = useMemo(() => {
    const doc = new DOMParser().parseFromString(content, 'text/html')
    doc.querySelectorAll('script, style, template').forEach((element) => element.remove())
    return doc.body
  }, [content])
  useDocumentReader({ filePath, root: () => iframeRef.current?.contentDocument?.body ?? sourceBody })

  // 应用缩放并拦截外部链接安全跳转
  const handleIframeLoad = useCallback(() => {
    setIsReloading(false)
    const doc = iframeRef.current?.contentDocument
    if (!doc) return

    if (doc.body) {
      doc.body.style.zoom = `${zoom}%`
    }

    doc.addEventListener(
      'click',
      (e) => {
        const anchor = (e.target as Element | null)?.closest('a')
        if (!anchor) return
        const href = anchor.getAttribute('href')
        if (!href) return

        if (href.startsWith('#')) return // 页面内锚点跳转

        if (
          href.startsWith('http://') ||
          href.startsWith('https://') ||
          href.startsWith('mailto:') ||
          href.startsWith('tel:')
        ) {
          e.preventDefault()
          e.stopPropagation()
          void appApi.openExternal(href)
        }
      },
      { capture: true },
    )
  }, [zoom])

  // 缩放变化时动态同步已加载的 iframe
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc?.body) {
      doc.body.style.zoom = `${zoom}%`
    }
  }, [zoom])

  const handleRefresh = useCallback(() => {
    setIsReloading(true)
    setReloadKey((k) => k + 1)
  }, [])

  const handleOpenExternal = useCallback(() => {
    if (filePath) {
      void appApi.openExternal(filePath)
      toast.info('已在系统默认浏览器中打开')
    }
  }, [filePath])

  const handleCopySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success('已复制 HTML 源代码')
    } catch {
      toast.error('复制失败')
    }
  }, [content])

  const fileName = useMemo(() => {
    return filePath.split(/[/\\]/).pop() || 'document.html'
  }, [filePath])

  const renderIframe = () => (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <iframe
        ref={iframeRef}
        key={reloadKey}
        title="HTML Preview"
        srcDoc={renderedDoc}
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
        className="h-full w-full border-0 bg-transparent"
        onLoad={handleIframeLoad}
      />
    </div>
  )

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', className)}>
      {/* 顶部工具栏 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/80 bg-background/95 px-3 backdrop-blur-xs select-none">
        {/* 左侧：文件信息与视图模式切换 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Globe className="size-4 text-orange-500 shrink-0" />
            <span className="max-w-[240px] truncate text-xs font-medium text-foreground/90">
              {fileName}
            </span>
          </div>

          <div className="flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5">
            <Button
              type="button"
              variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
              size="icon-xs"
              className={cn(
                'h-6 gap-1 px-2 text-xs font-normal',
                viewMode === 'preview' && 'bg-background shadow-xs font-medium',
              )}
              onClick={() => setViewMode('preview')}
              title="仅预览模式"
            >
              <Eye className="size-3.5" />
              <span>预览</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === 'split' ? 'secondary' : 'ghost'}
              size="icon-xs"
              className={cn(
                'h-6 gap-1 px-2 text-xs font-normal',
                viewMode === 'split' && 'bg-background shadow-xs font-medium',
              )}
              onClick={() => setViewMode('split')}
              title="分屏对照模式"
            >
              <Columns2 className="size-3.5" />
              <span>分屏</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === 'source' ? 'secondary' : 'ghost'}
              size="icon-xs"
              className={cn(
                'h-6 gap-1 px-2 text-xs font-normal',
                viewMode === 'source' && 'bg-background shadow-xs font-medium',
              )}
              onClick={() => setViewMode('source')}
              title="源代码模式"
            >
              <Code2 className="size-3.5" />
              <span>源码</span>
            </Button>
          </div>
        </div>

        {/* 右侧：预览控制、缩放、主题与操作按键 */}
        <div className="flex items-center gap-1.5">
          {viewMode !== 'source' && (
            <>
              {/* 预览主题切换 */}
              <div className="flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5">
                <Button
                  type="button"
                  variant={previewTheme === 'auto' ? 'secondary' : 'ghost'}
                  size="icon-xs"
                  className={cn(
                    'h-6 w-6',
                    previewTheme === 'auto' && 'bg-background shadow-xs',
                  )}
                  onClick={() => setPreviewTheme('auto')}
                  title="原色模式（保留网页自带样式）"
                >
                  <SunMoon className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant={previewTheme === 'light' ? 'secondary' : 'ghost'}
                  size="icon-xs"
                  className={cn(
                    'h-6 w-6',
                    previewTheme === 'light' && 'bg-background shadow-xs',
                  )}
                  onClick={() => setPreviewTheme('light')}
                  title="亮色模式"
                >
                  <Sun className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant={previewTheme === 'dark' ? 'secondary' : 'ghost'}
                  size="icon-xs"
                  className={cn(
                    'h-6 w-6',
                    previewTheme === 'dark' && 'bg-background shadow-xs',
                  )}
                  onClick={() => setPreviewTheme('dark')}
                  title="暗色护眼模式"
                >
                  <Moon className="size-3.5" />
                </Button>
              </div>

              {/* 页面缩放控制 */}
              <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setZoom((z) => Math.max(50, z - 10))}
                  disabled={zoom <= 50}
                  title="缩小"
                >
                  <ZoomOut className="size-3.5" />
                </Button>
                <button
                  type="button"
                  onClick={() => setZoom(100)}
                  className="h-6 px-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground"
                  title="重置缩放 100%"
                >
                  {zoom}%
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setZoom((z) => Math.min(200, z + 10))}
                  disabled={zoom >= 200}
                  title="放大"
                >
                  <ZoomIn className="size-3.5" />
                </Button>
              </div>

              {/* 重新加载 */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleRefresh}
                title="重新加载"
              >
                <RefreshCw className={cn('size-3.5', isReloading && 'animate-spin')} />
              </Button>
            </>
          )}

          {/* 复制源码 */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => void handleCopySource()}
            title="复制 HTML 源码"
          >
            <Copy className="size-3.5" />
          </Button>

          {/* 默认浏览器打开 */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleOpenExternal}
            title="在系统默认浏览器中打开"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 主工作区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {viewMode === 'preview' ? (
          renderIframe()
        ) : viewMode === 'source' ? (
          <HtmlSourceEditor
            value={content}
            onChange={onChange}
            readOnly={readOnly}
            theme={appTheme}
          />
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0">
            <ResizablePanel defaultSize={50} minSize={25} className="min-w-0">
              <HtmlSourceEditor
                value={content}
                onChange={onChange}
                readOnly={readOnly}
                theme={appTheme}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={25} className="min-w-0">
              {renderIframe()}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  )
})
