import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { toast } from 'sonner'
import { recognizePdfOcrPage } from '@/api/ocr-api'
import {
  assertOcrCachePage,
  pdfPageNeedsOcr,
  readPdfPageNativeText,
  textFromOcrPageCache,
} from '@/lib/reader/pdf/pdf-page-text'
import { assertPageOcrAllowed, mergeOcrPageCaches } from '@/lib/reader/pdf-ocr/pdf-page-auto-ocr'
import type { PdfOcrPageCache } from '@montree/contracts'
import { useAppSettingsStore } from '@/stores/app-settings-store'

/**
 * PDF 单页 OCR 域：页缓存 / 识别去重 / 统一正文读取。
 * 目录 OCR（横幅 / 目录编辑器 / 大纲联动）仍在 PdfViewer 内，两域仅经
 * fileFingerprint 与 hydrate/resetPageOcr 交互。
 */
export interface PdfPageOcrOptions {
  filePath: string
  fileFingerprint: string
  pageNum: number
  pdfDocRef: { current: PDFDocumentProxy | null }
  isScannedPdf: boolean
  isMixedPdf: boolean
  /**
   * 调用方视口的 PDF 点尺寸（inspector 几何归一化用，与覆盖层同族）。
   * 缺失时单页识别降级报错（调用方须从 pdfjs viewport 提供）。
   */
  getPageSizePt?: (page: number) => Promise<{ width: number; height: number } | null>
  /**
   * W3：全书导入进行中（调用方传 rosettaImport.state === 'running'）。
   * 为 true 时 runPageOcr 直接拒绝，防第二趟 OCR 叠跑（W1：单次 OCR 常驻 2–3GB）。
   */
  importRunning?: boolean
}

export function usePdfPageOcr(options: PdfPageOcrOptions) {
  const {
    filePath,
    fileFingerprint,
    pageNum,
    pdfDocRef,
    isScannedPdf,
    isMixedPdf,
    getPageSizePt,
    importRunning = false,
  } = options
  const pdfOcrScale = useAppSettingsStore((state) => state.pdfOcrScale)

  const [ocrPageCaches, setOcrPageCaches] = useState<Record<number, PdfOcrPageCache>>({})
  const [ocrPageRecognizing, setOcrPageRecognizing] = useState<number | null>(null)
  const [ocrPagesInFlight, setOcrPagesInFlight] = useState<ReadonlySet<number>>(() => new Set())

  const ocrPagePendingRef = useRef<Map<number, Promise<string>>>(new Map())
  const ocrPageCachesRef = useRef(ocrPageCaches)
  // 调用时刻判定（ref 镜像，避免回调身份随导入状态抖动）
  const importRunningRef = useRef(importRunning)
  useEffect(() => {
    importRunningRef.current = importRunning
  }, [importRunning])

  useEffect(() => {
    ocrPageCachesRef.current = ocrPageCaches
  }, [ocrPageCaches])

  const currentPageOcrReady = Boolean(ocrPageCaches[pageNum]?.words.length)
  const currentPageOcrBusy =
    ocrPageRecognizing === pageNum || ocrPagesInFlight.has(pageNum)

  const ocrRecognizedCount = useMemo(
    () => Object.values(ocrPageCaches).filter((cache) => cache.words.length > 0).length,
    [ocrPageCaches],
  )

  /** 文档切换：清页缓存与识别态（含去重表，避免旧文档任务串入新文档） */
  const resetPageOcr = useCallback(() => {
    setOcrPageCaches({})
    setOcrPageRecognizing(null)
    setOcrPagesInFlight(new Set())
    ocrPagePendingRef.current.clear()
  }, [])

  /** 文档打开 / 导入 progress：按页合并已持久化的页缓存（不丢内存中已有页） */
  const hydratePageCaches = useCallback((caches: Record<number, PdfOcrPageCache>) => {
    setOcrPageCaches((prev) => mergeOcrPageCaches(prev, caches))
  }, [])

  const runPageOcr = useCallback(
    async (page: number): Promise<string> => {
      if (!fileFingerprint) {
        throw new Error(`第 ${page} 页 OCR 失败：文档指纹未就绪`)
      }

      const pending = ocrPagePendingRef.current.get(page)
      if (pending) return pending

      const task = (async () => {
        assertPageOcrAllowed({ importRunning: importRunningRef.current, page })
        setOcrPagesInFlight((prev) => new Set(prev).add(page))
        try {
          const size = await getPageSizePt?.(page)
          if (!size || !(size.width > 0) || !(size.height > 0)) {
            throw new Error(`第 ${page} 页 OCR 失败：页面尺寸未就绪`)
          }
          const result = await recognizePdfOcrPage({
            filePath,
            fileFingerprint,
            page,
            scale: pdfOcrScale,
            pageWidthPt: size.width,
            pageHeightPt: size.height,
          })
          if (result.ok) {
            if (result.value.page !== page) {
              throw new Error(`OCR 结果页码不一致：请求第 ${page} 页，返回第 ${result.value.page} 页`)
            }
            setOcrPageCaches((prev) => ({ ...prev, [page]: result.value }))
            return textFromOcrPageCache(result.value)
          }
          throw new Error(`第 ${page} 页 OCR 失败：${result.error.message}`)
        } finally {
          setOcrPagesInFlight((prev) => {
            const next = new Set(prev)
            next.delete(page)
            return next
          })
        }
      })().finally(() => {
        ocrPagePendingRef.current.delete(page)
      })

      ocrPagePendingRef.current.set(page, task)
      return task
    },
    [fileFingerprint, filePath, pdfOcrScale, getPageSizePt],
  )

  const handleRecognizePage = useCallback(async () => {
    if (!fileFingerprint || ocrPageRecognizing !== null) return
    setOcrPageRecognizing(pageNum)
    try {
      await runPageOcr(pageNum)
      toast.success(`第 ${pageNum} 页已识别，可划词划重点`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '本页识别失败或无文字'
      toast.error(message)
    } finally {
      setOcrPageRecognizing(null)
    }
  }, [fileFingerprint, ocrPageRecognizing, pageNum, runPageOcr])

  /**
   * 统一正文读取：嵌入文字层 → OCR 缓存 → 扫描版按需 OCR。
   * Agent（montree_read 等）与 UI 共用此路径，MCP 工具接口不变。
   */
  const readPageText = useCallback(
    async (page: number, options?: { allowAutoOcr?: boolean }): Promise<string> => {
      const allowAutoOcr = options?.allowAutoOcr ?? true
      const cached = ocrPageCaches[page]
      if (cached?.words.length) {
        assertOcrCachePage(cached, page)
        return textFromOcrPageCache(cached)
      }

      const pdf = pdfDocRef.current
      if (!pdf) {
        throw new Error(`第 ${page} 页无法读取：PDF 尚未加载完成`)
      }

      const native = await readPdfPageNativeText(pdf, page)
      if (!pdfPageNeedsOcr(native)) return native

      if ((!isScannedPdf && !isMixedPdf) || !fileFingerprint) return native

      if (!allowAutoOcr) {
        throw new Error(
          `第 ${page} 页尚未识别，且已关闭 Agent 自动 OCR。请手动点击工具栏「识别本页」。`,
        )
      }

      return runPageOcr(page)
    },
    [fileFingerprint, isMixedPdf, isScannedPdf, ocrPageCaches, runPageOcr],
  )

  /** 后台预识别用：该页是否已有在途任务（去重表，不经过 state） */
  const hasPendingPageOcr = useCallback((page: number): boolean => {
    return ocrPagePendingRef.current.has(page)
  }, [])

  return {
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
  }
}
