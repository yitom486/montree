import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { PDF_OCR_TOC_CACHE_VERSION } from '@montree/contracts'
import type { PdfOcrTocCache } from '@montree/contracts'

export { PDF_OCR_TOC_CACHE_VERSION }

function ocrCacheRoot(): string {
  return join(app.getPath('userData'), 'ocr-cache')
}

function cacheFilePath(fileFingerprint: string): string {
  const hash = createHash('sha256').update(fileFingerprint).digest('hex').slice(0, 16)
  return join(ocrCacheRoot(), `${hash}.json`)
}

export async function readPdfOcrTocCache(
  fileFingerprint: string,
): Promise<PdfOcrTocCache | null> {
  try {
    const raw = await readFile(cacheFilePath(fileFingerprint), 'utf8')
    const parsed = JSON.parse(raw) as PdfOcrTocCache
    // 版本容忍：旧版不断然丢弃，交由评估分为 legacy/suspect；
    // 缺文件/解析失败才视为无缓存。绝不在此自动删除。
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function writePdfOcrTocCache(cache: PdfOcrTocCache): Promise<void> {
  await mkdir(ocrCacheRoot(), { recursive: true })
  const stamped: PdfOcrTocCache = { ...cache, extractorVersion: PDF_OCR_TOC_CACHE_VERSION }
  await writeFile(cacheFilePath(cache.fileFingerprint), JSON.stringify(stamped, null, 2), 'utf8')
}

export async function deletePdfOcrTocCache(fileFingerprint: string): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises')
    await unlink(cacheFilePath(fileFingerprint))
  } catch {
    // ignore missing
  }
}

export async function clearAllPdfOcrCaches(): Promise<void> {
  try {
    await rm(ocrCacheRoot(), { recursive: true, force: true })
  } catch {
    // ignore missing
  }
}
