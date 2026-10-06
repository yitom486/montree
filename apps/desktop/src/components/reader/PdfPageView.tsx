import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { PDFDocumentProxy, PageViewport, RenderTask } from 'pdfjs-dist'
import {
  createPdfPageViewport,
  isPdfRenderCancelled,
} from '@/lib/reader/pdf/pdf-render'
import { findPdfMarksAtPoint, renderPdfMarkOverlays } from '@/lib/reader/marks/pdf-reading-marks'
import { emitRailFocus } from '@/lib/reader/rail-follow'
import {
  loadPdfTextLayerBuilder,
  type PdfTextLayerBuilderInstance,
} from '@/lib/reader/pdf/pdf-text-layer-builder'
import { mountOcrTextLayer } from '@/lib/reader/pdf-ocr/pdf-ocr-text-layer'
import { pageHasNativeText } from '@montree/ocr-core'
import type { PdfOcrPageCache } from '@montree/contracts'
import {
  PdfTextLayerMappingSink,
  registerPdfPageTextGeometry,
  type PdfSelectionSnapshot,
} from '@montree/reader-core'
import { reportAppError } from '@/lib/workspace/report-error'
import type { ReadingMark } from '@montree/contracts'

import type { AppTheme } from '@/stores/editor-ui-store'

interface PdfPageViewProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  theme: AppTheme
  marks: ReadingMark[]
  ocrPageCache?: PdfOcrPageCache | null
  /** W3：无原生层又无词缓存时通知调用方（由调用方决定是否自动识别本页） */
  onWordLayerMissing?: (pageNumber: number) => void
  transientSelection?: PdfSelectionSnapshot | null
  onMouseUp?: (pageNumber: number, pageElement: HTMLElement, point: { clientX: number; clientY: number }) => void
  onPointerOrigin?: (x: number, y: number) => void
}

