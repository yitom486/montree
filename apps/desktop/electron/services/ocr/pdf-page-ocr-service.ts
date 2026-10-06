import { readFile } from 'node:fs/promises'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { normalizeInspectorSpans } from '@montree/ocr-core'
import type { PdfOcrPageCache, PdfOcrScale, RecognizePdfPagePayload } from '@montree/contracts'
import { DEFAULT_PDF_OCR_SCALE } from '@montree/contracts'
import { writePdfOcrPageCache } from './ocr-page-cache'
import { ensureInspectorOcrRuntime } from './inspector-ocr-runtime'

const OCR_SCALE = DEFAULT_PDF_OCR_SCALE
/** inspector OCR 置信度门限（0–1；与词过滤 floor 对齐） */
const INSPECTOR_MIN_CONFIDENCE = 0.3

async function loadPdfInspector() {
  return await import('@firecrawl/pdf-inspector')
}

export async function recognizePdfPage(
  payload: RecognizePdfPagePayload,
): Promise<Result<PdfOcrPageCache, AppError>> {
  const { fileFingerprint, page } = payload
  if (page < 1) {
    return err({ code: 'INVALID_ARGUMENT', message: '页码无效' })
  }

  try {
    return await recognizePdfPageWithInspector(payload)
  } catch (cause) {
    return err({
      code: 'OCR_FAILED',
      message: cause instanceof Error ? cause.message : '页面识别失败',
    })
  }
}

/** 主路径：pdf-inspector 选择性 OCR（自带阅读顺序与表格，几何进缓存） */
async function recognizePdfPageWithInspector(
  payload: RecognizePdfPagePayload,
): Promise<Result<PdfOcrPageCache, AppError>> {
  const { filePath, fileFingerprint, page, pageWidthPt, pageHeightPt } = payload
  const scale = payload.scale ?? OCR_SCALE
  if (!(pageWidthPt > 0) || !(pageHeightPt > 0)) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少页面尺寸，无法归一化坐标' })
  }

  const runtime = await ensureInspectorOcrRuntime()
  if (!runtime.ok) {
    throw new Error(runtime.error.message)
  }

  const data = await readFile(filePath)
  const mod = await loadPdfInspector()
  const result = await mod.processPdfWithOcr(data, {
    mode: mod.OcrMode.Auto,
    pageNumbers: [page],
    dpi: Math.round(scale * 72),
    modelDirectory: runtime.value.modelDir,
    offline: true,
    minimumConfidence: INSPECTOR_MIN_CONFIDENCE,
  })
  const found = result.pages.find((item) => item.pageNumber === page)
  const words = normalizeInspectorSpans(
    (found?.spans ?? []).map((span) => ({
      text: span.text,
      confidence: span.confidence,
      x: span.x,
      y: span.y,
      width: span.width,
      height: span.height,
    })),
    pageWidthPt,
    pageHeightPt,
  )

  if (words.length === 0) {
    return err({
      code: 'OCR_PAGE_EMPTY',
      message: '本页未识别到文字，请确认是否为正文页',
    })
  }

  const cache: PdfOcrPageCache = {
    fileFingerprint,
    page,
    pageWidth: pageWidthPt,
    pageHeight: pageHeightPt,
    ocrScale: scale,
    words,
    createdAt: new Date().toISOString(),
  }

  await writePdfOcrPageCache(cache)
  return ok(cache)
}
