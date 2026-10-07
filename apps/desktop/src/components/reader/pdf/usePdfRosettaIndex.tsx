import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Database, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRosettaImport } from '@/hooks/reader/useRosettaImport'
import { resolveRosettaTocEntries } from '@/lib/reader/rosetta/rosetta-toc'
import { getCurrentRosettaTocSignature, resolveRosettaIndexStatus } from '@/lib/reader/rosetta/rosetta-toc-status'
import { resolvePreferNativeImport, shouldOfferPageOcr } from '@/lib/reader/pdf/pdf-import-mode'
import {
  resolvePdfIndexBadge,
  resolveRosettaIndexMenuAction,
  type PdfToolbarMenuItem,
} from '@/components/reader/PdfToolbarMoreMenu'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import type { OcrTocEntry } from '@montree/contracts'
import type { ReaderUnit } from '@montree/reader-core'
import { toast } from 'sonner'

export interface UsePdfRosettaIndexOptions {
  filePath: string
  fileFingerprint: string
  numPages: number
  pageNum: number
  outlineUnits: ReaderUnit[]
  ocrTocEntries: OcrTocEntry[]
  tocPageOffset: number
  isScannedPdf: boolean
  isMixedPdf: boolean
  outlineSource: string
  ready: boolean
  fitWidth: () => void
  setScale: (update: (val: number) => number) => void
  handleRecognizePage: () => Promise<void>
  handleOpenOcrTocEditor: () => void
  handleClearOcrCache: () => Promise<void>
  currentPageOcrBusy: boolean
  currentPageOcrReady: boolean
  ocrRecognizedCount: number
}

export function usePdfRosettaIndex({
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
}: UsePdfRosettaIndexOptions) {
  const rosettaImport = useRosettaImport(fileFingerprint)
  const pdfOcrScale = useAppSettingsStore((state) => state.pdfOcrScale)
  const [bodyWatermarkPreviewOpen, setBodyWatermarkPreviewOpen] = useState(false)
  const [rosettaRebuilding, setRosettaRebuilding] = useState(false)

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
      onSelect: () => handleOpenOcrTocEditor(),
    })
  }
  if (outlineSource === 'embedded' && (isScannedPdf || isMixedPdf)) {
    moreMenuItems.push({
      key: 'recognize-toc',
      label: '识别印刷目录',
      title: '探测印刷目录页并识别自建目录（书签保留，保存后以自建目录为准；全书导入中不可用）',
      disabled: rosettaImport.state === 'running',
      onSelect: () => handleOpenOcrTocEditor(),
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
    rosettaImport,
    rosettaTocStatus,
    indexBadge,
    moreMenuItems,
    rosettaExtraAction,
    bodyWatermarkPreviewOpen,
    setBodyWatermarkPreviewOpen,
    handleRosettaImport,
    handleRosettaRebuildToc,
  }
}
