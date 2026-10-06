import { readFile } from 'node:fs/promises'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { DEFAULT_PDF_TOC_DETECT_SCALE } from '@montree/contracts'
import type { DetectPdfTocPagesPayload, DetectPdfTocPagesResult } from '@montree/contracts'
import {
  resolveDetectWindow,
  scoreTocPageMarkdown,
  selectTocPageRange,
} from '@montree/ocr-core'
import { ensureInspectorOcrRuntime } from './inspector-ocr-runtime'

async function loadPdfInspector() {
  return await import('@firecrawl/pdf-inspector')
}

/**
 * 目录页范围探测：只建议范围，不识别、不写缓存。
 *
 * 成本上限三件套（见 shared/reader/toc-page-detect 注释）：
 * - 只看文档前部固定窗口（min(40, 总页数)），不扫整本；
 * - 低清档（1.5，108dpi），正式识别仍走 2.5；
 * - 原始 OCR 文本不出本函数（只出评分与范围），不写任何缓存。
 */
export async function detectPdfTocPages(
  payload: DetectPdfTocPagesPayload,
): Promise<Result<DetectPdfTocPagesResult, AppError>> {
  const { filePath, pageCount } = payload
  if (!filePath || !Number.isInteger(pageCount) || pageCount < 1) {
    return err({ code: 'INVALID_ARGUMENT', message: '文件路径或总页数无效' })
  }

  const window = resolveDetectWindow(pageCount)
  if (window.length === 0) {
    return err({ code: 'INVALID_ARGUMENT', message: '文件路径或总页数无效' })
  }

  const runtime = await ensureInspectorOcrRuntime()
  if (!runtime.ok) {
    return err({ code: 'OCR_FAILED', message: runtime.error.message })
  }

  try {
    const data = await readFile(filePath)
    const mod = await loadPdfInspector()
    const result = await mod.processPdfWithOcr(data, {
      mode: mod.OcrMode.Auto,
      pageNumbers: window,
      dpi: Math.round(DEFAULT_PDF_TOC_DETECT_SCALE * 72),
      modelDirectory: runtime.value.modelDir,
      offline: true,
      minimumConfidence: 0.3,
    })
    const ordered = [...result.pages].sort((a, b) => a.pageNumber - b.pageNumber)
    const ocrPages = ordered.filter((page) => page.provenance?.source !== 'Native').length
    const scores = ordered.map((page) =>
      scoreTocPageMarkdown(page.pageNumber, page.markdown ?? ''),
    )
    const selection = selectTocPageRange(scores)
    const base: Pick<DetectPdfTocPagesResult, 'candidates' | 'pagesScanned' | 'ocrPages'> = {
      candidates: selection.candidates,
      pagesScanned: ordered.length,
      ocrPages,
    }
    if (selection.outcome === 'found') {
      return ok({
        ...base,
        outcome: 'found',
        fromPage: selection.fromPage as number,
        toPage: selection.toPage as number,
      })
    }
    if (selection.outcome === 'ambiguous') {
      const [first, second] = selection.candidates
      return ok({
        ...base,
        outcome: 'ambiguous',
        reason: `发现多处疑似目录（第 ${first?.fromPage}–${first?.toPage} 页、第 ${second?.fromPage}–${second?.toPage} 页），分数接近，请手动确认范围`,
      })
    }
    return ok({
      ...base,
      outcome: 'not-found',
      reason: `前 ${ordered.length} 页未找到可靠目录页，请手动填写范围`,
    })
  } catch (cause) {
    return err({
      code: 'OCR_FAILED',
      message: cause instanceof Error ? cause.message : '目录页探测失败',
    })
  }
}
