import type { WebDocTocEntry } from '@montree/contracts'
import type { ReaderUnit } from './reader-navigation'
import { resolveAdjacentFlatNav, type AdjacentFlatNavState } from './reader-chapter-nav'

const EMPTY_WEB_NAV: AdjacentFlatNavState<ReaderUnit> = {
  current: null,
  previous: null,
  next: null,
  currentIndex: -1,
  previousIndex: -1,
  nextIndex: -1,
  flatIndex: -1,
}

export function normalizeWebDocNavUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export function webDocTocEntriesToReaderUnits(entries: WebDocTocEntry[]): ReaderUnit[] {
  return entries.map((entry) => ({
    label: entry.label,
    href: entry.href,
    level: entry.level,
  }))
}

export function findWebDocFlatIndex(units: ReaderUnit[], pageUrl: string): number {
  const target = normalizeWebDocNavUrl(pageUrl)
  let bestIndex = -1
  let bestLevel = -1
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!
    if (normalizeWebDocNavUrl(unit.href) !== target) continue
    // 分组标题常与首个子页共用 href：优先更深的叶子，避免底栏显示成父分组
    if (unit.level >= bestLevel) {
      bestIndex = index
      bestLevel = unit.level
    }
  }
  return bestIndex
}

export function syncWebNavigation(
  units: ReaderUnit[],
  pageUrl: string,
  flatIndex?: number,
): AdjacentFlatNavState<ReaderUnit> {
  const index = typeof flatIndex === 'number' ? flatIndex : findWebDocFlatIndex(units, pageUrl)
  if (index < 0) return EMPTY_WEB_NAV
  return resolveAdjacentFlatNav(units, index)
}
