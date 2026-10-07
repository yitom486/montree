import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import { openPdfDocument } from '@/lib/reader/pdf/pdf-document'
import { loadPdfOutlineInfo, formatPdfOutlineNotice, type PdfOutlineSource } from '@montree/reader-core'
import { detectPdfDocumentProfile } from '@/lib/reader/pdf/pdf-scan-detector'
import { canUseOcrToc } from '@/lib/reader/pdf-ocr/pdf-ocr-toc-gate'
import { getPdfOcrToc, listPdfOcrPages, getPdfOcrPage } from '@/api/ocr-api'
import { assessPdfOcrTocCache } from '@montree/ocr-core'
import { noticeForRestoredCache, type OcrTocNotice } from '@/lib/reader/pdf-ocr/ocr-toc-notice'
import { loadPersistedOcrPageCaches } from '@/lib/reader/pdf-ocr/pdf-ocr-page-hydrate'
import { resolvePdfOcrPrefetchPages } from '@/lib/reader/pdf-ocr/pdf-ocr-prefetch'
import { shouldAutoOcrViewportPage } from '@/lib/reader/pdf-ocr/pdf-page-auto-ocr'
import {
  PDF_JUMP_SYNC_HOLD_MS,
  PDF_PAGE_GAP_PX,
  resolvePdfPageScrollTop,
  scalePdfPageCssSize,
  tocFromPdfUnits,
  resolvePdfChapterByPage,
  type PdfPageCssSize,
  type ReaderUnit,
} from '@montree/reader-core'
import { useReadingProgressStore } from '@/stores/reading-progress-store'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { pdfStructureClient } from '@/lib/reader/pdf/pdf-structure-client'
import { pdfInspectorClient } from '@/lib/reader/pdf/pdf-inspector-client'
import { reportAppError } from '@/lib/workspace/report-error'
import { isLiveLoadSession, TocDocLifecycle } from '@/lib/reader/pdf-ocr/ocr-toc-op'
import type { OcrTocEntry } from '@montree/contracts'
import type { usePdfPageOcr } from '@/hooks/reader/usePdfPageOcr'
import { usePdfRosettaIndex } from '@/components/reader/pdf/usePdfRosettaIndex'
import { usePdfAgentRegistry } from '@/components/reader/pdf/usePdfAgentRegistry'

export interface UsePdfDocumentSessionOptions {
  filePath: string
  fileFingerprint: string
  data: { data: Uint8Array } | null | undefined
  containerRef: React.RefObject<HTMLDivElement | null>
  pageAnchorRefs: React.RefObject<Map<number, HTMLDivElement>>
  tocLifecycleRef: React.RefObject<TocDocLifecycle | null>
  pdfPageOcr: ReturnType<typeof usePdfPageOcr>
  setOcrBannerDismissed: (val: boolean) => void
  setBookmarkSlimDismissed: (val: boolean) => void
  setOcrTocEditorOpen: (val: boolean) => void
  setOcrTocEditMode: (val: boolean) => void
  setOcrTocEntries: (entries: OcrTocEntry[]) => void
  setOcrTocNotice: (notice: OcrTocNotice | null) => void
  setTocPageFrom: (page: number) => void
  setTocPageTo: (page: number) => void
  setTocPageOffset: (offset: number) => void
  setTocOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  ocrTocEntries: OcrTocEntry[]
  tocPageOffset: number
  handleOpenOcrTocEditor: () => void
  handleClearOcrCache: () => Promise<void>
}

