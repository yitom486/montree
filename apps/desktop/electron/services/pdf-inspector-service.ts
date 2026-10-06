import { readFile } from 'node:fs/promises'
import { err, ok, type Result } from '@montree/contracts'
import { toAppError, type AppError } from '@montree/contracts'
import type {
  InspectorBookMarkdown,
  InspectorPdfClassification,
} from '@montree/contracts'
import type {
  InspectorPagesMarkdown,
} from '@montree/pdf'
import {
  assembleBookMarkdown,
  mapClassification,
  mapPagesMarkdown,
  toZeroIndexed,
} from '@montree/pdf'

/**
 * pdf-inspector 主进程封装（分类 + 原生抽取；_loading 纯抽取，不碰 OCR 运行时）。
 * 页码约定：对外一律 1-indexed；上游 classifyPdfAsync 是 0-indexed，此处归一。
 * OCR 选择性识别（PP-OCRv6 + PDFium/ORT 外部运行时）另起任务，本模块不动。
 */

async function loadPdfInspector() {
  return await import('@firecrawl/pdf-inspector')
}

function toServiceError(cause: unknown, fallback: string): Result<never, AppError> {
  if (
    cause &&
    typeof cause === 'object' &&
    'code' in cause &&
    (cause as { code?: unknown }).code === 'ENOENT'
  ) {
    return err({ code: 'FILE_NOT_FOUND', message: fallback })
  }
  return err(toAppError(cause, fallback))
}

export async function classifyPdfDocument(
  filePath: string,
): Promise<Result<InspectorPdfClassification, AppError>> {
  try {
    const data = await readFile(filePath)
    const mod = await loadPdfInspector()
    const result = await mod.classifyPdfAsync(data)
    return ok(mapClassification(result))
  } catch (cause) {
    return toServiceError(cause, 'PDF 分类失败')
  }
}

/**
 * 按页抽取 Markdown（原生文字层；扫描页返回空，由调用方决定是否走 OCR）。
 * @param pages 1-indexed 页码；不传则全档
 */
export async function extractPdfPagesMarkdown(
  filePath: string,
  pages?: number[],
): Promise<Result<InspectorPagesMarkdown, AppError>> {
  try {
    const data = await readFile(filePath)
    const mod = await loadPdfInspector()
    const zeroIndexed = toZeroIndexed(pages)
    const result = await mod.extractPagesMarkdownAsync(data, zeroIndexed)
    return ok(mapPagesMarkdown(result))
  } catch (cause) {
    return toServiceError(cause, 'PDF 正文抽取失败')
  }
}

/**
 * 整档 Markdown（原生文字层；扫描页为空，由调用方决定是否走 OCR）。
 * 按 `<!-- Page N -->` 标记拼接，与 WASM 输出同格式，渲染端复用切分。
 */
export async function extractPdfBookMarkdown(
  filePath: string,
): Promise<Result<InspectorBookMarkdown, AppError>> {
  try {
    const data = await readFile(filePath)
    const mod = await loadPdfInspector()
    const result = await mod.extractPagesMarkdownAsync(data)
    return ok(assembleBookMarkdown(result))
  } catch (cause) {
    return toServiceError(cause, 'PDF 整档解析失败')
  }
}
