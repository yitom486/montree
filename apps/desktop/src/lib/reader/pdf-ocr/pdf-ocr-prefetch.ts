import type { ReaderUnit } from '@montree/reader-core'

export interface PdfOcrPrefetchRange {
  start: number
  end: number
}

const DEFAULT_PREFETCH_BUFFER = 3
const MAX_CHAPTER_PREFETCH_PAGES = 25

function resolveVisiblePageRange(
  currentPage: number,
  numPages: number,
  buffer = DEFAULT_PREFETCH_BUFFER,
): PdfOcrPrefetchRange {
  const safeCurrent = Math.min(Math.max(currentPage, 1), Math.max(numPages, 1))
  return {
    start: Math.max(1, safeCurrent - buffer),
    end: Math.min(numPages, safeCurrent + buffer),
  }
}

function unitPage(unit: ReaderUnit): number | null {
  const page = Number.parseInt(unit.href, 10)
  return Number.isFinite(page) && page >= 1 ? page : null
}

/** 根据目录定位当前章起止页；无有效目录时退回视口邻近页。 */
export function resolvePdfOcrChapterRange(
  currentPage: number,
  numPages: number,
  units: ReaderUnit[],
  hasChapterToc: boolean,
): PdfOcrPrefetchRange {
  if (!hasChapterToc) {
    return resolveVisiblePageRange(currentPage, numPages, DEFAULT_PREFETCH_BUFFER)
  }

  const entries = units
    .map((unit) => ({ page: unitPage(unit), level: unit.level ?? 0 }))
    .filter((entry): entry is { page: number; level: number } => entry.page !== null)
    .sort((a, b) => a.page - b.page || a.level - b.level)

  if (entries.length === 0) {
    return resolveVisiblePageRange(currentPage, numPages, DEFAULT_PREFETCH_BUFFER)
  }

  let chapterStartIdx = -1
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i]!.page <= currentPage) chapterStartIdx = i
    else break
  }

  if (chapterStartIdx < 0) {
    return resolveVisiblePageRange(currentPage, numPages, DEFAULT_PREFETCH_BUFFER)
  }

  const chapterStart = entries[chapterStartIdx]!.page
  const chapterLevel = entries[chapterStartIdx]!.level
  let chapterEnd = numPages
  for (let i = chapterStartIdx + 1; i < entries.length; i += 1) {
    if (entries[i]!.level <= chapterLevel) {
      chapterEnd = entries[i]!.page - 1
      break
    }
  }

  const start = Math.max(1, chapterStart)
  const end = Math.min(numPages, Math.max(chapterEnd, currentPage))
  const span = end - start + 1
  if (span > MAX_CHAPTER_PREFETCH_PAGES) {
    const half = Math.floor(MAX_CHAPTER_PREFETCH_PAGES / 2)
    return {
      start: Math.max(1, currentPage - half),
      end: Math.min(numPages, currentPage + half),
    }
  }

  return { start, end }
}

/** 当前页优先，再向两侧扩展。 */
export function orderPagesForPrefetch(currentPage: number, pages: Iterable<number>): number[] {
  const unique = [...new Set(pages)].sort((a, b) => a - b)
  const ordered: number[] = []
  if (unique.includes(currentPage)) ordered.push(currentPage)
  for (let delta = 1; delta <= unique.length; delta += 1) {
    const after = currentPage + delta
    const before = currentPage - delta
    if (unique.includes(after)) ordered.push(after)
    if (unique.includes(before)) ordered.push(before)
  }
  return ordered
}

export function resolvePdfOcrPrefetchPages(
  currentPage: number,
  numPages: number,
  units: ReaderUnit[],
  hasChapterToc: boolean,
  options?: { buffer?: number; cachedPages?: ReadonlySet<number> },
): number[] {
  const buffer = options?.buffer ?? DEFAULT_PREFETCH_BUFFER
  const cached = options?.cachedPages ?? new Set<number>()
  const { start, end } = resolvePdfOcrChapterRange(currentPage, numPages, units, hasChapterToc)
  const rangeStart = Math.max(1, Math.min(start, currentPage - buffer))
  const rangeEnd = Math.min(numPages, Math.max(end, currentPage + buffer))

  const candidates: number[] = []
  for (let page = rangeStart; page <= rangeEnd; page += 1) {
    if (!cached.has(page)) candidates.push(page)
  }

  return orderPagesForPrefetch(currentPage, candidates)
}
