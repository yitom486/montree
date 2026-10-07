import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OcrTocEntry } from '@montree/contracts'
import type { ReaderUnit } from '@montree/reader-core'
import {
  canUseOcrToc,
} from '@/lib/reader/pdf-ocr/pdf-ocr-toc-gate'
import {
  reduceDetectFeedback,
  selectDetectCandidate,
  type TocDetectFeedback,
} from '@/lib/reader/pdf-ocr/ocr-toc-detect-feedback'
import {
  TOC_DRAFT_GUARD_MESSAGE,
  TocDocLifecycle,
  tocBusyMessage,
  type OcrTocOperation,
  type TocOpLease,
} from '@/lib/reader/pdf-ocr/ocr-toc-op'
import { resolveDetectApply, reassembleDirectoryText } from '@montree/ocr-core'
import {
  noticeForFreshRecognize,
  placeOcrTocNotice,
  type OcrTocNotice,
} from '@/lib/reader/pdf-ocr/ocr-toc-notice'
import { ACP_MAX_IMAGE_BYTES, blobToBase64 } from '@/lib/agent/acp-composer'
import type { TocPromptImage } from '@/lib/agent/toc-ai-session'
import { renderPdfPagesToPng } from '@/lib/reader/pdf/pdf-page-image'
import {
  clearPdfOcrCache,
  detectPdfTocPages,
  recognizePdfOcrToc,
  savePdfOcrToc,
} from '@/api/ocr-api'
import { buildPdfOcrTocCache, resolveOcrTocEditorEntries } from '@/lib/reader/pdf-ocr/pdf-ocr-toc-cache'
import { suggestTocPageOffset, type PdfOutlineSource, formatPdfOutlineNotice } from '@montree/reader-core'
import { loadPdfOutlineInfo } from '@montree/reader-core'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { toast } from 'sonner'

export interface UsePdfOcrTocManagerOptions {
  filePath: string
  fileFingerprint: string
  numPages: number
  pdfDocRef: React.RefObject<PDFDocumentProxy | null>
  outlineUnits: ReaderUnit[]
  outlineSource: PdfOutlineSource | 'ocr'
  isScannedPdf: boolean
  isMixedPdf: boolean
  rosettaImportRunning: boolean
  tocLifecycleRef: React.RefObject<TocDocLifecycle | null>
  readPageText: (pageNumber: number, options?: { allowAutoOcr?: boolean }) => Promise<string>
  resetPageOcr: () => void
  setOutlineUnits: React.Dispatch<React.SetStateAction<ReaderUnit[]>>
  setOutlineSource: React.Dispatch<React.SetStateAction<PdfOutlineSource | 'ocr'>>
  setOutlineNotice: React.Dispatch<React.SetStateAction<string | undefined>>
  setTocOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  ocrTocNotice: OcrTocNotice | null
  setOcrTocNotice: React.Dispatch<React.SetStateAction<OcrTocNotice | null>>
}