export function PdfPageView({
  pdf,
  pageNumber,
  scale,
  theme,
  marks,
  ocrPageCache,
  onWordLayerMissing,
  transientSelection,
  onMouseUp,
  onPointerOrigin,
}: PdfPageViewProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const textLayerHostRef = useRef<HTMLDivElement>(null)
  const marksLayerRef = useRef<SVGSVGElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const geometryDisposeRef = useRef<(() => void) | null>(null)
  const committedSourceRef = useRef<{ pdf: PDFDocumentProxy; pageNumber: number } | null>(null)
  // 回调 ref 化：识别触发不引起渲染 effect 重跑（缓存到达后条件自然为假）
  const onWordLayerMissingRef = useRef(onWordLayerMissing)
  useEffect(() => {
    onWordLayerMissingRef.current = onWordLayerMissing
  }, [onWordLayerMissing])
  const [rendering, setRendering] = useState(true)
  const [hasCommittedPage, setHasCommittedPage] = useState(false)
  const [pageViewport, setPageViewport] = useState<PageViewport | null>(null)

  useEffect(() => {
    const canvasHost = canvasHostRef.current
    const textLayerHost = textLayerHostRef.current
    const pageRoot = wrapperRef.current
    if (!canvasHost || !textLayerHost || !pageRoot) return

    let cancelled = false
    let renderTask: RenderTask | null = null
    let textLayerBuilder: PdfTextLayerBuilderInstance | null = null
    const keepsCurrentPage =
      committedSourceRef.current?.pdf === pdf && committedSourceRef.current.pageNumber === pageNumber
    setRendering(true)
    if (!keepsCurrentPage) setHasCommittedPage(false)
    const textLayerBuilderClassPromise = loadPdfTextLayerBuilder()

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return

        const { cssViewport, cssWidth, cssHeight, canvasWidth, canvasHeight, transform } =
          createPdfPageViewport(page, scale)
        const textContentPromise = page.getTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        })

        // 缩放时保留上一帧可见页面；新 canvas 在脱离 DOM 的状态下完成绘制后才替换。
        // 初次加载或切换文档没有可复用页面，先给容器一个正确的占位尺寸。
        if (!keepsCurrentPage) {
          pageRoot.style.setProperty('--scale-factor', String(cssViewport.scale))
          pageRoot.style.setProperty('--user-unit', String(cssViewport.userUnit))
          pageRoot.style.width = `${cssWidth}px`
          pageRoot.style.height = `${cssHeight}px`
        }

        const canvas = document.createElement('canvas')
        canvas.width = canvasWidth
        canvas.height = canvasHeight
        canvas.style.width = '100%'
        canvas.style.height = '100%'

        const context = canvas.getContext('2d', { alpha: false })
        if (!context) return
        context.setTransform(1, 0, 0, 1, 0, 0)

        renderTask = page.render({
          canvasContext: context,
          viewport: cssViewport,
          transform,
          canvas,
          background: '#ffffff',
        })
        await renderTask.promise
        renderTask = null
        if (cancelled) return

        const TextLayerBuilder = await textLayerBuilderClassPromise
        if (cancelled) return
        const textMapping = new PdfTextLayerMappingSink()
        let renderedTextLayer: HTMLDivElement | null = null
        textLayerBuilder = new TextLayerBuilder({
          pdfPage: page,
          // TextLayerBuilder 仅通过这三个公开方法使用 highlighter；这里借该 hook 记录 item 映射。
          highlighter: textMapping,
          onAppend: (textLayer: HTMLDivElement) => {
            renderedTextLayer = textLayer
          },
        })
        textLayerBuilder.div.setAttribute('aria-hidden', 'false')
        await textLayerBuilder.render({
          viewport: cssViewport,
          // 与官方 PDFPageView 一致：未启用文字层图片占位时传 null。
          images: null,
        })
        const completedTextLayerBuilder = textLayerBuilder
        textLayerBuilder = null
        if (cancelled) return
        const textContent = await textContentPromise
        if (cancelled) return

        const nativeCharCount = textContent.items.reduce((sum, item) => {
          const str = 'str' in item && typeof item.str === 'string' ? item.str : ''
          return sum + str.replace(/\s/g, '').length
        }, 0)
        const useOcrLayer = !pageHasNativeText(nativeCharCount) && !!ocrPageCache?.words.length
        // W3：无原生层又无词缓存 → 上报，调用方按门控自动识别（本组件不直接 OCR）
        if (!pageHasNativeText(nativeCharCount) && !ocrPageCache?.words.length) {
          onWordLayerMissingRef.current?.(pageNumber)
        }

        pageRoot.style.setProperty('--scale-factor', String(cssViewport.scale))
        pageRoot.style.setProperty('--user-unit', String(cssViewport.userUnit))
        pageRoot.style.width = `${cssWidth}px`
        pageRoot.style.height = `${cssHeight}px`
        canvasHost.replaceChildren(canvas)

        geometryDisposeRef.current?.()
        if (useOcrLayer && ocrPageCache) {
          completedTextLayerBuilder.cancel()
          geometryDisposeRef.current = mountOcrTextLayer(
            textLayerHost,
            pageRoot,
            cssViewport,
            ocrPageCache,
          )
        } else {
          textLayerHost.replaceChildren(renderedTextLayer ?? completedTextLayerBuilder.div)
          geometryDisposeRef.current = registerPdfPageTextGeometry(pageRoot, cssViewport, textContent)
        }

        committedSourceRef.current = { pdf, pageNumber }
        setPageViewport(cssViewport)
        setHasCommittedPage(true)
      } catch (cause) {
        if (!cancelled && !isPdfRenderCancelled(cause)) {
          reportAppError({
            code: 'FILE_READ_ERROR',
            message: cause instanceof Error ? cause.message : 'PDF 渲染失败',
          })
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayerBuilder?.cancel()
    }
  }, [ocrPageCache, pageNumber, pdf, scale])

  useEffect(() => {
    return () => {
      geometryDisposeRef.current?.()
      geometryDisposeRef.current = null
    }
  }, [])

  useEffect(() => {
    const marksLayer = marksLayerRef.current
    if (!marksLayer || !pageViewport) return
    renderPdfMarkOverlays(
      marksLayer,
      marks,
      pageNumber,
      theme,
      pageViewport,
      transientSelection,
      wrapperRef.current,
    )
  }, [marks, pageNumber, pageViewport, theme, transientSelection])

  return (
    <div
      ref={wrapperRef}
      className="pdf-page-wrapper relative shadow-md"
      data-page={pageNumber}
      onMouseDown={(event) => onPointerOrigin?.(event.clientX, event.clientY)}
      onClick={(event) => {
        // 点击高亮标记 → 卡片轨滚动到对应卡并闪现（反向联动）；拖选文字走正常流程
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed) return
        const pageElement = wrapperRef.current
        if (!pageElement) return
        const hit = findPdfMarksAtPoint(marks, pageNumber, event.clientX, event.clientY, pageElement)
        if (hit.length > 0) emitRailFocus(hit[0]!.id)
      }}
      onMouseUp={(event) => {
        const pageElement = wrapperRef.current
        if (pageElement) onMouseUp?.(pageNumber, pageElement, event)
      }}
    >
      {rendering && !hasCommittedPage ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-white/90 dark:bg-zinc-800/90">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}
      <div ref={canvasHostRef} className="pdf-canvas-host" />
      <div ref={textLayerHostRef} className="pdf-text-layer-host" />
      <svg ref={marksLayerRef} className="pdf-marks-layer" aria-hidden="true" />
    </div>
  )
}
