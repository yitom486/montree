import { readFile } from 'node:fs/promises'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import {
  defaultPdfPageOffset,
  extractOcrTocFromText,
  ocrTocToReaderUnits,
} from '@montree/ocr-core'
import { cleanOcrWatermarks } from '@montree/ocr-core'
import { buildSectionPageMap } from '@montree/ocr-core'
import type { PdfOcrTocCache, RecognizePdfTocPayload } from '@montree/contracts'
import { DEFAULT_PDF_TOC_SCALE } from '@montree/contracts'
import { writePdfOcrTocCache } from './ocr-toc-cache'
import { ensureInspectorOcrRuntime } from './inspector-ocr-runtime'

async function loadPdfInspector() {
  return await import('@firecrawl/pdf-inspector')
}

export async function recognizePdfToc(
  payload: RecognizePdfTocPayload,
): Promise<Result<PdfOcrTocCache, AppError>> {
  const { fromPage, toPage } = payload
  if (fromPage < 1 || toPage < fromPage) {
    return err({ code: 'INVALID_ARGUMENT', message: '目录页范围无效' })
  }

  try {
    return await recognizePdfTocWithInspector(payload)
  } catch (cause) {
    return err({
      code: 'OCR_FAILED',
      message: cause instanceof Error ? cause.message : '目录识别失败',
    })
  }
}

/** 主路径：pdf-inspector 整范围选择性 OCR，文本进同一套启发式解析 */
async function recognizePdfTocWithInspector(
  payload: RecognizePdfTocPayload,
): Promise<Result<PdfOcrTocCache, AppError>> {
  const { filePath, fileFingerprint, fromPage, toPage, pageOffset } = payload
  // 目录页强制清晰档（仅数页，成本可忽略）：忽略调用方全局档，不降低目录质量
  const scale = DEFAULT_PDF_TOC_SCALE

  const runtime = await ensureInspectorOcrRuntime()
  if (!runtime.ok) {
    throw new Error(runtime.error.message)
  }

  try {
    const data = await readFile(filePath)
    const mod = await loadPdfInspector()
    const pageNumbers: number[] = []
    for (let page = fromPage; page <= toPage; page += 1) pageNumbers.push(page)
    const result = await mod.processPdfWithOcr(data, {
      mode: mod.OcrMode.Auto,
      pageNumbers,
      dpi: Math.round(scale * 72),
      modelDirectory: runtime.value.modelDir,
      offline: true,
      minimumConfidence: 0.3,
    })
    const ordered = [...result.pages].sort((a, b) => a.pageNumber - b.pageNumber)
    // 水印/页眉先清洗再解析，避免“王道计”这类跨页重复行污染目录条目；
    // 清洗永不删除表格行，目录页表格不受影响
    const cleaned = cleanOcrWatermarks(
      ordered.map((page) => ({
        page: page.pageNumber,
        markdown: page.markdown ?? '',
        spans: page.spans ?? [],
      })),
    )
    const textParts = cleaned.pages.map((page) => page.markdown)

    const tocPageRange: [number, number] = [fromPage, toPage]
    const resolvedOffset = pageOffset ?? defaultPdfPageOffset(tocPageRange)
    // 先重组（竖线拆分/数字汤配对/范围门/几何直配）再提取：页数由调用方给，不再解析一次；
    // 页数非法（IPC 越界/NaN 落成 null）则退化 legacy，不断整条链路
    const rawPageCount: unknown = payload.pageCount
    const pageCount =
      typeof rawPageCount === 'number' && Number.isInteger(rawPageCount) && rawPageCount > 0
        ? rawPageCount
        : undefined
    // 几何配对：spans 坐标把右列页码钉回同行标题（第 8 页实录：串行全丢，坐标全对）；
    // 失败/无 spans 时退化纯串行。phantom 碎片由置信门挡（见 toc-geometry）。
    let geometryPages: Map<string, number> | undefined
    if (pageCount !== undefined) {
      try {
        geometryPages = new Map<string, number>()
        for (const page of ordered) {
          const spans = (page.spans ?? []) as {
            text: string
            x: number
            y: number
            confidence: number
          }[]
          const built = buildSectionPageMap(spans, { pageCount, pageOffset: resolvedOffset })
          for (const [section, printed] of built.pages) {
            if (!geometryPages.has(section)) geometryPages.set(section, printed)
          }
        }
      } catch {
        geometryPages = undefined
      }
    }
    // 识别摘要只存计数（审计口径，不存原文）；source 随条目持久化（合并裁决用）
    const diagnostics: {
      stats?: {
        pipeRows?: number
        geoPaired?: number
        paired?: number
        droppedPool?: number
        droppedLines?: number
      }
    } = {}
    const entries = extractOcrTocFromText(
      textParts.join('\n'),
      pageCount === undefined
        ? undefined
        : {
            pageCount,
            pageOffset: resolvedOffset,
            geometryPages,
            onDiagnostics: (stats) => {
              diagnostics.stats = stats
            },
          },
    )
    if (entries.length === 0) {
      return err({
        code: 'OCR_TOC_EMPTY',
        message: '未从目录页识别到章节条目，请调整页码范围后重试',
      })
    }

    const units = ocrTocToReaderUnits(entries, resolvedOffset)

    const cache: PdfOcrTocCache = {
      fileFingerprint,
      tocPageRange,
      pageOffset: resolvedOffset,
      entries: entries.map(({ title, printedPage, level, source }) => ({
        title,
        printedPage,
        level,
        source,
      })),
      units,
      createdAt: new Date().toISOString(),
      origin: 'auto',
      stats: {
        requestedPages: pageNumbers.length,
        processedPages: ordered.length,
        acceptedEntries: entries.length,
        pipeRows: diagnostics.stats?.pipeRows,
        geoPaired: diagnostics.stats?.geoPaired,
        soupPaired: diagnostics.stats?.paired,
        droppedPool: diagnostics.stats?.droppedPool,
        droppedLines: diagnostics.stats?.droppedLines,
        watermarkRemovedLines: cleaned.removedLines,
      },
    }

    await writePdfOcrTocCache(cache)
    return ok(cache)
  } catch (cause) {
    return err({
      code: 'OCR_FAILED',
      message: cause instanceof Error ? cause.message : '目录识别失败',
    })
  }
}