export function usePdfDocumentSession({
  filePath,
  fileFingerprint,
  data,
  containerRef,
  pageAnchorRefs,
  tocLifecycleRef,
  pdfPageOcr,
  setOcrBannerDismissed,
  setBookmarkSlimDismissed,
  setOcrTocEditorOpen,
  setOcrTocEditMode,
  setOcrTocEntries,
  setOcrTocNotice,
  setTocPageFrom,
  setTocPageTo,
  setTocPageOffset,
  setTocOpen,
  ocrTocEntries,
  tocPageOffset,
  handleOpenOcrTocEditor,
  handleClearOcrCache,
}: UsePdfDocumentSessionOptions) {
  const {
    ocrPageCaches,
    ocrPageCachesRef,
    ocrPageRecognizing,
    currentPageOcrReady,
    currentPageOcrBusy,
    ocrRecognizedCount,
    runPageOcr,
    readPageText,
    handleRecognizePage,
    hasPendingPageOcr,
    hydratePageCaches,
    resetPageOcr,
  } = pdfPageOcr

  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const ignoreScrollSyncRef = useRef(false)
  const pendingJumpPageRef = useRef<number | null>(null)
  const jumpSettleCancelRef = useRef<(() => void) | null>(null)
  const scrollSyncReleaseTimerRef = useRef<number | null>(null)
  const pageNumRef = useRef(1)
  const savePdfProgressTimerRef = useRef<number | null>(null)

  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [pageCssSize, setPageCssSize] = useState<PdfPageCssSize>({ width: 612, height: 792 })
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)

  const [outlineUnits, setOutlineUnits] = useState<ReaderUnit[]>([])
  const [outlineSource, setOutlineSource] = useState<PdfOutlineSource | 'ocr'>('page-fallback')
  const [outlineNotice, setOutlineNotice] = useState<string | undefined>()
  const [isScannedPdf, setIsScannedPdf] = useState(false)
  const [isMixedPdf, setIsMixedPdf] = useState(false)

  const ready = numPages > 0 && pdfDoc !== null
  const pageNumbers = useMemo(
    () => Array.from({ length: numPages }, (_, index) => index + 1),
    [numPages],
  )

  const hasChapterToc = outlineSource === 'embedded' || outlineSource === 'ocr'
  const pdfOcrBackgroundPrefetch = useAppSettingsStore((state) => state.pdfOcrBackgroundPrefetch)

  const marksToc = useMemo(() => tocFromPdfUnits(outlineUnits), [outlineUnits])
  const currentPdfChapter = useMemo(
    () => resolvePdfChapterByPage(pageNum, marksToc),
    [marksToc, pageNum],
  )

  useEffect(() => {
    pageNumRef.current = pageNum
  }, [pageNum])

  // Navigation store session
  useEffect(() => {
    useReaderNavigationStore.getState().beginSession(filePath, 'pdf')
    return () => {
      useReaderNavigationStore.getState().beginSession('', 'pdf')
    }
  }, [filePath])

  useEffect(() => {
    if (outlineUnits.length === 0) return
    useReaderNavigationStore.getState().setUnits(outlineUnits)
    useReaderNavigationStore.getState().syncPdf(outlineUnits, pageNum)
  }, [outlineUnits, pageNum])

  useEffect(() => {
    if (ready) {
      useReaderNavigationStore.getState().setReady(true)
    }
  }, [ready])

  // Reset on filePath / fileFingerprint change
  useLayoutEffect(() => {
    tocLifecycleRef.current?.switchDocument()
    setOutlineUnits([])
    setOutlineSource('page-fallback')
    setOutlineNotice(undefined)
    setIsScannedPdf(false)
    setIsMixedPdf(false)
    setBookmarkSlimDismissed(false)
  }, [filePath, fileFingerprint, setBookmarkSlimDismissed, tocLifecycleRef])

  // Missing word layer tracking
  const missingWordLayerRef = useRef<Set<number>>(new Set())

  // Viewport & Scrolling
  const scaledPageSize = useMemo(
    () => scalePdfPageCssSize(pageCssSize, scale),
    [pageCssSize, scale],
  )

  const holdScrollSync = useCallback((ms: number) => {
    ignoreScrollSyncRef.current = true
    if (scrollSyncReleaseTimerRef.current != null) {
      window.clearTimeout(scrollSyncReleaseTimerRef.current)
    }
    scrollSyncReleaseTimerRef.current = window.setTimeout(() => {
      ignoreScrollSyncRef.current = false
      scrollSyncReleaseTimerRef.current = null
    }, ms)
  }, [])

  const applyScrollToPage = useCallback(
    (
      targetPage: number,
      behavior: ScrollBehavior = 'auto',
      options?: { preferEstimate?: boolean; holdSyncMs?: number },
    ) => {
      const container = containerRef.current
      if (!container) return

      const anchor = pageAnchorRefs.current.get(targetPage)
      const top = resolvePdfPageScrollTop(
        targetPage,
        scaledPageSize.height,
        options?.preferEstimate ? null : (anchor?.offsetTop ?? null),
        PDF_PAGE_GAP_PX,
      )

      holdScrollSync(options?.holdSyncMs ?? (behavior === 'smooth' ? 420 : 80))

      if (behavior === 'auto') {
        container.scrollTop = top
      } else {
        container.scrollTo({ top, behavior })
      }
    },
    [containerRef, holdScrollSync, pageAnchorRefs, scaledPageSize.height],
  )

  const scrollToPage = useCallback(
    (targetPage: number, behavior: ScrollBehavior = 'smooth') => {
      setPageNum(targetPage)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          applyScrollToPage(targetPage, behavior)
        })
      })
    },
    [applyScrollToPage],
  )

  const jumpToPage = useCallback((targetPage: number) => {
    pendingJumpPageRef.current = targetPage
    setPageNum(targetPage)
  }, [])

  const goToFlatIndex = useCallback(
    (flatIndex: number) => {
      const unit = outlineUnits[flatIndex]
      if (!unit) return
      useReaderNavigationStore.getState().syncFlatIndex(flatIndex)
      const nextPage = Number.parseInt(unit.href, 10)
      if (Number.isFinite(nextPage) && nextPage >= 1) {
        jumpToPage(nextPage)
      }
    },
    [jumpToPage, outlineUnits],
  )

  const goToUnit = useCallback(
    (unit: ReaderUnit) => {
      const flatIndex = outlineUnits.findIndex(
        (item) => item.href === unit.href && item.label === unit.label,
      )
      if (flatIndex >= 0) {
        goToFlatIndex(flatIndex)
        return
      }
      const nextPage = Number.parseInt(unit.href, 10)
      if (Number.isFinite(nextPage) && nextPage >= 1) {
        jumpToPage(nextPage)
      }
    },
    [goToFlatIndex, jumpToPage, outlineUnits],
  )

  const goPrev = useCallback(() => {
    scrollToPage(Math.max(1, pageNum - 1), 'smooth')
  }, [pageNum, scrollToPage])

  const goNext = useCallback(() => {
    scrollToPage(Math.min(numPages, pageNum + 1), 'smooth')
  }, [numPages, pageNum, scrollToPage])

  const fitWidth = useCallback(() => {
    const pdf = pdfDocRef.current
    const container = containerRef.current
    if (!pdf || !container) return

    void (async () => {
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 1 })
      const nextScale = Math.max(0.5, (container.clientWidth - 48) / viewport.width)
      setScale(Number(nextScale.toFixed(2)))
      setPageCssSize({ width: viewport.width, height: viewport.height })
    })()
  }, [containerRef])

  useEffect(() => {
    fitWidth()
  }, [fitWidth, filePath, numPages])

  // Rosetta Index & Menu
  const rosetta = usePdfRosettaIndex({
    filePath,
    fileFingerprint,
    numPages,
    pageNum,
    outlineUnits,
    ocrTocEntries,
    tocPageOffset,
    isScannedPdf,
    isMixedPdf,
    outlineSource,
    ready,
    fitWidth,
    setScale,
    handleRecognizePage,
    handleOpenOcrTocEditor,
    handleClearOcrCache,
    currentPageOcrBusy,
    currentPageOcrReady,
    ocrRecognizedCount,
  })

  // Agent Content & Registry
  usePdfAgentRegistry({
    filePath,
    fileFingerprint,
    numPages,
    pageNumRef,
    pdfDocRef,
    isScannedPdf,
    isMixedPdf,
    data,
    rosettaImport: rosetta.rosettaImport,
    readPageText,
  })

  // Auto-OCR missing page
  const tryAutoOcrMissingPage = useCallback(() => {
    const current = pageNumRef.current
    if (ocrPageCachesRef.current[current]?.words.length) {
      missingWordLayerRef.current.delete(current)
      return
    }
    if (
      !shouldAutoOcrViewportPage({
        reportedMissing: missingWordLayerRef.current.has(current),
        isCurrentPage: true,
        hasCache: false,
        importRunning: rosetta.rosettaImport.state === 'running',
      })
    ) {
      return
    }
    if (hasPendingPageOcr(current)) return
    void runPageOcr(current).catch(() => {})
  }, [hasPendingPageOcr, ocrPageCachesRef, rosetta.rosettaImport.state, runPageOcr])

  const handleWordLayerMissing = useCallback(
    (missingPage: number) => {
      missingWordLayerRef.current.add(missingPage)
      tryAutoOcrMissingPage()
    },
    [tryAutoOcrMissingPage],
  )

  useEffect(() => {
    tryAutoOcrMissingPage()
  }, [pageNum, isScannedPdf, isMixedPdf, rosetta.rosettaImport.state, tryAutoOcrMissingPage])

  // PDF Document Loading & Hydration
  useEffect(() => {
    pdfStructureClient.dispose()
    pdfInspectorClient.dispose()
    if (!data) return

    let cancelled = false
    pdfDocRef.current = null
    loadingTaskRef.current = null
    setPdfDoc(null)
    setPageNum(1)
    setNumPages(0)
    setOcrBannerDismissed(false)
    resetPageOcr()
    missingWordLayerRef.current.clear()
    setTocOpen(false)
    pageAnchorRefs.current.clear()

    const loadSession = tocLifecycleRef.current?.currentSession() ?? 0
    const isLiveLoad = (): boolean =>
      isLiveLoadSession(cancelled, loadSession, tocLifecycleRef.current?.currentSession() ?? -1)

    void (async () => {
      try {
        const loadingTask = openPdfDocument({ data: data.data.slice() })
        loadingTaskRef.current = loadingTask
        const pdf = await loadingTask.promise
        if (!isLiveLoad()) {
          void loadingTask.destroy()
          return
        }

        pdfDocRef.current = pdf
        setPdfDoc(pdf)
        setNumPages(pdf.numPages)

        const savedProgress = useReadingProgressStore.getState().getPdfProgress(filePath)
        const restoredPage =
          savedProgress?.pageNum &&
          savedProgress.pageNum >= 1 &&
          savedProgress.pageNum <= pdf.numPages
            ? savedProgress.pageNum
            : 1
        pageNumRef.current = restoredPage
        if (restoredPage > 1) {
          pendingJumpPageRef.current = restoredPage
        }
        setPageNum(restoredPage)

        const firstPage = await pdf.getPage(1)
        if (!isLiveLoad()) return
        {
          const viewport = firstPage.getViewport({ scale: 1 })
          setPageCssSize({ width: viewport.width, height: viewport.height })
        }

        const units = await loadPdfOutlineInfo(pdf)
        const profile = await detectPdfDocumentProfile(pdf)
        if (!isLiveLoad()) return
        setIsScannedPdf(profile.isScanned)
        setIsMixedPdf(profile.mixed)

        let nextUnits = units.units
        let nextSource: PdfOutlineSource | 'ocr' = units.source
        let nextNotice = formatPdfOutlineNotice(units, profile.isScanned)

        if (
          fileFingerprint &&
          canUseOcrToc({
            outlineSource: units.source,
            isScannedPdf: profile.isScanned,
            isMixedPdf: profile.mixed,
          })
        ) {
          const cacheResult = await getPdfOcrToc({ fileFingerprint })
          if (!isLiveLoad()) return
          if (cacheResult.ok) {
            const assessment = assessPdfOcrTocCache(cacheResult.value, {
              pageCount: pdf.numPages,
            })
            const notice = noticeForRestoredCache(assessment)
            if (assessment.status === 'invalid') {
              setOcrTocNotice(notice)
            } else {
              const cache = cacheResult.value
              nextUnits = assessment.repairedUnits ?? cache.units
              nextSource = 'ocr'
              setTocPageFrom(cache.tocPageRange[0])
              setTocPageTo(cache.tocPageRange[1])
              setTocPageOffset(cache.pageOffset)
              setOcrTocEntries(cache.entries)
              nextNotice = undefined
              setOcrTocNotice(notice)
            }
          }
        }

        if (!isLiveLoad()) return
        setOutlineUnits(nextUnits)
        setOutlineSource(nextSource)
        setOutlineNotice(nextNotice)

        if (!isLiveLoad()) return
        if (fileFingerprint) {
          const hydrated = await loadPersistedOcrPageCaches(fileFingerprint, {
            listPages: async () => {
              const pagesResult = await listPdfOcrPages({ fileFingerprint })
              return pagesResult.ok ? pagesResult.value : []
            },
            getPage: async (pageNumber) => {
              const pageResult = await getPdfOcrPage({ fileFingerprint, page: pageNumber })
              return pageResult.ok ? pageResult.value : null
            },
          })
          if (!isLiveLoad()) return
          hydratePageCaches(hydrated)
        }
      } catch (cause) {
        if (!isLiveLoad()) return
        reportAppError({
          code: 'FILE_READ_ERROR',
          message: cause instanceof Error ? cause.message : 'PDF 加载失败',
        })
      }
    })()

    return () => {
      cancelled = true
      pdfStructureClient.dispose()
      if (pageNumRef.current >= 1) {
        useReadingProgressStore.getState().savePdfProgress(filePath, {
          pageNum: pageNumRef.current,
        })
      }
      void loadingTaskRef.current?.destroy()
      pdfDocRef.current = null
      loadingTaskRef.current = null
      setPdfDoc(null)
    }
  }, [data, fileFingerprint, filePath, hydratePageCaches, pageAnchorRefs, resetPageOcr, setOcrBannerDismissed, setOcrTocEntries, setOcrTocNotice, setTocOpen, setTocPageFrom, setTocPageOffset, setTocPageTo, tocLifecycleRef])

  // Progress save debounce
  useEffect(() => {
    if (!ready || pageNum < 1) return

    if (savePdfProgressTimerRef.current !== null) {
      window.clearTimeout(savePdfProgressTimerRef.current)
    }
    savePdfProgressTimerRef.current = window.setTimeout(() => {
      savePdfProgressTimerRef.current = null
      useReadingProgressStore.getState().savePdfProgress(filePath, { pageNum })
    }, 400)

    return () => {
      if (savePdfProgressTimerRef.current !== null) {
        window.clearTimeout(savePdfProgressTimerRef.current)
      }
    }
  }, [filePath, pageNum, ready])

  useLayoutEffect(() => {
    const targetPage = pendingJumpPageRef.current
    if (targetPage === null) return
    pendingJumpPageRef.current = null

    jumpSettleCancelRef.current?.()

    applyScrollToPage(targetPage, 'auto', {
      preferEstimate: true,
      holdSyncMs: PDF_JUMP_SYNC_HOLD_MS,
    })

    let cancelled = false
    let frames = 0
    const maxFrames = 45

    const snapToAnchor = () => {
      if (cancelled) return
      const container = containerRef.current
      const anchor = pageAnchorRefs.current.get(targetPage)
      if (!container || !anchor) return
      const top = resolvePdfPageScrollTop(targetPage, scaledPageSize.height, anchor.offsetTop)
      if (Math.abs(container.scrollTop - top) > 1) {
        container.scrollTop = top
      }
    }

    const tick = () => {
      if (cancelled) return
      snapToAnchor()
      frames += 1
      if (frames < maxFrames) {
        window.requestAnimationFrame(tick)
      } else {
        holdScrollSync(120)
      }
    }
    window.requestAnimationFrame(tick)

    const targetEl = pageAnchorRefs.current.get(targetPage)
    let observer: ResizeObserver | null = null
    if (targetEl && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        snapToAnchor()
        holdScrollSync(160)
      })
      observer.observe(targetEl)
    }

    jumpSettleCancelRef.current = () => {
      cancelled = true
      observer?.disconnect()
    }

    return () => {
      jumpSettleCancelRef.current?.()
      jumpSettleCancelRef.current = null
    }
  }, [applyScrollToPage, containerRef, holdScrollSync, pageAnchorRefs, pageNum, scaledPageSize.height])

  // Sync current page number on scroll
  useEffect(() => {
    const container = containerRef.current
    if (!container || numPages === 0) return

    const updateCurrentPage = () => {
      if (ignoreScrollSyncRef.current) return

      const midpoint = container.scrollTop + container.clientHeight * 0.35
      let closestPage = 1
      let closestDistance = Number.POSITIVE_INFINITY

      for (const [page, element] of pageAnchorRefs.current) {
        const center = element.offsetTop + element.offsetHeight / 2
        const distance = Math.abs(center - midpoint)
        if (distance < closestDistance) {
          closestDistance = distance
          closestPage = page
        }
      }

      setPageNum((current) => (current === closestPage ? current : closestPage))
    }

    updateCurrentPage()
    container.addEventListener('scroll', updateCurrentPage, { passive: true })
    return () => container.removeEventListener('scroll', updateCurrentPage)
  }, [containerRef, numPages, pageAnchorRefs, scale])

  // Prefetch pages for scanned PDF
  useEffect(() => {
    if (
      !pdfOcrBackgroundPrefetch ||
      !isScannedPdf ||
      !fileFingerprint ||
      !ready ||
      numPages < 1 ||
      rosetta.rosettaImport.state === 'running'
    ) {
      return
    }

    let cancelled = false
    const cachedPages = new Set(
      Object.entries(ocrPageCachesRef.current)
        .filter(([, cache]) => cache.words.length > 0)
        .map(([page]) => Number.parseInt(page, 10))
        .filter((page) => Number.isFinite(page)),
    )

    const pages = resolvePdfOcrPrefetchPages(pageNum, numPages, outlineUnits, hasChapterToc, {
      cachedPages,
    })

    void (async () => {
      for (const page of pages) {
        if (cancelled) return
        if (ocrPageCachesRef.current[page]?.words.length) continue
        if (hasPendingPageOcr(page)) continue
        if (ocrPageRecognizing === page) continue
        try {
          await runPageOcr(page)
        } catch {}
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fileFingerprint, hasChapterToc, hasPendingPageOcr, isScannedPdf, numPages, ocrPageCachesRef, ocrPageRecognizing, outlineUnits, pageNum, pdfOcrBackgroundPrefetch, ready, rosetta.rosettaImport.state, runPageOcr])

  // Hydrate pages as Rosetta completes blocks
  useEffect(() => {
    if (!fileFingerprint || rosetta.rosettaImport.state !== 'running' || rosetta.rosettaImport.donePages <= 0) {
      return
    }
    let cancelled = false
    void (async () => {
      const fresh = await loadPersistedOcrPageCaches(fileFingerprint, {
        listPages: async () => {
          const pagesResult = await listPdfOcrPages({ fileFingerprint })
          if (!pagesResult.ok) return []
          return pagesResult.value.filter((page) => !ocrPageCachesRef.current[page]?.words.length)
        },
        getPage: async (pageNumber) => {
          const pageResult = await getPdfOcrPage({ fileFingerprint, page: pageNumber })
          return pageResult.ok ? pageResult.value : null
        },
      })
      if (!cancelled) hydratePageCaches(fresh)
    })()
    return () => {
      cancelled = true
    }
  }, [fileFingerprint, hydratePageCaches, ocrPageCachesRef, rosetta.rosettaImport.donePages, rosetta.rosettaImport.state])

  return {
    pdfDoc,
    pdfDocRef,
    pageNum,
    setPageNum,
    pageNumRef,
    numPages,
    scale,
    setScale,
    pageNumbers,
    ready,
    pageCssSize,
    scaledPageSize,
    outlineUnits,
    setOutlineUnits,
    outlineSource,
    setOutlineSource,
    outlineNotice,
    setOutlineNotice,
    isScannedPdf,
    isMixedPdf,
    hasChapterToc,
    currentPdfChapter,
    marksToc,
    rosettaImport: rosetta.rosettaImport,
    bodyWatermarkPreviewOpen: rosetta.bodyWatermarkPreviewOpen,
    setBodyWatermarkPreviewOpen: rosetta.setBodyWatermarkPreviewOpen,
    indexBadge: rosetta.indexBadge,
    moreMenuItems: rosetta.moreMenuItems,
    rosettaExtraAction: rosetta.rosettaExtraAction,
    fitWidth,
    scrollToPage,
    jumpToPage,
    goToFlatIndex,
    goToUnit,
    goPrev,
    goNext,
    handleWordLayerMissing,
  }
}
