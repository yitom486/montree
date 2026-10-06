import { readFile, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { buildBookIndex } from '@montree/reader-core'
import { DEFAULT_PDF_OCR_SCALE } from '@montree/contracts'
import type { PdfOcrPageCache } from '@montree/contracts'
import type {
  RosettaActiveImport,
  RosettaImportPayload,
  RosettaImportPhase,
  RosettaImportStats,
} from '@montree/contracts'
import type { InspectorSpanLike } from '@montree/ocr-core'
import { filterOcrHitLayerWords, normalizeInspectorSpans } from '@montree/ocr-core'
import { discoverWatermarksByPosition, isDiagonalStampSpan } from '@montree/ocr-core'
import { ensureInspectorOcrRuntime } from '../ocr/inspector-ocr-runtime'
import { deleteAllPdfOcrPageCaches, writePdfOcrPageCache } from '../ocr/ocr-page-cache'
import { deletePdfOcrTocCache } from '../ocr/ocr-toc-cache'
import { readPdfPageSizes } from '../ocr/pdf-page-geometry'
import { closeBookDb, getBookDbPath, openBookDb } from './open-book-db'
import {
  ensureImportBookRow,
  getCompletedPages,
  importBookChunk,
  markPagesCompleted,
} from './import-book'
import { countBookBlocks, countPagesWithBbox, listOcrSuggestedPages } from './queries'

/** 罗盘入库清洗管线版本；ocr-watermark 语义变更时同步 +1 */
export const ROSETTA_CLEAN_VERSION = 'ocr-watermark-v3'

type InspectorModule = typeof import('@firecrawl/pdf-inspector')

export interface RosettaImportDeps {
  loadInspector?: () => Promise<InspectorModule>
  ensureRuntime?: () => Promise<Result<{ modelDir: string }, AppError>>
  readPdf?: (filePath: string) => Promise<Buffer>
  /** 默认走 userData 落盘库；单测注入 :memory: 库 */
  openDb?: (fingerprint: string) => DatabaseSync
  /** U1：只读页尺寸（默认 pdfjs legacy getPage scale=1）；单测注入假尺寸 */
  readPageSizes?: (
    data: Buffer,
    pages: readonly number[],
  ) => Promise<Map<number, { width: number; height: number }>>
  /** U1：页词缓存落盘（默认 userData/ocr-cache）；写入失败只记日志不回滚 */
  writePageCache?: (cache: PdfOcrPageCache) => Promise<void>
  /** U2：关本书 db handle（默认 closeBookDb）；Windows 上不关删不掉文件 */
  closeBookDb?: (userDataDir: string, fingerprint: string) => boolean
  /** U2：删本书库目录 book-index/<hash>/（默认 rm 整目录）；失败则中止重建 */
  removeBookDbDir?: (userDataDir: string, fingerprint: string) => Promise<void>
  /** U2：删本书 OCR 页缓存（默认 deleteAllPdfOcrPageCaches，指纹内聚不碰其它书） */
  deletePageCaches?: (fingerprint: string) => Promise<void>
  /** U2：删本书 OCR 目录缓存（默认 deletePdfOcrTocCache） */
  deleteTocCache?: (fingerprint: string) => Promise<void>
}

export interface RosettaImportHooks {
  onProgress?: (donePages: number, totalPages: number, phase: RosettaImportPhase) => void
  shouldCancel?: () => boolean
}

async function defaultLoadInspector(): Promise<InspectorModule> {
  return await import('@firecrawl/pdf-inspector')
}

// OCR 引擎 session 互斥串行：同一进程同时只允许一个导入任务
let activeFingerprint: string | null = null
let cancelRequested = false
let activeProgress: RosettaActiveImport | null = null

export function isRosettaImportActive(): boolean {
  return activeFingerprint !== null
}

/** 当前导入快照（挂载/聚焦时轮询，窗口重载不丢状态） */
export function getActiveRosettaImport(): RosettaActiveImport | null {
  return activeProgress
}

export function cancelRosettaImport(): void {
  cancelRequested = true
}

function cancelledError(donePages: number, totalPages: number): Result<never, AppError> {
  return err({
    code: 'CANCELLED',
    message: `已取消罗盘导入，已入库 ${donePages}/${totalPages} 页，下次继续`,
  })
}

async function defaultRemoveBookDbDir(userDataDir: string, fingerprint: string): Promise<void> {
  await rm(dirname(getBookDbPath(userDataDir, fingerprint)), { recursive: true, force: true })
}

/**
 * U2 重建：关本书 handle（Windows 不关删不掉）→ 删整库目录
 * book-index/<hash>/（旧 blocks/completed_pages 一起消失，不新旧混块）→
 * 删本书 OCR 页/目录缓存。然后按新书走现有流程。
 * 任一步失败直接中止，半残库不进 OCR；缺省/false 时不调用，续跑一字不改。
 */
async function wipeBookForRebuild(
  userDataDir: string,
  fingerprint: string,
  deps: RosettaImportDeps | undefined,
): Promise<Result<null, AppError>> {
  try {
    const close = deps?.closeBookDb ?? closeBookDb
    close(userDataDir, fingerprint)
    const removeDir = deps?.removeBookDbDir ?? defaultRemoveBookDbDir
    await removeDir(userDataDir, fingerprint)
    const deletePages = deps?.deletePageCaches ?? deleteAllPdfOcrPageCaches
    await deletePages(fingerprint)
    const deleteToc = deps?.deleteTocCache ?? deletePdfOcrTocCache
    await deleteToc(fingerprint)
    return ok(null)
  } catch (cause) {
    return err({
      code: 'FILE_WRITE_ERROR',
      message: `旧罗盘清除失败，未开始重新识别：${cause instanceof Error ? cause.message : '未知错误'}`,
    })
  }
}

/** 导入完成文案：统计 + 可选的原生差页提示（不触发 OCR） */
export function formatRosettaImportDoneMessage(stats: RosettaImportStats): string {
  const base = `原生 ${stats.nativePages} 页直提，扫描 ${stats.ocrPages} 页识别，${stats.blocks} 块入库`
  const suggested = stats.ocrSuggestedPages.length
  if (suggested <= 0) return base
  return `${base}，${suggested} 页原生质量较差可手动识别`
}

/**
 * U1：同一轮 processPdfWithOcr 的 spans → 页词缓存（打开即划词/Adopt 可定位）。
 * 只写「本轮有 spans」的 OCR 页：原生直提页 spans 为空，天然跳过，
 * 永不写空缓存盖掉原生文字层；只读 chunkSpans，不碰 blocks.bbox。
 * 尺寸来自只读几何（与 recognizePdfPage 同一约定）；拿不到真实尺寸的页
 * 跳过（不用假尺寸）；words 为空不写；写入失败只记日志（可「识别本页」补）。
 * V2：写入前做命中层过滤（chunk 内跨页已证水印 + 方形框先丢 span，
 * 再按行聚类丢斜戳印词），以后导入不再把戳印写进缓存。
 */
async function persistOcrPageCaches(args: {
  fingerprint: string
  scale: number
  data: Buffer
  spansByPage: ReadonlyMap<number, readonly InspectorSpanLike[]>
  routed: readonly number[]
  deps: RosettaImportDeps | undefined
  log: (message: string) => void
}): Promise<void> {
  const routedSet = new Set(args.routed)
  // V2：chunk 内跨页几何发现已证水印（<3 页的 chunk 发现为空，仅走行聚类）
  const watermarks = new Set(
    discoverWatermarksByPosition(
      [...args.spansByPage].map(([page, spans]) => ({ page, markdown: '', spans: spans ?? [] })),
    ),
  )
  const candidates = new Map<number, readonly InspectorSpanLike[]>()
  for (const [page, spans] of args.spansByPage) {
    if (!Number.isInteger(page) || page < 1) continue
    const list = spans ?? []
    // 只写 OCR 页（路由集合或本轮有 spans）；纯文字直提页两者皆无，天然跳过。
    // 有路由无 spans 的页不写空缓存（words.length>0 兜底，不盖原生层）。
    if (!routedSet.has(page) && list.length === 0) continue
    // V2：已证水印 + 方形检测框的斜戳印 span 先丢（横排正文长宽比豁免）
    candidates.set(page, list.filter((span) => !isDiagonalStampSpan(span, watermarks)))
  }
  if (candidates.size === 0) return
  let sizes: Map<number, { width: number; height: number }>
  try {
    const readSizes = args.deps?.readPageSizes ?? readPdfPageSizes
    sizes = await readSizes(args.data, [...candidates.keys()])
  } catch (cause) {
    args.log(
      `页词缓存跳过：页面尺寸读取失败 ${cause instanceof Error ? cause.message : '未知错误'}`,
    )
    return
  }
  const writeCache = args.deps?.writePageCache ?? writePdfOcrPageCache
  for (const [page, spans] of candidates) {
    const size = sizes.get(page)
    if (!size || !(size.width > 0) || !(size.height > 0)) {
      args.log(`页词缓存跳过：第 ${page} 页无真实尺寸，不用假尺寸归一化`)
      continue
    }
    const words = filterOcrHitLayerWords(
      normalizeInspectorSpans([...spans], size.width, size.height),
    )
    if (words.length === 0) continue
    try {
      await writeCache({
        fileFingerprint: args.fingerprint,
        page,
        pageWidth: size.width,
        pageHeight: size.height,
        ocrScale: args.scale,
        words,
        createdAt: new Date().toISOString(),
      })
    } catch (cause) {
      args.log(
        `页词缓存写入失败：第 ${page} 页 ${cause instanceof Error ? cause.message : '未知错误'}（已入库不受影响，可「识别本页」补）`,
      )
    }
  }
}

/**
 * 扫描书一键导入：运行时 → 读文件 → 建库行 → 分块 OCR+入库（可续跑）。
 * 目录由调用方给真实页帧；非法页码条目丢弃。长任务，调用方用 hooks 接进度/取消。
 * 崩溃/取消后重进：已入库块按 completed_pages 跳过，只做剩余块。
 */
export async function importScannedBookToDb(
  userDataDir: string,
  payload: RosettaImportPayload,
  hooks?: RosettaImportHooks,
  deps?: RosettaImportDeps,
): Promise<Result<RosettaImportStats, AppError>> {
  const fingerprint = payload.fileFingerprint.trim()
  if (!fingerprint) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少文件指纹' })
  }
  if (activeFingerprint !== null) {
    return err({ code: 'INVALID_STATE', message: '已有罗盘导入在进行中，请等待完成或取消' })
  }
  activeFingerprint = fingerprint
  cancelRequested = false
  activeProgress = { fingerprint, donePages: 0, totalPages: 0, phase: 'preparing' }
  try {
    return await runImport(userDataDir, payload, fingerprint, hooks, deps)
  } finally {
    activeFingerprint = null
    cancelRequested = false
    activeProgress = null
  }
}

