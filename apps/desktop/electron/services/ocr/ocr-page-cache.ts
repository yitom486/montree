import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { PdfOcrPageCache } from '@montree/contracts'

function docCacheDir(fileFingerprint: string): string {
  const hash = createHash('sha256').update(fileFingerprint).digest('hex').slice(0, 16)
  return join(app.getPath('userData'), 'ocr-cache', hash, 'pages')
}

function pageFilePath(fileFingerprint: string, page: number): string {
  return join(docCacheDir(fileFingerprint), `${page}.json`)
}

export async function readPdfOcrPageCache(
  fileFingerprint: string,
  page: number,
): Promise<PdfOcrPageCache | null> {
  try {
    const raw = await readFile(pageFilePath(fileFingerprint, page), 'utf8')
    const cache = JSON.parse(raw) as PdfOcrPageCache
    if (cache.page !== page) return null
    return cache
  } catch {
    return null
  }
}

export async function writePdfOcrPageCache(cache: PdfOcrPageCache): Promise<void> {
  await mkdir(docCacheDir(cache.fileFingerprint), { recursive: true })
  await writeFile(
    pageFilePath(cache.fileFingerprint, cache.page),
    JSON.stringify(cache, null, 2),
    'utf8',
  )
}

export async function listPdfOcrPageCachePages(fileFingerprint: string): Promise<number[]> {
  try {
    const names = await readdir(docCacheDir(fileFingerprint))
    return names
      .map((name) => Number.parseInt(name.replace(/\.json$/, ''), 10))
      .filter((page) => Number.isInteger(page) && page > 0)
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

export async function deleteAllPdfOcrPageCaches(fileFingerprint: string): Promise<void> {
  try {
    await rm(docCacheDir(fileFingerprint), { recursive: true, force: true })
  } catch {
    // ignore missing
  }
}