export function usePdfOcrTocManager({
  filePath,
  fileFingerprint,
  numPages,
  pdfDocRef,
  outlineUnits,
  outlineSource,
  isScannedPdf,
  isMixedPdf,
  rosettaImportRunning,
  tocLifecycleRef,
  readPageText,
  resetPageOcr,
  setOutlineUnits,
  setOutlineSource,
  setOutlineNotice,
  setTocOpen,
  ocrTocNotice,
  setOcrTocNotice,
}: UsePdfOcrTocManagerOptions) {
  const [ocrBannerDismissed, setOcrBannerDismissed] = useState(false)
  const [bookmarkSlimDismissed, setBookmarkSlimDismissed] = useState(false)
  const [ocrTocEditorOpen, setOcrTocEditorOpen] = useState(false)
  const [ocrTocEditMode, setOcrTocEditMode] = useState(false)
  const [ocrTocEntries, setOcrTocEntries] = useState<OcrTocEntry[]>([])
  const [ocrTocSaving, setOcrTocSaving] = useState(false)
  const [ocrRecognizing, setOcrRecognizing] = useState(false)
  const [tocPageFrom, setTocPageFrom] = useState(8)
  const [tocPageTo, setTocPageTo] = useState(12)
  const [tocPageOffset, setTocPageOffset] = useState(12)
  const [tocDetecting, setTocDetecting] = useState(false)
  const [tocDetectFeedback, setTocDetectFeedback] = useState<TocDetectFeedback | null>(null)
  const [suggestingOffset, setSuggestingOffset] = useState(false)

  const pdfOcrScale = useAppSettingsStore((state) => state.pdfOcrScale)

  const beginTocOp = useCallback((operation: OcrTocOperation): TocOpLease | null => {
    const lifecycle = tocLifecycleRef.current
    const lease = lifecycle ? lifecycle.begin(operation) : null
    if (lease) return lease
    toast.error(tocBusyMessage(lifecycle?.current() ?? null) ?? '目录操作进行中，请稍候')
    return null
  }, [tocLifecycleRef])

  const endTocOp = useCallback((lease: TocOpLease): void => {
    tocLifecycleRef.current?.end(lease)
  }, [tocLifecycleRef])

  const isLiveTocOp = useCallback((lease: TocOpLease, session: number): boolean => {
    return tocLifecycleRef.current?.isLive(lease, session) ?? false
  }, [tocLifecycleRef])

  useEffect(() => {
    if (outlineSource === 'ocr') return
    setTocPageOffset(tocPageTo)
  }, [outlineSource, tocPageTo])

  const handleRecognizeToc = useCallback(async () => {
    if (!fileFingerprint) return
    if (rosettaImportRunning) {
      toast.error('全书识别进行中，目录识别请等待完成或取消后再试')
      return
    }
    if (ocrTocEditMode) {
      toast.error(TOC_DRAFT_GUARD_MESSAGE)
      return
    }
    const lease = beginTocOp('recognize')
    if (!lease) return
    const session = tocLifecycleRef.current?.currentSession() ?? 0
    setOcrRecognizing(true)
    try {
      if (!Number.isInteger(numPages) || numPages < 1) {
        toast.error('PDF 尚未加载完成，请稍后再试')
        return
      }
      const result = await recognizePdfOcrToc({
        filePath,
        fileFingerprint,
        fromPage: Math.min(tocPageFrom, tocPageTo),
        toPage: Math.max(tocPageFrom, tocPageTo),
        pageOffset: tocPageOffset,
        scale: pdfOcrScale,
        pageCount: numPages,
      })
      if (!isLiveTocOp(lease, session)) return
      if (result.ok) {
        setOutlineUnits(result.value.units)
        setOutlineSource('ocr')
        setOcrTocEntries(result.value.entries)
        setTocOpen(true)
        setOcrTocEditorOpen(false)
        setOcrTocNotice(noticeForFreshRecognize(result.value.units.length))
        toast.success(`已识别 ${result.value.units.length} 条目录`)
      } else {
        toast.error(result.error.message)
      }
    } finally {
      if (isLiveTocOp(lease, session)) setOcrRecognizing(false)
      endTocOp(lease)
    }
  }, [beginTocOp, endTocOp, fileFingerprint, filePath, isLiveTocOp, numPages, ocrTocEditMode, pdfOcrScale, rosettaImportRunning, setOcrTocNotice, setOutlineSource, setOutlineUnits, setTocOpen, tocLifecycleRef, tocPageFrom, tocPageOffset, tocPageTo])

  const handleSaveOcrToc = useCallback(
    async (entries: OcrTocEntry[]) => {
      if (!fileFingerprint) return
      const lease = beginTocOp('save')
      if (!lease) return
      const session = tocLifecycleRef.current?.currentSession() ?? 0
      setOcrTocSaving(true)
      try {
        const cache = buildPdfOcrTocCache({
          fileFingerprint,
          tocPageRange: [Math.min(tocPageFrom, tocPageTo), Math.max(tocPageFrom, tocPageTo)],
          pageOffset: tocPageOffset,
          entries,
        })
        if (cache.entries.length === 0) {
          toast.error('至少保留一条有效目录')
          return
        }
        const result = await savePdfOcrToc({ cache })
        if (!isLiveTocOp(lease, session)) return
        if (!result.ok) {
          toast.error(result.error.message)
          return
        }
        setOcrTocEntries(cache.entries)
        setOutlineUnits(cache.units)
        setOutlineSource('ocr')
        setOcrTocEditMode(false)
        setOcrTocNotice(null)
        toast.success('目录已保存')
      } finally {
        if (isLiveTocOp(lease, session)) setOcrTocSaving(false)
        endTocOp(lease)
      }
    },
    [beginTocOp, endTocOp, fileFingerprint, isLiveTocOp, setOcrTocNotice, setOutlineSource, setOutlineUnits, tocLifecycleRef, tocPageFrom, tocPageOffset, tocPageTo],
  )

  const handleDetectTocPages = useCallback(async () => {
    if (!fileFingerprint) return
    if (rosettaImportRunning) {
      toast.error('全书识别进行中，目录识别请等待完成或取消后再试')
      return
    }
    if (ocrTocEditMode) {
      toast.error(TOC_DRAFT_GUARD_MESSAGE)
      return
    }
    const lease = beginTocOp('detect')
    if (!lease) return
    const session = tocLifecycleRef.current?.currentSession() ?? 0
    setTocDetecting(true)
    setTocDetectFeedback((prev) => reduceDetectFeedback(prev, { type: 'detect-started' }))
    try {
      if (!Number.isInteger(numPages) || numPages < 1) {
        toast.error('PDF 尚未加载完成，请稍后再试')
        return
      }
      const result = await detectPdfTocPages({ filePath, pageCount: numPages })
      if (!isLiveTocOp(lease, session)) return
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      setTocDetectFeedback((prev) =>
        reduceDetectFeedback(prev, { type: 'detect-finished', result: result.value }),
      )
      const applied = resolveDetectApply(
        { fromPage: tocPageFrom, toPage: tocPageTo },
        result.value,
      )
      if (applied.changed) {
        setTocPageFrom(applied.fromPage)
        setTocPageTo(applied.toPage)
      }
      if (applied.toast === 'suggest') {
        toast.success(`已建议第 ${applied.fromPage}–${applied.toPage} 页，请核对后识别`)
      } else if (result.value.outcome === 'ambiguous') {
        toast.message(result.value.reason ?? '发现多处疑似目录，已保留当前范围')
      } else {
        toast.message(result.value.reason ?? '未找到可靠目录页，已保留当前范围')
      }
    } finally {
      if (isLiveTocOp(lease, session)) setTocDetecting(false)
      endTocOp(lease)
    }
  }, [beginTocOp, endTocOp, fileFingerprint, filePath, isLiveTocOp, numPages, ocrTocEditMode, rosettaImportRunning, tocLifecycleRef, tocPageFrom, tocPageTo])

  const handleSelectDetectCandidate = useCallback(
    (index: number) => {
      const outcome = selectDetectCandidate(tocDetectFeedback, index, {
        busy: ocrRecognizing || tocDetecting || ocrTocSaving,
        hasDraft: ocrTocEditMode,
      })
      if (!outcome) return
      if (outcome.action === 'blocked') {
        if (outcome.reason === 'busy') {
          toast.error(
            tocBusyMessage(tocLifecycleRef.current?.current() ?? null) ?? '目录操作进行中，请稍候',
          )
        } else {
          toast.error(TOC_DRAFT_GUARD_MESSAGE)
        }
        return
      }
      setTocPageFrom(outcome.fromPage)
      setTocPageTo(outcome.toPage)
    },
    [ocrRecognizing, ocrTocEditMode, ocrTocSaving, tocDetectFeedback, tocDetecting, tocLifecycleRef],
  )

  const handleTocPageFromChange = useCallback((value: number) => {
    setTocPageFrom(value)
    setTocDetectFeedback((prev) => reduceDetectFeedback(prev, { type: 'range-edited' }))
  }, [])

  const handleTocPageToChange = useCallback((value: number) => {
    setTocPageTo(value)
    setTocDetectFeedback((prev) => reduceDetectFeedback(prev, { type: 'range-edited' }))
  }, [])

  const getTocOcrText = useCallback(async (): Promise<string | null> => {
    const from = Math.min(tocPageFrom, tocPageTo)
    const to = Math.max(tocPageFrom, tocPageTo)
    const parts: string[] = []
    for (let page = from; page <= to; page += 1) {
      try {
        const text = await readPageText(page)
        if (text.trim()) parts.push(`--- PDF 第 ${page} 页 ---\n${text}`)
      } catch {
        // ignore
      }
    }
    const joined = parts.join('\n').trim()
    if (!joined) return null
    const { text } = reassembleDirectoryText(joined, {
      pageCount: numPages,
      pageOffset: tocPageOffset,
    })
    return text.trim() || null
  }, [numPages, readPageText, tocPageFrom, tocPageOffset, tocPageTo])

  const getTocPageImages = useCallback(async (): Promise<TocPromptImage[] | null> => {
    const pdf = pdfDocRef.current
    if (!pdf) return null
    const from = Math.min(tocPageFrom, tocPageTo)
    const to = Math.max(tocPageFrom, tocPageTo)
    const pages: number[] = []
    for (let page = from; page <= to; page += 1) pages.push(page)
    const rendered = await renderPdfPagesToPng(pdf, pages, 1.5)
    if (rendered.length === 0) return null
    const images: TocPromptImage[] = []
    for (const item of rendered) {
      if (item.blob.size > ACP_MAX_IMAGE_BYTES) continue
      try {
        images.push({
          base64: await blobToBase64(item.blob),
          mimeType: 'image/png',
          name: `toc-p${item.page}.png`,
        })
      } catch {
        // ignore
      }
    }
    return images.length > 0 ? images : null
  }, [pdfDocRef, tocPageFrom, tocPageTo])

  const handleSuggestOffset = useCallback(async () => {
    if (suggestingOffset) return
    if (ocrTocEntries.length === 0) {
      toast.error('请先识别目录')
      return
    }
    setSuggestingOffset(true)
    try {
      const from = Math.min(tocPageFrom, tocPageTo)
      const to = Math.max(tocPageFrom, tocPageTo)
      const skip: number[] = []
      for (let page = from; page <= to; page += 1) skip.push(page)
      const result = await suggestTocPageOffset(
        ocrTocEntries,
        async (pdfPage) => {
          try {
            return await readPageText(pdfPage, { allowAutoOcr: false })
          } catch {
            return null
          }
        },
        { pageCount: numPages, skipPdfPages: skip },
      )
      if (!result) {
        toast.error('正文页无文字层，无法自动推算，请手填偏移')
        return
      }
      setTocPageOffset(result.offset)
      if (result.agree < result.total) {
        toast.message(
          `已按 ${result.agree}/${result.total} 个标题对齐：偏移=${result.offset}，其余未对齐，请核对`,
        )
      } else {
        toast.success(`已按 ${result.total} 个标题对齐：偏移=${result.offset}`)
      }
    } finally {
      setSuggestingOffset(false)
    }
  }, [numPages, ocrTocEntries, readPageText, suggestingOffset, tocPageFrom, tocPageTo])

  const handleOpenOcrTocEditor = useCallback(() => {
    const fallbackUnits = outlineUnits.map((unit) => ({
      label: unit.label,
      href: unit.href,
      level: unit.level,
    }))
    setOcrTocEntries((prev) =>
      resolveOcrTocEditorEntries({
        ocrTocEntries: prev,
        outlineUnits: fallbackUnits,
        pageOffset: tocPageOffset,
      }),
    )
    setOcrTocEditMode(true)
    setTocOpen(true)
  }, [outlineUnits, setTocOpen, tocPageOffset])

  const handleClearOcrCache = useCallback(async () => {
    if (!fileFingerprint) return
    if (!window.confirm('将清除本书已识别的正文页与目录缓存，是否继续？')) return

    const result = await clearPdfOcrCache({ fileFingerprint })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }

    resetPageOcr()

    if (outlineSource === 'ocr' && pdfDocRef.current) {
      const units = await loadPdfOutlineInfo(pdfDocRef.current)
      setOutlineUnits(units.units)
      setOutlineSource(units.source)
      setOutlineNotice(formatPdfOutlineNotice(units, isScannedPdf))
    }

    setOcrTocEntries([])
    setOcrTocEditMode(false)
    setOcrTocEditorOpen(true)
    setOcrBannerDismissed(false)
    setOcrTocNotice(null)
    toast.success('已清除本书 OCR 缓存')
  }, [fileFingerprint, isScannedPdf, outlineSource, pdfDocRef, resetPageOcr, setOcrTocNotice, setOutlineNotice, setOutlineSource, setOutlineUnits])

  const ocrTocAvailable = canUseOcrToc({ outlineSource, isScannedPdf, isMixedPdf })
  const ocrTocBusy = ocrRecognizing || tocDetecting || ocrTocSaving

  const showOcrBanner =
    (ocrTocAvailable && outlineSource === 'page-fallback' && !ocrBannerDismissed) ||
    ocrRecognizing ||
    (ocrTocAvailable && ocrTocEditorOpen)

  const placedOcrTocNotice = placeOcrTocNotice(ocrTocNotice, outlineSource)

  return {
    ocrBannerDismissed,
    setOcrBannerDismissed,
    bookmarkSlimDismissed,
    setBookmarkSlimDismissed,
    ocrTocEditorOpen,
    setOcrTocEditorOpen,
    ocrTocEditMode,
    setOcrTocEditMode,
    ocrTocEntries,
    setOcrTocEntries,
    ocrTocSaving,
    ocrRecognizing,
    tocPageFrom,
    setTocPageFrom,
    tocPageTo,
    setTocPageTo,
    tocPageOffset,
    setTocPageOffset,
    tocDetecting,
    tocDetectFeedback,
    setTocDetectFeedback,
    suggestingOffset,
    ocrTocAvailable,
    ocrTocBusy,
    showOcrBanner,
    placedOcrTocNotice,
    handleRecognizeToc,
    handleSaveOcrToc,
    handleDetectTocPages,
    handleSelectDetectCandidate,
    handleTocPageFromChange,
    handleTocPageToChange,
    getTocOcrText,
    getTocPageImages,
    handleSuggestOffset,
    handleOpenOcrTocEditor,
    handleClearOcrCache,
  }
}
