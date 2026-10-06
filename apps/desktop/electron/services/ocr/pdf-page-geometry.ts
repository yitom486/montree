/**
 * U1 只读几何：inspector 页对象（OcrPageResult）不带页尺寸，只有 spans 的
 * PDF 点坐标；页词缓存归一化需要与 recognizePdfPage 同一约定的用户空间宽高。
 * 用 pdfjs legacy 构建（纯 Node 可跑，无 DOM 依赖），只 getPage + getViewport(scale=1)，
 * 不渲染、不 OCR、不写任何文件。拿不到尺寸返回空表，调用方按页跳过，
 * 禁止用 612×792 等假尺寸归一化。
 */

import { copyPdfBytesForPdfJs } from '@montree/ocr-core'
import type { PdfPageSizePt } from '@montree/ocr-core'

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export interface PdfJsGeometryViewport {
    width: number
    height: number
  }
  export interface PdfJsGeometryPage {
    getViewport(options: { scale: number }): PdfJsGeometryViewport
  }
  export interface PdfJsGeometryDocument {
    numPages: number
    getPage(pageNumber: number): Promise<PdfJsGeometryPage>
    destroy?: () => Promise<void> | void
    cleanup?: () => Promise<void> | void
  }
  export function getDocument(options: {
    data: Uint8Array
    isEvalSupported?: boolean
    useSystemFonts?: boolean
  }): { promise: Promise<PdfJsGeometryDocument> }
}

/**
 * 只读取给定页的用户空间尺寸（scale=1 viewport）。输入非法/解析失败一律
 * 返回空表（不抛错，调用方跳过该页缓存；上游 SQLite 已入库不受影响）。
 */
export async function readPdfPageSizes(
  data: Buffer,
  pages: readonly number[],
): Promise<Map<number, PdfPageSizePt>> {
  const sizes = new Map<number, PdfPageSizePt>()
  const wanted = [...new Set(pages)].filter(
    (page): page is number => Number.isInteger(page) && page > 0,
  )
  if (wanted.length === 0 || data.byteLength === 0) return sizes
  try {
    const mod = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await mod
      .getDocument({
        data: copyPdfBytesForPdfJs(data),
        isEvalSupported: false,
        useSystemFonts: true,
      })
      .promise
    try {
      for (const pageNumber of wanted) {
        if (pageNumber > doc.numPages) continue
        const page = await doc.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1 })
        if (viewport.width > 0 && viewport.height > 0) {
          sizes.set(pageNumber, { width: viewport.width, height: viewport.height })
        }
      }
    } finally {
      try {
        if (typeof doc.destroy === 'function') await doc.destroy()
        else if (typeof doc.cleanup === 'function') await doc.cleanup()
      } catch {
        // 几何读取已完成，释放失败不影响结果
      }
    }
  } catch {
    // 拿不到真实尺寸：返回空表，调用方停手（不用假尺寸）
  }
  return sizes
}
