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
import { resolveLocalLink, takeLocalAnchor } from '@/lib/workspace/resolve-local-link'
import { readHtmlReaderContent } from '@/lib/html/reader-content'
import {
  clearReaderSelection,
  commitReaderSelection,
  registerSelectionProvider,
} from '@/lib/agent/context/reader-selection-registry'
import { htmlPreviewApi } from '@/api/html-preview-api'
import {
  HTML_PREVIEW_BRIDGE_CHANNEL,
  type HtmlPreviewFrameMessage,
  type HtmlPreviewHostMessage,
  type HtmlPreviewRegistration,
} from '../../../contracts/html-preview'

export type HtmlViewMode = 'preview' | 'split' | 'source'
export type HtmlPreviewTheme = 'auto' | 'light' | 'dark'

interface HtmlViewerProps {
  filePath: string
  content: string
  onChange?: (newContent: string) => void
  /** 打开文档内的相对本地链接（由工作区统一处理未保存确认/文件切换） */
  onOpenLocalFile?: (path: string, anchor?: string) => void
  readOnly?: boolean
  className?: string
}

interface HtmlSourceEditorProps {
  value: string
  onChange?: (val: string) => void
  readOnly?: boolean
  theme: AppTheme
}

/** 解析为惰性文档（不执行脚本、不加载资源），并剔除脚本/样式/模板，供阅读正文提取。 */
function parseInertBody(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, template').forEach((element) => element.remove())
  return doc.body
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
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
  onOpenLocalFile,
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
  // 记录防抖值所属文件：切换文件时立即同步，避免新文件的预览会话先加载旧文件内容（会提前消费跨文件锚点）
  const [debounced, setDebounced] = useState({ filePath, content })
  useEffect(() => {
    if (debounced.filePath !== filePath) {
      setDebounced({ filePath, content })
      return
    }
    const timer = setTimeout(() => {
      setDebounced({ filePath, content })
    }, 200)
    return () => clearTimeout(timer)
  }, [content, filePath, debounced.filePath])
  const debouncedContent = debounced.content

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

  // 预览页在 montree-html:// 独立源中运行，宿主拿不到它的 DOM：缩放/锚点/链接/阅读正文全部经桥接 postMessage。
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const sourceBody = useMemo(() => parseInertBody(content), [content])
  /** 桥接推来的渲染后正文（隐藏节点已标 hidden、脚本样式已剔除）与视口文本 */
  const snapshotRef = useRef<{ body: HTMLElement; viewport: string } | null>(null)
  const selectionRef = useRef('')

  // 阅读 MCP 以已渲染 DOM 快照为准；源码树只作为预览尚未就绪/源码模式的后备。
  const readerRoot = useCallback((): HTMLElement => {
    const snapshot = viewModeRef.current !== 'source' ? snapshotRef.current : null
    return snapshot && snapshot.body.childNodes.length > 0 ? snapshot.body : sourceBody
  }, [sourceBody])
  const readHtmlContent = useCallback(() => readHtmlReaderContent(readerRoot()), [readerRoot])
  useDocumentReader({
    filePath,
    root: readerRoot,
    text: () => readHtmlContent().text,
    units: () => readHtmlContent().units,
    viewportText: () =>
      (viewModeRef.current !== 'source' ? snapshotRef.current?.viewport : undefined) ?? readHtmlContent().text,
    selectionManaged: true,
  })

  useEffect(() => {
    selectionRef.current = ''
    const dispose = registerSelectionProvider({
      filePath,
      getSelectionText: () => (viewModeRef.current !== 'source' && selectionRef.current) || null,
    })
    return () => {
      dispose()
      clearReaderSelection()
    }
  }, [filePath])

  // 每个文件一个预览会话；主文档由下方推送当前文本（含未保存修改），iframe 以版本号重新加载
  const [preview, setPreview] = useState<HtmlPreviewRegistration | null>(null)
  useEffect(() => {
    let disposed = false
    let token: string | null = null
    setPreview(null)
    snapshotRef.current = null
    htmlPreviewApi
      .register(filePath)
      .then((registration) => {
        if (disposed) {
          void htmlPreviewApi.release(registration.token)
          return
        }
        token = registration.token
        setPreview(registration)
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'HTML 预览初始化失败'))
    return () => {
      disposed = true
      if (token) void htmlPreviewApi.release(token)
    }
  }, [filePath])

  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const frameVersionRef = useRef(0)
  useEffect(() => {
    if (!preview) {
      setFrameSrc(null)
      return
    }
    if (debounced.filePath !== filePath) return
    let cancelled = false
    htmlPreviewApi
      .update(preview.token, renderedDoc)
      .then(() => {
        if (!cancelled) setFrameSrc(`${preview.url}&v=${++frameVersionRef.current}`)
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'HTML 预览刷新失败')
      })
    return () => {
      cancelled = true
    }
  }, [preview, renderedDoc, reloadKey, debounced.filePath, filePath])

  const postToFrame = useCallback((message: HtmlPreviewHostMessage) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  // 链接请求来自不可信页面：只放行用户刚点击过（父窗口带瞬时激活）的跳转，且只做受限动作
  const openLink = useCallback(
    (href: string) => {
      if (navigator.userActivation && !navigator.userActivation.isActive) return
      // 相对链接按当前文件解析；不在预览框内自行导航，跨文件交给工作区统一打开。
      const localTarget = resolveLocalLink(filePath, href)
      if (localTarget) {
        const rawHash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : ''
        if (localTarget === filePath) {
          if (rawHash) postToFrame({ channel: HTML_PREVIEW_BRIDGE_CHANNEL, type: 'anchor', id: safeDecode(rawHash) })
          return
        }
        if (onOpenLocalFile) onOpenLocalFile(localTarget, rawHash || undefined)
        else toast.error('当前 HTML 视图无法打开该本地链接')
        return
      }
      const external = href.startsWith('//') ? `https:${href}` : href
      if (/^(?:https?|mailto|tel):/i.test(external)) void appApi.openExternal(external)
    },
    [filePath, onOpenLocalFile, postToFrame],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow
      if (!frame || event.source !== frame) return
      const data = event.data as Partial<HtmlPreviewFrameMessage> | null
      if (!data || data.channel !== HTML_PREVIEW_BRIDGE_CHANNEL) return
      if (data.type === 'link' && typeof data.href === 'string') {
        openLink(data.href)
      } else if (data.type === 'snapshot' && typeof data.html === 'string') {
        snapshotRef.current = {
          body: parseInertBody(data.html),
          viewport: typeof data.viewport === 'string' ? data.viewport : '',
        }
      } else if (data.type === 'viewport' && typeof data.viewport === 'string') {
        if (snapshotRef.current) snapshotRef.current.viewport = data.viewport
      } else if (data.type === 'selection' && typeof data.text === 'string') {
        selectionRef.current = data.text
        if (data.commit && data.text.trim()) commitReaderSelection(filePath, data.text)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [filePath, openLink])

  // 先同步缩放再滚到跨文件跳转带来的锚点，顺序与桥接处理顺序一致
  const handleIframeLoad = useCallback(() => {
    setIsReloading(false)
    postToFrame({ channel: HTML_PREVIEW_BRIDGE_CHANNEL, type: 'zoom', zoom: zoomRef.current })
    const pendingAnchor = takeLocalAnchor(filePath)
    if (pendingAnchor) {
      postToFrame({ channel: HTML_PREVIEW_BRIDGE_CHANNEL, type: 'anchor', id: safeDecode(pendingAnchor) })
    }
  }, [filePath, postToFrame])

  useEffect(() => {
    postToFrame({ channel: HTML_PREVIEW_BRIDGE_CHANNEL, type: 'zoom', zoom })
  }, [zoom, postToFrame])

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
      {frameSrc ? (
        // allow-same-origin 保留的是预览页自己的 montree-html:// 源（存储、相对资源照常可用），与应用窗口天然跨源
        <iframe
          ref={iframeRef}
          title="HTML Preview"
          src={frameSrc}
          sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
          className="h-full w-full border-0 bg-transparent"
          onLoad={handleIframeLoad}
        />
      ) : null}
    </div>
  )

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', className)}>
      {/* 顶部工具栏 */}
      <div data-testid="html-viewer-toolbar" className="@container flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/80 bg-background/95 px-3 backdrop-blur-xs select-none">
        {/* 左侧：文件信息与视图模式切换；窄面板隐藏重复文件名，避免与右侧控制重叠 */}
        <div data-testid="html-viewer-toolbar-left" className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 items-center gap-2 @max-[38rem]:hidden">
            <Globe className="size-4 text-orange-500 shrink-0" />
            <span className="max-w-[240px] truncate text-xs font-medium text-foreground/90">
              {fileName}
            </span>
          </div>

          <div className="flex shrink-0 items-center rounded-md border border-border/60 bg-muted/40 p-0.5">
            <Button
              type="button"
              variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
              size="xs"
              className={cn(
                'font-normal',
                viewMode === 'preview' && 'bg-background shadow-xs font-medium',
              )}
              onClick={() => setViewMode('preview')}
              title="仅预览模式"
            >
              <Eye className="size-3.5" />
              <span className="@max-[22rem]:hidden">预览</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === 'split' ? 'secondary' : 'ghost'}
              size="xs"
              className={cn(
                'font-normal',
                viewMode === 'split' && 'bg-background shadow-xs font-medium',
              )}
              onClick={() => setViewMode('split')}
              title="分屏对照模式"
            >
              <Columns2 className="size-3.5" />
              <span className="@max-[22rem]:hidden">分屏</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === 'source' ? 'secondary' : 'ghost'}
              size="xs"
              className={cn(
                'font-normal',
                viewMode === 'source' && 'bg-background shadow-xs font-medium',
              )}
              onClick={() => setViewMode('source')}
              title="源代码模式"
            >
              <Code2 className="size-3.5" />
              <span className="@max-[22rem]:hidden">源码</span>
            </Button>
          </div>
        </div>

        {/* 右侧：预览控制、缩放、主题与操作按键 */}
        <div data-testid="html-viewer-toolbar-right" className="flex shrink-0 items-center gap-1.5">
          {viewMode !== 'source' && (
            <>
              {/* 预览主题切换 */}
              <div className="flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5 @max-[30rem]:hidden">
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
              <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5 @max-[34rem]:hidden">
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
