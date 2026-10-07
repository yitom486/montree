import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import { Database, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { registerReaderContent } from '@/lib/agent/context/reader-content-registry'
import { formatPdfPageTextForAgent } from '@/lib/reader/pdf/pdf-page-text'
import { isStructuredPageTextUsable } from '@/lib/reader/pdf/pdf-structure'
import { pdfStructureClient } from '@/lib/reader/pdf/pdf-structure-client'
import { pdfInspectorClient } from '@/lib/reader/pdf/pdf-inspector-client'
import { useRosettaImport } from '@/hooks/reader/useRosettaImport'
import { rosettaApi } from '@/api/rosetta-api'
import { formatRosettaBlocksForAgent } from '@/lib/reader/rosetta/rosetta-agent-text'
import { resolveRosettaTocEntries } from '@/lib/reader/rosetta/rosetta-toc'
import { getCurrentRosettaTocSignature, resolveRosettaIndexStatus } from '@/lib/reader/rosetta/rosetta-toc-status'
import { resolvePreferNativeImport, shouldOfferPageOcr } from '@/lib/reader/pdf/pdf-import-mode'
import { resolvePdfAgentSearchBlock } from '@/lib/reader/pdf/pdf-agent-search-gate'
import { rosettaPageMissingError } from '@/lib/reader/rosetta/rosetta-read-guard'
import { iterateRosettaChapterUnits } from '@/lib/agent/context/rosetta-chapter-units'
import {
  resolvePdfIndexBadge,
  resolveRosettaIndexMenuAction,
  type PdfToolbarMenuItem,
} from '@/components/reader/PdfToolbarMoreMenu'
import { reportAppError } from '@/lib/workspace/report-error'
import { isLiveLoadSession, TocDocLifecycle } from '@/lib/reader/pdf-ocr/ocr-toc-op'
import { appApi } from '@/api/app-api'
import { isOk, type OcrTocEntry, type RosettaBookInfo, type RosettaImportState } from '@montree/contracts'
import { toast } from 'sonner'
import type { usePdfPageOcr } from '@/hooks/reader/usePdfPageOcr'

declare global {
  interface Window {
    __montreeE2ePdfStructure?: {
      readCurrentPage: () => Promise<{ source: string; prefix: string }>
      status: () => { status: string; reason: string }
      inspectorStatus: () => { status: string; reason: string }
    }
  }
}

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

  const rosettaImport = useRosettaImport(fileFingerprint)
  const rosettaInfoRef = useRef<RosettaBookInfo | null>(null)
  useEffect(() => {
    rosettaInfoRef.current = rosettaImport.info
  }, [rosettaImport.info])
  const rosettaImportStateRef = useRef<RosettaImportState>('idle')
  useEffect(() => {
    rosettaImportStateRef.current = rosettaImport.state
  }, [rosettaImport.state])

  const [bodyWatermarkPreviewOpen, setBodyWatermarkPreviewOpen] = useState(false)
  const [rosettaRebuilding, setRosettaRebuilding] = useState(false)

  const hasChapterToc = outlineSource === 'embedded' || outlineSource === 'ocr'
  const pdfOcrScale = useAppSettingsStore((state) => state.pdfOcrScale)
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
        importRunning: rosettaImportStateRef.current === 'running',
      })
    ) {
      return
    }
    if (hasPendingPageOcr(current)) return
    void runPageOcr(current).catch(() => {})
  }, [hasPendingPageOcr, ocrPageCachesRef, runPageOcr])

  const handleWordLayerMissing = useCallback(
    (missingPage: number) => {
      missingWordLayerRef.current.add(missingPage)
      tryAutoOcrMissingPage()
    },
    [tryAutoOcrMissingPage],
  )

  useEffect(() => {
    tryAutoOcrMissingPage()
  }, [pageNum, isScannedPdf, isMixedPdf, rosettaImport.state, tryAutoOcrMissingPage])

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

  // Scrolling & Layout calculations
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

  // Prefetch pages for scanned PDF
  useEffect(() => {
    if (
      !pdfOcrBackgroundPrefetch ||
      !isScannedPdf ||
      !fileFingerprint ||
      !ready ||
      numPages < 1 ||
      rosettaImport.state === 'running'
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
  }, [fileFingerprint, hasChapterToc, hasPendingPageOcr, isScannedPdf, numPages, ocrPageCachesRef, ocrPageRecognizing, outlineUnits, pageNum, pdfOcrBackgroundPrefetch, ready, rosettaImport.state, runPageOcr])

  // Hydrate pages as Rosetta completes blocks
  useEffect(() => {
    if (!fileFingerprint || rosettaImport.state !== 'running' || rosettaImport.donePages <= 0) {
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
  }, [fileFingerprint, hydratePageCaches, ocrPageCachesRef, rosettaImport.donePages, rosettaImport.state])

  // Rosetta text readers
  const readRosettaPageText = useCallback(
    async (page: number): Promise<string | null> => {
      if (!fileFingerprint || !rosettaInfoRef.current) return null
      try {
        const result = await rosettaApi.queryBook({ kind: 'page', fingerprint: fileFingerprint, page })
        if (!isOk(result) || result.value.kind !== 'page' || result.value.blocks.length === 0) {
          return null
        }
        return formatRosettaBlocksForAgent(result.value.blocks)
      } catch {
        return null
      }
    },
    [fileFingerprint],
  )

  const readRosettaUnitText = useCallback(
    async (unit: ReaderUnit): Promise<{ label: string; text: string } | null> => {
      if (!fileFingerprint || !rosettaInfoRef.current) return null
      const page = Number.parseInt('href' in unit ? unit.href : '', 10)
      if (!Number.isFinite(page) || page < 1) return null
      const label = 'label' in unit && typeof unit.label === 'string' ? unit.label : ''
      try {
        const tocListResult = await rosettaApi.queryBook({ kind: 'tocEntries', fingerprint: fileFingerprint })
        if (isOk(tocListResult) && tocListResult.value.kind === 'tocEntries' && tocListResult.value.tocEntries.length > 0) {
          const entries = tocListResult.value.tocEntries
          const exact = entries.find((e) => e.title === label && e.startPage === page)
          const samePage = entries.filter((e) => e.startPage === page)
          let matched: (typeof entries)[number] | null =
            exact ?? samePage.find((e) => e.title === label) ?? samePage[0] ?? null
          if (!matched) {
            const sameTitle = [...entries].reverse().find((e) => e.startPage <= page && e.title === label)
            let nearest: (typeof entries)[number] | null = null
            for (const entry of entries) {
              if (entry.startPage <= page) nearest = entry
              else break
            }
            matched = sameTitle ?? nearest
          }
          if (matched) {
            const tocResult = await rosettaApi.queryBook({
              kind: 'toc',
              fingerprint: fileFingerprint,
              tocIndex: matched.tocIndex,
            })
            if (isOk(tocResult) && tocResult.value.kind === 'toc' && tocResult.value.blocks.length > 0) {
              return { label: tocResult.value.entry.title, text: formatRosettaBlocksForAgent(tocResult.value.blocks) }
            }
            return null
          }
          return null
        }
        const chaptersResult = await rosettaApi.queryBook({ kind: 'chapters', fingerprint: fileFingerprint })
        if (!isOk(chaptersResult) || chaptersResult.value.kind !== 'chapters') return null
        let current: { index: number; title: string } | null = null
        for (const chapter of chaptersResult.value.chapters) {
          if (chapter.startPage <= page) current = chapter
          else break
        }
        if (!current) return null
        const blocksResult = await rosettaApi.queryBook({
          kind: 'chapter',
          fingerprint: fileFingerprint,
          chapterIndex: current.index,
        })
        if (!isOk(blocksResult) || blocksResult.value.kind !== 'chapter' || blocksResult.value.blocks.length === 0) {
          return null
        }
        return { label: current.title, text: formatRosettaBlocksForAgent(blocksResult.value.blocks) }
      } catch {
        return null
      }
    },
    [fileFingerprint],
  )

  const readAgentPageTextWithSource = useCallback(
    async (page: number): Promise<{ text: string; source: 'inspector' | 'structured' | 'legacy' | 'rosetta' }> => {
      if (!Number.isFinite(page) || page < 1) {
        throw new Error(`无效的 PDF 页码：${page}`)
      }
      const total = numPages || pdfDocRef.current?.numPages || 0
      const rosettaText = await readRosettaPageText(page)
      if (rosettaText !== null) {
        return { text: formatPdfPageTextForAgent(page, total, rosettaText), source: 'rosetta' }
      }
      if (fileFingerprint && rosettaInfoRef.current) {
        throw rosettaPageMissingError(page)
      }
      const docKey = fileFingerprint || filePath
      const importRunning = rosettaImportStateRef.current === 'running'
      let inspected: string | null = pdfInspectorClient.getCachedPageText(docKey, page)
      if (inspected === null && !importRunning && !pdfInspectorClient.isUnavailable()) {
        const parsed = await pdfInspectorClient.parseDocument(docKey, filePath)
        if (parsed) inspected = pdfInspectorClient.getCachedPageText(docKey, page)
      }
      if (inspected !== null && isStructuredPageTextUsable(inspected)) {
        return { text: formatPdfPageTextForAgent(page, total, inspected), source: 'inspector' }
      }
      let structured: string | null = pdfStructureClient.getCachedPageText(docKey, page)
      if (structured === null && !importRunning && data && !pdfStructureClient.isUnavailable()) {
        const parsed = await pdfStructureClient.parseDocument(docKey, data.data.slice(0))
        if (parsed) structured = pdfStructureClient.getCachedPageText(docKey, page)
      }
      if (structured !== null && isStructuredPageTextUsable(structured)) {
        return { text: formatPdfPageTextForAgent(page, total, structured), source: 'structured' }
      }
      const allowAutoOcr = useAppSettingsStore.getState().pdfOcrAgentAutoOcr
      const text = await readPageText(page, { allowAutoOcr })
      return { text: formatPdfPageTextForAgent(page, total, text), source: 'legacy' }
    },
    [data, fileFingerprint, filePath, numPages, readPageText, readRosettaPageText],
  )

  const readAgentPageTextWithSourceRef = useRef(readAgentPageTextWithSource)
  readAgentPageTextWithSourceRef.current = readAgentPageTextWithSource

  const readAgentPageText = useCallback(
    (page: number): Promise<string> =>
      readAgentPageTextWithSource(page).then((result) => result.text),
    [readAgentPageTextWithSource],
  )

  // Register reader content for Agent
  useEffect(() => {
    const agentAutoOcr = () => useAppSettingsStore.getState().pdfOcrAgentAutoOcr
    return registerReaderContent({
      filePath,
      fileFingerprint: fileFingerprint || undefined,
      searchBlockedReason:
        resolvePdfAgentSearchBlock({
          isScannedPdf,
          isMixedPdf,
          indexed: Boolean(rosettaImport.info),
        }) ?? undefined,
      searchSource: Boolean(rosettaImport.info) ? 'index' : 'memory',
      getCurrentText: () => readAgentPageText(pageNumRef.current),
      getViewportText: () => readAgentPageText(pageNumRef.current),
      iterateUnits: async function* () {
        const total = pdfDocRef.current?.numPages ?? 0
        if (fileFingerprint && rosettaInfoRef.current) {
          yield* iterateRosettaChapterUnits(fileFingerprint)
          return
        }
        for (let page = 1; page <= total; page += 1) {
          try {
            const allowAutoOcr = agentAutoOcr()
            const text = await readPageText(page, { allowAutoOcr })
            yield {
              label: `第 ${page} 页`,
              text: formatPdfPageTextForAgent(page, total, text),
            }
          } catch {}
        }
      },
      getUnitByIndex: async (flatIndex) => {
        const units = useReaderNavigationStore.getState().units
        const unit = units[flatIndex]
        if (!unit) return null
        const page = Number.parseInt('href' in unit ? unit.href : '', 10)
        if (!Number.isFinite(page) || page < 1) {
          return null
        }
        const indexed = Boolean(fileFingerprint && rosettaInfoRef.current)
        try {
          const rosettaUnit = await readRosettaUnitText(unit)
          const total = pdfDocRef.current?.numPages ?? numPages
          if (rosettaUnit) {
            return {
              label: rosettaUnit.label,
              text: formatPdfPageTextForAgent(page, total, rosettaUnit.text),
            }
          }
          if (indexed) throw rosettaPageMissingError(page)
          const raw = await readPageText(page, { allowAutoOcr: agentAutoOcr() })
          return {
            label: unit.label || `第 ${page} 页`,
            text: formatPdfPageTextForAgent(page, total, raw),
          }
        } catch (cause) {
          if (indexed) throw cause
          return null
        }
      },
    })
  }, [fileFingerprint, filePath, isMixedPdf, isScannedPdf, numPages, readAgentPageText, readPageText, readRosettaUnitText, rosettaImport.info])

  // E2E test hook
  useEffect(() => {
    if (typeof window === 'undefined' || !appApi.isE2EPdfStructure()) return
    window.__montreeE2ePdfStructure = {
      readCurrentPage: async () => {
        const result = await readAgentPageTextWithSourceRef.current(pageNumRef.current)
        return { source: result.source, prefix: result.text.slice(0, 200) }
      },
      status: () => pdfStructureClient.getState(),
      inspectorStatus: () => pdfInspectorClient.getState(),
    }
    return () => {
      delete window.__montreeE2ePdfStructure
    }
  }, [filePath])

  const handleRosettaImport = useCallback((forceRebuild?: boolean) => {
    if (!Number.isInteger(numPages) || numPages < 1) return
    const toc = resolveRosettaTocEntries({
      outlineUnits,
      ocrEntries: ocrTocEntries,
      pageOffset: tocPageOffset,
      pageCount: numPages,
    })
    rosettaImport.startImport({
      filePath,
      title: filePath.split(/[/\\]/).pop() || filePath,
      format: 'pdf',
      scale: pdfOcrScale,
      pageCount: numPages,
      toc,
      preferNative: resolvePreferNativeImport({ isScannedPdf, isMixedPdf }),
      forceRebuild: forceRebuild === true ? true : undefined,
    })
    void rosettaImport.refreshInfo()
  }, [filePath, isMixedPdf, isScannedPdf, numPages, ocrTocEntries, outlineUnits, pdfOcrScale, rosettaImport, tocPageOffset])

  const currentRosettaTocSignature = useMemo(
    () =>
      getCurrentRosettaTocSignature({
        outlineUnits,
        ocrEntries: ocrTocEntries,
        pageOffset: tocPageOffset,
        pageCount: numPages,
      }),
    [outlineUnits, ocrTocEntries, tocPageOffset, numPages],
  )
  const rosettaTocStatus = resolveRosettaIndexStatus(rosettaImport.info, currentRosettaTocSignature)

  const handleRosettaRebuildToc = useCallback(async () => {
    if (!Number.isInteger(numPages) || numPages < 1 || rosettaRebuilding) return
    const toc = resolveRosettaTocEntries({
      outlineUnits,
      ocrEntries: ocrTocEntries,
      pageOffset: tocPageOffset,
      pageCount: numPages,
    })
    if (toc.length === 0) {
      toast.error('当前没有可用目录，无法更新')
      return
    }
    setRosettaRebuilding(true)
    try {
      const result = await rosettaImport.rebuildToc(toc)
      if (result) {
        toast.success(`罗盘目录已更新：${result.tocEntries} 条目录 / ${result.chapters} 章`)
      }
    } finally {
      setRosettaRebuilding(false)
    }
  }, [numPages, ocrTocEntries, outlineUnits, rosettaImport, rosettaRebuilding, tocPageOffset])

  const indexBadge = resolvePdfIndexBadge({
    hasFingerprint: Boolean(fileFingerprint),
    importRunning: rosettaImport.state === 'running',
    indexed: Boolean(rosettaImport.info),
    tocStale: rosettaTocStatus === 'stale',
    isScannedPdf,
  })

  const moreMenuItems: PdfToolbarMenuItem[] = []
  const rosettaMenuAction = resolveRosettaIndexMenuAction({
    hasFingerprint: Boolean(fileFingerprint),
    indexed: Boolean(rosettaImport.info),
    importRunning: rosettaImport.state === 'running',
  })
  if (rosettaMenuAction === 'build') {
    moreMenuItems.push({
      key: 'rosetta-import',
      label: '建立罗盘索引',
      title: '全书解析后建章节块索引并落盘（原生页直提、扫描页识别），之后 AI 直接读库不再现场识别',
      onSelect: () => void handleRosettaImport(),
    })
  }
  if (rosettaMenuAction === 'rebuild') {
    moreMenuItems.push({
      key: 'rosetta-rebuild',
      label: '重新建立罗盘索引',
      title: '删除本书旧罗盘库与 OCR 缓存后全书重新识别（划重点/批注保留），之后 AI 直接读库',
      onSelect: () => {
        if (
          !window.confirm(
            '将删除本书罗盘并重新识别全书（可能数分钟）。划重点/批注会保留。取消在阶段边界生效，取消后可能只入库一部分。',
          )
        ) {
          return
        }
        handleRosettaImport(true)
      },
    })
  }
  if (indexBadge === 'ready') {
    moreMenuItems.push({
      key: 'preview-watermark',
      label: '预览正文水印清洗',
      title: '只读统计正文水印清洗影响，不修改数据库',
      onSelect: () => setBodyWatermarkPreviewOpen(true),
    })
  }
  moreMenuItems.push(
    { key: 'zoom-out', label: '缩小', onSelect: () => setScale((value) => Math.max(0.5, value - 0.1)) },
    { key: 'zoom-in', label: '放大', onSelect: () => setScale((value) => Math.min(3, value + 0.1)) },
    { key: 'fit-width', label: '适合宽度', onSelect: () => fitWidth() },
  )
  const currentPageOcrSuggested = Boolean(rosettaImport.info?.ocrSuggestedPages?.includes(pageNum))
  if (shouldOfferPageOcr({ isScannedPdf, currentPageOcrSuggested })) {
    moreMenuItems.push({
      key: 'recognize-page',
      label: currentPageOcrBusy ? '识别中' : currentPageOcrReady ? '重新识别本页' : '识别本页',
      title: currentPageOcrSuggested
        ? '本页原生文字质量较差，可识别本页（不整书 OCR）'
        : '仅识别当前页文本层，不建全书索引',
      disabled: !ready || currentPageOcrBusy,
      onSelect: () => void handleRecognizePage(),
    })
  }
  if (outlineSource === 'ocr') {
    moreMenuItems.push({
      key: 're-recognize-toc',
      label: '重新识别目录',
      disabled: rosettaImport.state === 'running',
      onSelect: () => setOcrTocEditorOpen(true),
    })
  }
  if (outlineSource === 'embedded' && (isScannedPdf || isMixedPdf)) {
    moreMenuItems.push({
      key: 'recognize-toc',
      label: '识别印刷目录',
      title: '探测印刷目录页并识别自建目录（书签保留，保存后以自建目录为准；全书导入中不可用）',
      disabled: rosettaImport.state === 'running',
      onSelect: () => setOcrTocEditorOpen(true),
    })
  }
  if (ocrRecognizedCount > 0 || outlineSource === 'ocr') {
    moreMenuItems.push({
      key: 'clear-cache',
      label: '清除缓存',
      title: '清除本页/目录 OCR 缓存（不碰罗盘库）',
      onSelect: () => void handleClearOcrCache(),
    })
  }

  let rosettaExtraAction: ReactNode | null = null
  if (fileFingerprint) {
    if (rosettaImport.state === 'running') {
      const phaseLabel =
        rosettaImport.phase === 'import'
          ? '正在入库'
          : rosettaImport.totalPages > 0
            ? `全书识别中 ${rosettaImport.donePages}/${rosettaImport.totalPages}`
            : '准备中'
      rosettaExtraAction = (
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground"
          title={`罗盘导入·${phaseLabel}（约数分钟；取消在阶段边界生效）`}
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {phaseLabel}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            title="取消导入（阶段边界生效）"
            aria-label="取消罗盘导入"
            onClick={() => rosettaImport.cancelImport()}
          >
            <X />
          </Button>
        </span>
      )
    } else if (rosettaImport.info && rosettaTocStatus === 'ready') {
      rosettaExtraAction = (
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground"
          title={`罗盘索引：${rosettaImport.info.chapters} 章 / ${rosettaImport.info.blocks} 块，AI 直接读库`}
        >
          <Database className="size-3.5" aria-hidden />
          已入库
        </span>
      )
    } else if (rosettaImport.info && rosettaTocStatus === 'stale') {
      rosettaExtraAction = (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs text-muted-foreground"
          title="库内目录与当前已确认目录不一致，只做本地重建，不重新识别"
          disabled={rosettaRebuilding}
          onClick={() => void handleRosettaRebuildToc()}
        >
          {rosettaRebuilding ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Database className="size-3.5" aria-hidden />
          )}
          目录待更新
        </Button>
      )
    } else {
      rosettaExtraAction =
        indexBadge === 'unindexed-scanned' ? (
          <span
            className="text-xs text-muted-foreground"
            title="扫描版 PDF 尚未建立罗盘索引，AI 读库与正文搜索不可用；可在“更多工具”中建立"
          >
            未入库
          </span>
        ) : null
    }
  }

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
    rosettaImport,
    bodyWatermarkPreviewOpen,
    setBodyWatermarkPreviewOpen,
    indexBadge,
    moreMenuItems,
    rosettaExtraAction,
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