async function runImport(
  userDataDir: string,
  payload: RosettaImportPayload,
  fingerprint: string,
  hooks: RosettaImportHooks | undefined,
  deps: RosettaImportDeps | undefined,
): Promise<Result<RosettaImportStats, AppError>> {
  const ensureRuntime = deps?.ensureRuntime ?? ensureInspectorOcrRuntime
  // P1.2：纯文字书直提，跳过 OCR 运行时（不下载/校验模型）；扫描/混合走旧行为
  const preferNative = payload.preferNative === true
  let modelDir: string | undefined
  if (!preferNative) {
    const runtime = await ensureRuntime()
    if (!runtime.ok) {
      return err({ code: 'OCR_FAILED', message: runtime.error.message })
    }
    modelDir = runtime.value.modelDir
  }
  let data: Buffer
  try {
    data = await (deps?.readPdf ? deps.readPdf(payload.filePath) : readFile(payload.filePath))
  } catch {
    return err({ code: 'FILE_NOT_FOUND', message: 'PDF 文件不存在或无法读取' })
  }
  let mod: InspectorModule
  try {
    mod = await (deps?.loadInspector ? deps.loadInspector() : defaultLoadInspector())
  } catch (cause) {
    return err({
      code: 'OCR_FAILED',
      message: cause instanceof Error ? cause.message : 'OCR 引擎加载失败',
    })
  }

  const scale = payload.scale ?? DEFAULT_PDF_OCR_SCALE
  const dpi = Math.round(scale * 72)
  // classify 省掉：它本身就是一次全量解析（199MB 书 ≈ 数百 MB transient），
  // 页数由渲染端 pdf.js 直接给（同样准确），主进程不再为此解析一次。
  // 非法 PDF 的错误由 OCR 调用本身报出。
  //
  // 大块分段（不是分批）：fork 每次调用都会全量解析整个 PDF
  //（lib.rs load_document_from_mem，选页不减少加载量），17×20 的小分批 =
  // 全量解析 17 次，堆 churn 到 Rust 分配失败直接 abort 主进程。
  // 但全量解析成本只与文件大小有关、与选页数无关，所以块越少越好：
  // 上限 4 块、目标每块 85 页（340 页书 4 步、每步约 2 分钟），
  // 既有进度/取消粒度，又把解析次数压到个位数。管线内部另按 chunk 限流渲染。
  // 代价：块内不可中断，取消在块边界生效。
  const plannedTotal = payload.pageCount
  if (!Number.isInteger(plannedTotal) || plannedTotal < 1) {
    return err({ code: 'INVALID_ARGUMENT', message: '页数无效' })
  }
  const title = payload.title.trim() || basename(payload.filePath)
  const t0 = Date.now()
  const log = (message: string): void => {
    console.info(`[rosetta] ${message}`)
  }
  const track = (donePages: number, phase: RosettaImportPhase): void => {
    activeProgress = { fingerprint, donePages, totalPages: plannedTotal, phase }
    hooks?.onProgress?.(donePages, plannedTotal, phase)
  };
  log(`import start: ${title} ${plannedTotal}页`)
  // U2：确认后重建先清旧库（失败直接中止，不进 OCR）；缺省走续跑
  if (payload.forceRebuild === true) {
    log('rebuild: 清除本书旧罗盘库与 OCR 缓存后全量重建')
    const wiped = await wipeBookForRebuild(userDataDir, fingerprint, deps)
    if (!wiped.ok) {
      log(`rebuild failed: ${wiped.error.message}`)
      return err(wiped.error)
    }
  }
  const chunkCount = Math.min(4, Math.max(1, Math.ceil(plannedTotal / 85)))
  const chunkSize = Math.ceil(plannedTotal / chunkCount)

  const toc = payload.toc
    .filter((entry) => entry && Number.isInteger(entry.realPage) && entry.realPage >= 1 && entry.realPage <= plannedTotal)
    .map((entry) => ({ title: entry.title, realPage: entry.realPage, level: entry.level }))
  const index = buildBookIndex({
    pageCount: plannedTotal,
    pageOffset: 0,
    printedToc: toc,
    contents: [],
  })

  let db: DatabaseSync
  try {
    db = deps?.openDb ? deps.openDb(fingerprint) : openBookDb(userDataDir, fingerprint)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '罗盘库打开失败'
    log(`import failed: ${message}`)
    return err({ code: 'OCR_FAILED', message })
  }
  let bookId: number
  try {
    bookId = ensureImportBookRow(
      db,
      {
        fingerprint,
        title,
        sourcePath: payload.filePath,
        format: payload.format,
        pageCount: plannedTotal,
        pageOffset: 0,
        cleanVersion: ROSETTA_CLEAN_VERSION,
      },
      index,
    ).bookId
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '罗盘初始化失败'
    log(`import failed: ${message}`)
    return err({ code: 'OCR_FAILED', message })
  }

  const done = getCompletedPages(db, bookId)
  const isComplete = (): boolean => {
    for (let page = 1; page <= plannedTotal; page += 1) {
      if (!done.has(page)) return false
    }
    return true
  }
  if (isComplete()) {
    const chapters = index.toc.filter((entry) => entry.level <= 1).length
    const blocks = countBookBlocks(db, bookId)
    const ocrPages = countPagesWithBbox(db, bookId, Array.from(done))
    log(`import reuse: ${title} ${plannedTotal}页已入库，跳过`)
    track(plannedTotal, 'import')
    return ok({
      bookId,
      chapters,
      blocks,
      pages: plannedTotal,
      ocrPages,
      nativePages: plannedTotal - ocrPages,
      ocrSuggestedPages: listOcrSuggestedPages(db, bookId),
    })
  }
  if (done.size > 0) log(`续跑：跳过已入库 ${done.size} 页`)
  track(done.size, 'ocr')

  if (hooks?.shouldCancel?.() || cancelRequested) {
    log(`import cancelled at ${done.size}/${plannedTotal}`)
    return cancelledError(done.size, plannedTotal)
  }
  const routedPages = new Set<number>()
  const skippedPages: number[] = []
  let chunkNo = 0
  // P1.2 直提空书判定：本轮是否实际提取过、是否见过非空文字
  let ranExtraction = false
  let sawText = false
  const totalChunks = Math.ceil(plannedTotal / chunkSize)
  for (let start = 1; start <= plannedTotal; start += chunkSize) {
    const end = Math.min(plannedTotal, start + chunkSize - 1)
    const rangePages: number[] = []
    for (let page = start; page <= end; page += 1) rangePages.push(page)
    if (rangePages.every((page) => done.has(page))) {
      log(`skip chunk ${start}-${end}（已入库）`)
      skippedPages.push(...rangePages)
      track(end, 'ocr')
      continue
    }
    if (hooks?.shouldCancel?.() || cancelRequested) {
      log(`import cancelled at ${done.size}/${plannedTotal}`)
      return cancelledError(done.size, plannedTotal)
    }
    chunkNo += 1
    const chunkStart = Date.now()
    let chunk: {
      pages: { pageNumber: number; markdown?: string; spans?: InspectorSpanLike[] }[]
      pagesRoutedToOcr?: number[]
    }
    try {
      chunk = await mod.processPdfWithOcr(data, {
        // P1.2：直提档只做原生提取（Spike 已证：无需 modelDirectory，routed 为空）；
        // modelDirectory 缺省即不传，napi 侧为 None
        mode: preferNative ? mod.OcrMode.Off : mod.OcrMode.Auto,
        pageNumbers: rangePages,
        dpi,
        modelDirectory: modelDir,
        offline: true,
        minimumConfidence: 0.3,
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `第 ${start}-${end} 页识别失败`
      log(`import failed: ${message}`)
      return err({ code: 'OCR_FAILED', message })
    }
    const chunkPages = [...chunk.pages].sort((a, b) => a.pageNumber - b.pageNumber)
    ranExtraction = true
    if (!sawText) {
      for (const page of chunkPages) {
        if ((page.markdown ?? '').trim()) {
          sawText = true
          break
        }
      }
    }
    const chunkSpans = new Map<number, InspectorSpanLike[]>()
    for (const page of chunkPages) {
      chunkSpans.set(page.pageNumber, page.spans ?? [])
    }
    let chunkBlocks = 0
    try {
      chunkBlocks = importBookChunk(
        db,
        {
          bookId,
          index,
          pages: chunkPages.map((page) => ({ page: page.pageNumber, markdown: page.markdown ?? '' })),
          spansByPage: chunkSpans,
          // P1.1：本轮路由集合决定来源；extract_version 记当前清洗管线版本
          ocrPages: new Set(
            (Array.isArray(chunk.pagesRoutedToOcr) ? chunk.pagesRoutedToOcr : []).filter(
              (page): page is number => Number.isInteger(page),
            ),
          ),
          extractVersion: ROSETTA_CLEAN_VERSION,
        },
      ).blocks
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `第 ${start}-${end} 页入库失败`
      log(`import failed: ${message}`)
      return err({ code: 'OCR_FAILED', message })
    }
    const routed = Array.isArray(chunk.pagesRoutedToOcr) ? chunk.pagesRoutedToOcr : []
    for (const routedPage of routed) {
      if (Number.isInteger(routedPage)) routedPages.add(routedPage)
    }
    markPagesCompleted(db, bookId, rangePages)
    for (const page of rangePages) done.add(page)
    // U1：同一轮 spans → 页词缓存（SQLite 成功之后；失败只记日志，永不回滚/重跑 OCR）
    try {
      await persistOcrPageCaches({
        fingerprint,
        scale,
        data,
        spansByPage: chunkSpans,
        routed: routed.filter((page): page is number => Number.isInteger(page)),
        deps,
        log,
      })
    } catch (cause) {
      log(
        `页词缓存跳过：${start}-${end} ${cause instanceof Error ? cause.message : '未知错误'}（已入库不受影响）`,
      )
    }
    track(end, 'ocr')
    log(
      `chunk ${chunkNo}/${totalChunks} ${start}-${end} ${Date.now() - chunkStart}ms ` +
        `路由OCR ${routed.length}页 入库 ${chunkBlocks}块`,
    )
  }
  if (hooks?.shouldCancel?.() || cancelRequested) {
    log(`import cancelled at ${done.size}/${plannedTotal}`)
    return cancelledError(done.size, plannedTotal)
  }
  track(plannedTotal, 'import')
  // 跳过的块没经过本轮路由集合，用 bbox 回补它们的 OCR 计数
  const ocrPages = routedPages.size + countPagesWithBbox(db, bookId, skippedPages)
  const chapters = index.toc.filter((entry) => entry.level <= 1).length
  const blocks = countBookBlocks(db, bookId)
  // P1.2：直提档本轮实际提取过、且库内仍零块、且全轮无字 → 明确报错，
  // 禁止静默建成空索引；用户要 OCR 请走扫描书路径（或以后按页 OCR）。
  // 续跑复用（库已有块）与扫描档不受此门限影响。
  if (preferNative && ranExtraction && !sawText && blocks === 0) {
    log('import failed: 本书未提取到原生文字')
    return err({ code: 'OCR_FAILED', message: '本书未提取到原生文字，请确认是否为文字版 PDF' })
  }
  log(
    `import done: ${title} ${chapters}章 ${blocks}块 ` +
      `原生${plannedTotal - ocrPages}/扫描${ocrPages} 总耗时${((Date.now() - t0) / 1000).toFixed(0)}s`,
  )
  return ok({
    bookId,
    chapters,
    blocks,
    pages: plannedTotal,
    ocrPages,
    nativePages: plannedTotal - ocrPages,
    ocrSuggestedPages: listOcrSuggestedPages(db, bookId),
  })
}
