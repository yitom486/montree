import type { PdfOcrPageCache, PdfOcrTocCache } from '@montree/contracts'

/**
 * 单页 OCR 词缓存可替换服务接口（纯类型，零实现）。
 * 当前唯一 adapter 为主进程文件缓存，未来抽取时实现本接口即可替换。
 */
export interface OcrPageCachePort {
  /** 当前 adapter：electron/services/ocr/ocr-page-cache.ts:16 readPdfOcrPageCache */
  read(fileFingerprint: string, page: number): Promise<PdfOcrPageCache | null>
  /** 当前 adapter：electron/services/ocr/ocr-page-cache.ts:30 writePdfOcrPageCache */
  write(cache: PdfOcrPageCache): Promise<void>
  /** 当前 adapter：electron/services/ocr/ocr-page-cache.ts:39 listPdfOcrPageCachePages */
  listPages(fileFingerprint: string): Promise<number[]>
  /** 当前 adapter：electron/services/ocr/ocr-page-cache.ts:51 deleteAllPdfOcrPageCaches */
  deleteAll(fileFingerprint: string): Promise<void>
}

/**
 * 目录 OCR 缓存可替换服务接口（纯类型，零实现）。
 * 当前唯一 adapter 为主进程文件缓存，未来抽取时实现本接口即可替换。
 */
export interface OcrTocCachePort {
  /** 当前 adapter：electron/services/ocr/ocr-toc-cache.ts:19 readPdfOcrTocCache */
  read(fileFingerprint: string): Promise<PdfOcrTocCache | null>
  /** 当前 adapter：electron/services/ocr/ocr-toc-cache.ts:36 writePdfOcrTocCache */
  write(cache: PdfOcrTocCache): Promise<void>
  /** 当前 adapter：electron/services/ocr/ocr-toc-cache.ts:42 deletePdfOcrTocCache */
  delete(fileFingerprint: string): Promise<void>
  /** 当前 adapter：electron/services/ocr/ocr-toc-cache.ts:51 clearAllPdfOcrCaches */
  clearAll(): Promise<void>
}
