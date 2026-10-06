import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { EpubChapter, EpubLocationHint } from '@montree/reader-core'
import {
  EMPTY_READER_NAV,
  syncEpubNavigation,
  syncPdfNavigation,
  syncWebDocNavigation,
  type ReaderFormat,
} from '@montree/reader-core'
import type { AdjacentFlatNavState } from '@montree/reader-core'
import type { ReaderUnit } from '@montree/reader-core'

/** 用户点击导航后，短暂阻止视口同步覆盖 intent flatIndex */
export const NAV_INTENT_LOCK_MS = 800

interface NavIntent {
  flatIndex: number
  lockedUntil: number
}

export function isNavIntentLocked(intent: NavIntent | null, now = Date.now()): boolean {
  return intent !== null && now < intent.lockedUntil
}

function isSameNav(
  a: AdjacentFlatNavState<ReaderUnit>,
  b: AdjacentFlatNavState<ReaderUnit>,
): boolean {
  return (
    a.flatIndex === b.flatIndex &&
    a.currentIndex === b.currentIndex &&
    a.previousIndex === b.previousIndex &&
    a.nextIndex === b.nextIndex &&
    a.current?.label === b.current?.label &&
    a.previous?.label === b.previous?.label &&
    a.next?.label === b.next?.label &&
    a.current?.href === b.current?.href
  )
}

type ReaderNavUnit = ReaderUnit

interface ReaderNavigationStore {
  filePath: string | null
  format: ReaderFormat | null
  units: ReaderNavUnit[]
  nav: AdjacentFlatNavState<ReaderUnit>
  navIntent: NavIntent | null
  ready: boolean
  /** T1：PDF 当前页（1-based）；EPUB/web/未就绪为 null，仅 Agent 快照用 */
  pageNum: number | null
  beginSession: (filePath: string, format: ReaderFormat) => void
  setUnits: (units: ReaderNavUnit[]) => void
  setReady: (ready: boolean) => void
  syncEpub: (units: EpubChapter[], hint?: EpubLocationHint, flatIndex?: number) => void
  syncPdf: (units: ReaderUnit[], pageNum: number) => void
  syncWeb: (units: ReaderUnit[], pageUrl: string, flatIndex?: number) => void
  syncFlatIndex: (flatIndex: number) => void
  clearNavIntent: () => void
}

export const useReaderNavigationStore = create<ReaderNavigationStore>((set, get) => ({
  filePath: null,
  format: null,
  units: [],
  nav: EMPTY_READER_NAV,
  navIntent: null,
  ready: false,
  pageNum: null,

  beginSession: (filePath, format) => {
    set({
      filePath,
      format,
      units: [],
      nav: EMPTY_READER_NAV,
      navIntent: null,
      ready: false,
      pageNum: null,
    })
  },

  setUnits: (units) => {
    if (get().units === units) return
    set({ units })
  },

  setReady: (ready) => {
    if (get().ready === ready) return
    set({ ready })
  },

  syncEpub: (units, hint, flatIndex) => {
    const nav = syncEpubNavigation(units, hint, flatIndex)
    const prev = get()
    if (prev.format === 'epub' && prev.units === units && isSameNav(prev.nav, nav)) return
    set({ units, format: 'epub', nav })
  },

  syncPdf: (units, pageNum) => {
    const prev = get()
    if (isNavIntentLocked(prev.navIntent)) return
    const nav = syncPdfNavigation(units, pageNum)
    // T1：同一章内翻页时 nav 不变，但页码变了也要写；三者全同才跳过
    if (prev.format === 'pdf' && prev.units === units && isSameNav(prev.nav, nav) && prev.pageNum === pageNum) return
    set({ units, format: 'pdf', nav, pageNum })
  },

  syncWeb: (units, pageUrl, flatIndex) => {
    const nav = syncWebDocNavigation(units, pageUrl, flatIndex)
    const prev = get()
    if (prev.format === 'web' && prev.units === units && isSameNav(prev.nav, nav)) return
    const nextIntent =
      typeof flatIndex === 'number' && flatIndex >= 0
        ? { flatIndex, lockedUntil: Date.now() + NAV_INTENT_LOCK_MS }
        : prev.navIntent
    set({ units, format: 'web', nav, navIntent: nextIntent })
  },

  syncFlatIndex: (flatIndex) => {
    const { format, units, nav: prevNav } = get()
    if (flatIndex < 0 || flatIndex >= units.length) return

    const nav =
      format === 'pdf'
        ? syncPdfNavigation(units as ReaderUnit[], undefined, flatIndex)
        : format === 'web'
          ? syncWebDocNavigation(units as ReaderUnit[], get().filePath ?? '', flatIndex)
          : syncEpubNavigation(units as EpubChapter[], undefined, flatIndex)

    if (isSameNav(prevNav, nav)) {
      set({
        navIntent: { flatIndex, lockedUntil: Date.now() + NAV_INTENT_LOCK_MS },
      })
      return
    }
    set({
      nav,
      navIntent: { flatIndex, lockedUntil: Date.now() + NAV_INTENT_LOCK_MS },
    })
  },

  clearNavIntent: () => {
    if (get().navIntent === null) return
    set({ navIntent: null })
  },
}))

export function selectReaderNavTitles(state: {
  nav: AdjacentFlatNavState<ReaderUnit>
  format: ReaderFormat | null
  units: ReaderNavUnit[]
}) {
  const { nav, units } = state
  const viewportUnit = nav.flatIndex >= 0 ? units[nav.flatIndex] : undefined
  const currentUnitId =
    viewportUnit && 'href' in viewportUnit
      ? viewportUnit.href
      : nav.current?.href

  // 只返回原始值：勿带 nav 对象，否则浅比较失效
  return {
    currentTitle: nav.current?.label ?? '—',
    previousTitle: nav.previous?.label ?? '—',
    nextTitle: nav.next?.label ?? '—',
    previousDisabled: !nav.previous,
    nextDisabled: !nav.next,
    currentUnitId,
  }
}

/** 须用 useShallow：选择器每次返回新对象，否则会 Maximum update depth exceeded */
export function useReaderNavTitles() {
  return useReaderNavigationStore(useShallow(selectReaderNavTitles))
}
