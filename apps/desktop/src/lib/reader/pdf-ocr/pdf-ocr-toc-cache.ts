import { ocrTocToReaderUnits } from '@montree/ocr-core'
import type { OcrTocEntry, PdfOcrTocCache, ReaderTocUnit } from '@montree/contracts'

export function buildPdfOcrTocCache(params: {
  fileFingerprint: string
  tocPageRange: [number, number]
  pageOffset: number
  entries: OcrTocEntry[]
}): PdfOcrTocCache {
  const entries = params.entries
    .map((entry) => ({
      title: entry.title.trim(),
      printedPage: entry.printedPage,
      level: entry.level,
      // 证据来源随条目持久化（pipe/geo/ai/manual，合并裁决用）；用户修订不带旧摘要
      source: entry.source,
    }))
    .filter((entry) => entry.title.length > 0 && entry.printedPage > 0)

  return {
    fileFingerprint: params.fileFingerprint,
    tocPageRange: params.tocPageRange,
    pageOffset: params.pageOffset,
    entries,
    units: ocrTocToReaderUnits(
      entries.map((entry) => ({ ...entry, raw: entry.title })),
      params.pageOffset,
    ),
    createdAt: new Date().toISOString(),
    // 用户点保存（含 AI 核对后保存）即视为已确认：短目录也不被完整性规则隐藏
    origin: 'reviewed',
  }
}

/**
 * 打开校正目录时的条目决议（纯函数，被 PdfViewer 的 handleOpenOcrTocEditor
 * 与状态条“校正目录”按钮实际调用）：保留现有 entries；为空才从侧栏 units
 * 回填；两者皆空保持为空。不发起任何 OCR。
 */
export function resolveOcrTocEditorEntries(params: {
  ocrTocEntries: OcrTocEntry[]
  outlineUnits: ReaderTocUnit[]
  pageOffset: number
}): OcrTocEntry[] {
  if (params.ocrTocEntries.length > 0) return params.ocrTocEntries
  if (params.outlineUnits.length === 0) return params.ocrTocEntries
  return readerUnitsToOcrEntries(params.outlineUnits, params.pageOffset)
}

export function readerUnitsToOcrEntries(
  units: ReaderTocUnit[],
  pageOffset: number,
): OcrTocEntry[] {
  return units.map((unit) => ({
    title: unit.label,
    printedPage: Math.max(1, Number.parseInt(unit.href, 10) - pageOffset),
    level: unit.level,
  }))
}
