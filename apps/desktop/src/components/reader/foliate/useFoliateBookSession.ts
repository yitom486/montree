import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FoliateViewElement } from '@foliate/view.js'
import type { OverlayerDrawFn } from '@foliate/overlayer.js'
import {
  openFoliateBook,
  type FoliateBookAdapter,
} from '@/lib/reader/adapter/foliate-book-adapter'
import { findMarkByOverlayerKey } from '@/lib/reader/marks/mark-linkage'
import {
  isSameSpineBase,
  normalizeLoadKey,
  pickInitialChapter,
  scrollFoliateSectionToFragment,
  splitChapterFragment,
  type EpubChapter,
} from '@montree/reader-core'
import {
  locateExcerptInDocuments,
  runRevealPlan,
  subscribeAnchorHighlight,
  subscribeRevealMark,
  type RevealAdapter,
} from '@/lib/reader/marks/mark-linkage'
import { searchReaderContent } from '@/lib/agent/context/search-reader-content'
import { registerReaderContent } from '@/lib/agent/context/reader-content-registry'
import { registerReaderMarks } from '@/lib/agent/context/reader-marks-registry'
import { commitReaderSelection } from '@/lib/agent/context/reader-selection-registry'
import { focusAgentComposerOnReaderSelection } from '@/lib/agent/context/focus-agent-composer'
import { findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'
import { extractDocumentText, extractViewportText } from '@/lib/agent/context/extract-dom-text'
import { emitRailFollow } from '@/lib/reader/rail-follow'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { reportAppError } from '@/lib/workspace/report-error'
import { isNavIntentLocked, useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useReadingProgressStore } from '@/stores/reading-progress-store'
import { appApi } from '@/api/app-api'
import { parse as parseFoliateCfi, toRange as foliateCfiToRange } from '@foliate/epubcfi.js'
import type { AppTheme } from '@/stores/editor-ui-store'
import type { ReadingMark, AppError } from '@montree/contracts'
import type { CreateMarkAtParams } from '@/lib/agent/context/reader-marks-registry'
import {
  applyDocTheme,
  READING_PROGRESS_SAVE_MS,
  type FoliateTypography,
} from './foliate-theme'

const DEFAULT_HIGHLIGHT_COLOR = 'rgba(234, 179, 8, 0.45)'

declare global {
  interface Window {
    __montreeE2eReader?: {
      selectText: (excerpt: string) => Promise<boolean>
      clickMark: (markId: string) => Promise<boolean>
      listMarks: () => Array<{ id: string; kind: string; excerpt?: string }>
    }
  }
}

export interface FoliateReaderEvents {
  openInspectorAtRange?: (mark: ReadingMark, range: Range) => boolean
  bindSectionDocInteractions?: (doc: Document, index: number) => () => void
  syncVisualMarks?: () => void
  syncMarkHighlights?: () => void
  syncMarkFlags?: () => void
  flashJumpRange?: (cfiKey: string) => void
  handleCreateMarkAt?: (params: CreateMarkAtParams) => Promise<any>
  createBookmark?: () => Promise<ReadingMark>
  createNoteFromSelection?: (note: string) => Promise<ReadingMark>
  onE2eSelectRange?: (doc: Document, range: Range, cfiRange: string) => void
}

export interface UseFoliateBookSessionOptions {
  filePath: string
  documentKind: 'epub' | 'mobi'
  data: { data: Uint8Array } | null | undefined
  error: unknown
  containerRef: React.RefObject<HTMLDivElement | null>
  theme: AppTheme
  readerFontSize: number
  readerLineHeight: number
  marksRef: React.RefObject<ReadingMark[]>
  openInspectorAtRange?: (mark: ReadingMark, range: Range) => boolean
  bindSectionDocInteractions?: (doc: Document, index: number) => () => void
  syncVisualMarks?: () => void
  syncMarkHighlights?: () => void
  syncMarkFlags?: () => void
  flashJumpRange?: (cfiKey: string) => void
  handleCreateMarkAt?: (params: CreateMarkAtParams) => Promise<any>
  createBookmark?: () => Promise<ReadingMark>
  createNoteFromSelection?: (note: string) => Promise<ReadingMark>
  viewRef?: React.RefObject<FoliateViewElement | null>
  adapterRef?: React.RefObject<FoliateBookAdapter | null>
  chaptersRef?: React.RefObject<EpubChapter[]>
  chapterSectionsRef?: React.RefObject<Array<number | null>>
  lastLocationRef?: React.RefObject<{ cfi?: string; sectionIndex: number; fraction: number } | null>
  eventsRef?: React.RefObject<FoliateReaderEvents>
}

export function useFoliateBookSession({
  filePath,
  documentKind,
  data,
  error,
  containerRef,
  theme,
  readerFontSize,
  readerLineHeight,
  marksRef,
  openInspectorAtRange,
  bindSectionDocInteractions,
  syncVisualMarks,
  syncMarkHighlights,
  syncMarkFlags,
  flashJumpRange,
  handleCreateMarkAt,
  createBookmark,
  createNoteFromSelection,
  viewRef: externalViewRef,
  adapterRef: externalAdapterRef,
  chaptersRef: externalChaptersRef,
  chapterSectionsRef: externalChapterSectionsRef,
  lastLocationRef: externalLastLocationRef,
  eventsRef,
}: UseFoliateBookSessionOptions) {
  const internalViewRef = useRef<FoliateViewElement | null>(null)
  const viewRef = externalViewRef ?? internalViewRef
  const internalAdapterRef = useRef<FoliateBookAdapter | null>(null)
  const adapterRef = externalAdapterRef ?? internalAdapterRef
  const internalChaptersRef = useRef<EpubChapter[]>([])
  const chaptersRef = externalChaptersRef ?? internalChaptersRef
  const internalChapterSectionsRef = useRef<Array<number | null>>([])
  const chapterSectionsRef = externalChapterSectionsRef ?? internalChapterSectionsRef
  const [chapters, setChapters] = useState<EpubChapter[]>([])
  const [ready, setReady] = useState(false)
  const [globalProgress, setGlobalProgress] = useState(0)

  const internalLastLocationRef = useRef<{ cfi?: string; sectionIndex: number; fraction: number } | null>(null)
  const lastLocationRef = externalLastLocationRef ?? internalLastLocationRef
  const lastVisibleRangeRef = useRef<Range | null>(null)
  const lastMarkSectionRef = useRef<number>(-1)
  const saveProgressTimerRef = useRef<number | null>(null)

  const callbacksRef = useRef<FoliateReaderEvents>({})
  callbacksRef.current = {
    openInspectorAtRange: (mark, range) =>
      eventsRef?.current?.openInspectorAtRange?.(mark, range) ??
      openInspectorAtRange?.(mark, range) ??
      false,
    bindSectionDocInteractions: (doc, index) =>
      eventsRef?.current?.bindSectionDocInteractions?.(doc, index) ??
      bindSectionDocInteractions?.(doc, index) ??
      (() => () => {}),
    syncVisualMarks: () => {
      eventsRef?.current?.syncVisualMarks?.()
      syncVisualMarks?.()
    },
    syncMarkHighlights: () => {
      eventsRef?.current?.syncMarkHighlights?.()
      syncMarkHighlights?.()
    },
    syncMarkFlags: () => {
      eventsRef?.current?.syncMarkFlags?.()
      syncMarkFlags?.()
    },
    flashJumpRange: (cfi) => {
      eventsRef?.current?.flashJumpRange?.(cfi)
      flashJumpRange?.(cfi)
    },
    handleCreateMarkAt: (params) =>
      eventsRef?.current?.handleCreateMarkAt?.(params) ??
      handleCreateMarkAt?.(params) ??
      Promise.reject(new Error('not implemented')),
    createBookmark: () =>
      eventsRef?.current?.createBookmark?.() ??
      createBookmark?.() ??
      Promise.reject(new Error('not implemented')),
    createNoteFromSelection: (note) =>
      eventsRef?.current?.createNoteFromSelection?.(note) ??
      createNoteFromSelection?.(note) ??
      Promise.reject(new Error('not implemented')),
    onE2eSelectRange: (doc, range, cfiRange) => {
      eventsRef?.current?.onE2eSelectRange?.(doc, range, cfiRange)
    },
  }

  const typography = useMemo<FoliateTypography>(
    () => ({
      fontSize: readerFontSize as FoliateTypography['fontSize'],
      lineHeight: readerLineHeight as FoliateTypography['lineHeight'],
    }),
    [readerFontSize, readerLineHeight],
  )
  const typographyRef = useRef(typography)
  typographyRef.current = typography
  const themeRef = useRef(theme)
  themeRef.current = theme
  const kindRef = useRef(documentKind)
  kindRef.current = documentKind
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath

  const getRenderedDocs = useCallback((): Array<{ doc: Document; index: number }> => {
    try {
      const renderer = viewRef.current?.renderer as unknown as {
        getContents: () => Array<{ doc: Document; index: number }>
      } | null
      return renderer?.getContents() ?? []
    } catch {
      return []
    }
  }, [])

  // 1. 注册统一导航会话
  useEffect(() => {
    useReaderNavigationStore.getState().beginSession(filePath, 'epub')
    return () => {
      useReaderNavigationStore.getState().beginSession('', 'epub')
    }
  }, [filePath])

  const resolveGlobalProgress = useCallback((fraction: number): number => {
    return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  }, [])

  const persistReadingProgress = useCallback(
    (sectionIndex: number, fraction: number, cfi?: string) => {
      const percentage = resolveGlobalProgress(fraction)
      setGlobalProgress(percentage)
      const sectionId = adapterRef.current?.sections[sectionIndex]?.id
      if (kindRef.current === 'epub') {
        if (!cfi) return
        useReadingProgressStore.getState().saveEpubProgress(filePathRef.current, {
          cfi,
          href: sectionId,
          percentage,
        })
        return
      }
      if (sectionId) {
        useReadingProgressStore.getState().saveMobiProgress(filePathRef.current, {
          chapterId: sectionId,
        })
      }
    },
    [resolveGlobalProgress],
  )

  const schedulePersistReadingProgress = useCallback(
    (sectionIndex: number, fraction: number, cfi?: string) => {
      if (saveProgressTimerRef.current !== null) {
        window.clearTimeout(saveProgressTimerRef.current)
      }
      saveProgressTimerRef.current = window.setTimeout(() => {
        saveProgressTimerRef.current = null
        persistReadingProgress(sectionIndex, fraction, cfi)
      }, READING_PROGRESS_SAVE_MS)
    },
    [persistReadingProgress],
  )

  const syncChapterNav = useCallback((sectionIndex: number, cfi?: string) => {
    const units = chaptersRef.current
    if (units.length === 0) return
    if (isNavIntentLocked(useReaderNavigationStore.getState().navIntent)) return
    const href = adapterRef.current?.sections[sectionIndex]?.id
    if (
      typeof window !== 'undefined' &&
      appApi.isE2EFoliateReader() &&
      containerRef.current
    ) {
      const host = containerRef.current
      void adapterRef.current
        ?.loadSectionText(sectionIndex)
        .then((text) => {
          host.dataset.e2eSectionText = text.slice(0, 500)
        })
        .catch(() => undefined)
    }
    const flatIndex = units.findIndex((unit, idx) => {
      if (href && isSameSpineBase(unit.href, href, normalizeLoadKey)) return true
      return chapterSectionsRef.current[idx] === sectionIndex
    })
    if (flatIndex >= 0) {
      const ambiguous =
        units.filter((unit) => href && isSameSpineBase(unit.href, href, normalizeLoadKey)).length > 1
      if (!ambiguous || useReaderNavigationStore.getState().nav.flatIndex < 0) {
        useReaderNavigationStore.getState().syncFlatIndex(flatIndex)
        return
      }
    } else {
      useReaderNavigationStore.getState().syncEpub(units, { href, cfi })
    }
  }, [containerRef])

  const goToChapter = useCallback((chapter: EpubChapter | null, flatIndex?: number) => {
    const view = viewRef.current
    if (!chapter || !view) return
    let sectionIndex: number | null = null
    if (typeof flatIndex === 'number' && flatIndex >= 0) {
      sectionIndex = chapterSectionsRef.current[flatIndex] ?? null
    }
    if (sectionIndex === null || sectionIndex < 0) {
      sectionIndex = adapterRef.current?.resolveHref(chapter.href) ?? null
    }
    if ((sectionIndex === null || sectionIndex < 0) && !chapter.href) return
    const targetSection = sectionIndex ?? 0
    const resolvedFlat =
      typeof flatIndex === 'number' && flatIndex >= 0
        ? flatIndex
        : chaptersRef.current.findIndex((item) => item.href === chapter.href)
    if (resolvedFlat >= 0) {
      useReaderNavigationStore.getState().syncFlatIndex(resolvedFlat)
    }
    const { fragment } = splitChapterFragment(chapter.href)
    const isSpecialHref =
      chapter.href.includes('filepos:') ||
      chapter.href.startsWith('kindle:') ||
      kindRef.current === 'epub'
    const needsFullHref =
      !chapter.href.startsWith('section:') &&
      (fragment !== null || isSpecialHref || sectionIndex === null)

    void (async () => {
      if (needsFullHref) {
        try {
          await view.goTo(chapter.href)
        } catch {
          if (sectionIndex !== null && sectionIndex >= 0) {
            try {
              await view.goTo(targetSection)
            } catch {}
          }
        }
      } else {
        try {
          await view.goTo(targetSection)
        } catch {
          return
        }
      }
      if (!fragment) return
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      const target = viewRef.current?.renderer
        ?.getContents()
        .find((item) => item.index === targetSection)
      if (!target) return
      scrollFoliateSectionToFragment(target.doc, fragment)
    })().catch(() => undefined)
  }, [])

  const handleJumpToLabel = useCallback(
    (label: string) => {
      const index = chaptersRef.current.findIndex((chapter) => chapter.label === label)
      if (index < 0) return
      const chapter = chaptersRef.current[index]
      if (chapter) goToChapter(chapter, index)
    },
    [goToChapter],
  )

  const railFollowStateRef = useRef({ scheduled: false, last: -1 })
  const bindRailFollow = useCallback((doc: Document, index: number) => {
    const onScroll = () => {
      const st = railFollowStateRef.current
      if (st.scheduled) return
      st.scheduled = true
      requestAnimationFrame(() => {
        st.scheduled = false
        try {
          const el = doc.documentElement
          const max = el.scrollHeight - el.clientHeight
          const local = max > 0 ? el.scrollTop / max : 0
          let start = 0
          let end = 1
          try {
            const fractions = viewRef.current?.getSectionFractions?.() ?? []
            if (fractions.length > index) {
              start = fractions[index] ?? 0
              end = fractions[index + 1] ?? 1
            }
          } catch {}
          const f = start + Math.min(1, Math.max(0, local)) * (end - start)
          if (Math.abs(f - st.last) < 0.002) return
          st.last = f
          emitRailFollow(f)
        } catch {}
      })
    }
    doc.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      doc.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [])

  const revealExcerptInFoliateDocs = useCallback((text: string): boolean => {
    let docs: Array<{ doc: Document }> = []
    try {
      const renderer = viewRef.current?.renderer as unknown as {
        getContents: () => Array<{ doc: Document }>
      } | null
      docs = renderer?.getContents() ?? []
    } catch {
      docs = []
    }
    const hit = locateExcerptInDocuments(docs, text)
    if (!hit) return false
    try {
      const host =
        hit.range.startContainer instanceof Element
          ? hit.range.startContainer
          : hit.range.startContainer.parentElement
      host?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const selection = hit.doc?.defaultView?.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(hit.range.cloneRange())
    } catch {
      return false
    }
    return true
  }, [])

  const handleSelectMark = useCallback(
    (mark: ReadingMark) => {
      const adapter: RevealAdapter = {
        tryStep: async (step): Promise<boolean> => {
          const view = viewRef.current
          if (!view) return false
          switch (step.type) {
            case 'cfi': {
              try {
                await view.goTo(step.cfi)
              } catch {
                return false
              }
              callbacksRef.current.flashJumpRange?.(step.cfi)
              return true
            }
            case 'mobi-chapter': {
              const index =
                adapterRef.current?.sections.findIndex((s) => s.id === step.chapterId) ?? -1
              if (index < 0) return false
              try {
                await view.goTo(index)
              } catch {
                return false
              }
              return true
            }
            case 'excerpt':
              return revealExcerptInFoliateDocs(step.text)
            default:
              return false
          }
        },
      }
      void runRevealPlan(mark, adapter).then((result) => {
        if (!result.ok) {
          reportRuntimeError(new Error(`reveal miss (${result.miss.reason})`), {
            source: 'mark-linkage',
            op: 'reveal',
            silentToast: true,
            filePath,
            data: { markId: mark.id, reason: result.miss.reason },
          })
        }
      })
    },
    [filePath, revealExcerptInFoliateDocs],
  )

  useEffect(() => {
    return subscribeRevealMark((id) => {
      const mark = marksRef.current.find((item) => item.id === id)
      if (mark) handleSelectMark(mark)
    })
  }, [handleSelectMark, marksRef])

  useEffect(() => {
    return subscribeAnchorHighlight(async (excerpt) => {
      const ok = revealExcerptInFoliateDocs(excerpt)
      if (ok) return
      try {
        const query = excerpt.slice(0, 40).trim()
        if (!query) return
        const res = await searchReaderContent(query)
        const hit = res.hits[0]
        if (hit?.label) {
          handleJumpToLabel(hit.label)
          setTimeout(() => {
            revealExcerptInFoliateDocs(excerpt)
          }, 350)
        }
      } catch {}
    })
  }, [handleJumpToLabel, revealExcerptInFoliateDocs])

  useEffect(() => {
    if (error && typeof error === 'object' && error !== null && 'code' in error) {
      reportAppError(error as AppError)
    }
  }, [error])

  // 2. 主加载与生命周期初始化
  useEffect(() => {
    const container = containerRef.current
    if (!data || !container) return

    container.innerHTML = ''
    setReady(false)
    setChapters([])
    setGlobalProgress(0)
    lastLocationRef.current = null
    lastVisibleRangeRef.current = null
    chaptersRef.current = []
    chapterSectionsRef.current = []
    viewRef.current = null
    adapterRef.current = null

    let cancelled = false
    let view: FoliateViewElement | null = null
    const docCleanups = new Map<Document, () => void>()

    const onRelocate = (event: CustomEvent) => {
      const detail = event.detail as {
        section?: { current?: number }
        fraction?: number
        cfi?: string
        tocItem?: { label?: string; href?: string } | null
        range?: Range
      }
      if (cancelled) return
      if (detail.range) {
        lastVisibleRangeRef.current = detail.range
      }
      const sectionIndex = detail.section?.current ?? 0
      const fraction = detail.fraction ?? 0
      lastLocationRef.current = {
        cfi: detail.cfi,
        sectionIndex,
        fraction,
      }
      setGlobalProgress(resolveGlobalProgress(fraction))
      syncChapterNav(sectionIndex, detail.cfi)
      schedulePersistReadingProgress(sectionIndex, fraction, detail.cfi)
      if (lastMarkSectionRef.current !== sectionIndex) {
        lastMarkSectionRef.current = sectionIndex
        callbacksRef.current.syncMarkHighlights?.()
        callbacksRef.current.syncMarkFlags?.()
      }
      const tocHref = detail.tocItem?.href
      if (tocHref) {
        const flat = chaptersRef.current.findIndex(
          (unit) => unit.href.toLowerCase() === tocHref.toLowerCase(),
        )
        if (
          typeof window !== 'undefined' &&
          appApi.isE2EFoliateReader() &&
          containerRef.current
        ) {
          containerRef.current.dataset.e2eFlatIndex = String(flat)
        }
        if (flat >= 0 && !isNavIntentLocked(useReaderNavigationStore.getState().navIntent)) {
          useReaderNavigationStore.getState().syncFlatIndex(flat)
        }
      }
    }

    const onLoad = (event: CustomEvent) => {
      const detail = event.detail as { doc: Document; index: number }
      if (cancelled) return
      applyDocTheme(detail.doc, themeRef.current, typographyRef.current)
      docCleanups.get(detail.doc)?.()
      const unbindInteractions = callbacksRef.current.bindSectionDocInteractions?.(detail.doc, detail.index) ?? (() => {})
      const unbindRailFollow = bindRailFollow(detail.doc, detail.index)
      docCleanups.set(detail.doc, () => {
        unbindInteractions()
        unbindRailFollow()
      })
      callbacksRef.current.syncVisualMarks?.()
      lastMarkSectionRef.current = -1
      callbacksRef.current.syncMarkHighlights?.()
      callbacksRef.current.syncMarkFlags?.()
    }

    const onLink = (event: CustomEvent) => {
      const detail = event.detail as { href?: string }
      if (!detail.href) return
      event.preventDefault()
      const sectionIndex = adapterRef.current?.resolveHref(detail.href) ?? null
      if (!viewRef.current) return
      if (sectionIndex !== null && sectionIndex >= 0) {
        const flatIndex = chaptersRef.current.findIndex(
          (_, flat) => chapterSectionsRef.current[flat] === sectionIndex,
        )
        if (flatIndex >= 0) {
          useReaderNavigationStore.getState().syncFlatIndex(flatIndex)
        }
      }
      void viewRef.current.goTo(detail.href).catch(() => {
        if (sectionIndex !== null && sectionIndex >= 0 && viewRef.current) {
          void viewRef.current.goTo(sectionIndex).catch(() => undefined)
        }
      })
    }

    const onExternalLink = (event: CustomEvent) => {
      const detail = event.detail as { href?: string; href_?: string }
      event.preventDefault()
      const href = detail.href ?? detail.href_
      if (href) void appApi.openExternal(href)
    }

    const onShowAnnotation = (event: CustomEvent) => {
      const detail = event.detail as { value: string; index: number; range: Range }
      if (cancelled) return
      const mark = findMarkByOverlayerKey(marksRef.current, detail.value)
      if (!mark) return
      callbacksRef.current.openInspectorAtRange?.(mark, detail.range)
    }

    const onDrawAnnotation = (event: CustomEvent) => {
      const detail = event.detail as {
        draw: (drawFunc: unknown, drawOptions?: unknown) => void
        annotation: { value: string }
      }
      const mark = findMarkByOverlayerKey(marksRef.current, detail.annotation.value)
      const draw = async () => {
        const { Overlayer } = await import('@foliate/overlayer.js')
        detail.draw(Overlayer.highlight satisfies OverlayerDrawFn, {
          color: mark?.color ?? DEFAULT_HIGHLIGHT_COLOR,
        })
      }
      void draw().catch(() => undefined)
    }

    void (async () => {
      try {
        const bytes = new Uint8Array(
          data.data.buffer.slice(data.data.byteOffset, data.data.byteOffset + data.data.byteLength),
        )
        const adapter = await openFoliateBook(bytes, filePath)
        if (cancelled) return
        adapterRef.current = adapter

        const flatChapters: EpubChapter[] = []
        const sectionIndices: Array<number | null> = []
        const walk = (items: typeof adapter.toc, level: number) => {
          for (const item of items) {
            flatChapters.push({
              label: item.label.trim() || '未命名章节',
              href: item.href ?? `section:${item.sectionIndex ?? -1}`,
              level,
            })
            sectionIndices.push(item.sectionIndex)
            if (item.children.length > 0) walk(item.children, level + 1)
          }
        }
        walk(adapter.toc, 0)
        if (flatChapters.length === 0) {
          adapter.sections.forEach((section, index) => {
            flatChapters.push({ label: `第 ${index + 1} 节`, href: section.id, level: 0 })
            sectionIndices.push(index)
          })
        }
        chaptersRef.current = flatChapters
        chapterSectionsRef.current = sectionIndices
        setChapters(flatChapters)
        useReaderNavigationStore.getState().setUnits(flatChapters)

        await import('@foliate/view.js')
        if (cancelled) return
        const element = document.createElement('foliate-view') as unknown as FoliateViewElement
        element.style.width = '100%'
        element.style.height = '100%'
        element.style.display = 'block'
        container.appendChild(element)
        view = element
        viewRef.current = element

        element.addEventListener('relocate', onRelocate as EventListener)
        element.addEventListener('load', onLoad as EventListener)
        element.addEventListener('link', onLink as EventListener)
        element.addEventListener('external-link', onExternalLink as EventListener)
        element.addEventListener('show-annotation', onShowAnnotation as EventListener)
        element.addEventListener('draw-annotation', onDrawAnnotation as EventListener)

        await element.open(adapter.engineBook)
        if (cancelled) return
        try {
          element.renderer?.setAttribute('flow', 'scrolled')
          element.renderer?.setAttribute('max-inline-size', '1040px')
        } catch {}

        let restored = false
        if (kindRef.current === 'epub') {
          const saved = useReadingProgressStore.getState().getEpubProgress(filePath)
          if (saved?.percentage != null) setGlobalProgress(saved.percentage)
          if (saved?.cfi) {
            try {
              await element.goTo(saved.cfi)
              restored = true
            } catch {}
          }
        } else {
          const saved = useReadingProgressStore.getState().getMobiProgress(filePath)
          if (saved?.chapterId) {
            const index = adapter.sections.findIndex((s) => s.id === saved.chapterId)
            if (index >= 0) {
              try {
                await element.goTo(index)
                restored = true
              } catch {}
            }
          }
        }

        if (!restored && flatChapters.length > 0) {
          const first = pickInitialChapter(flatChapters)
          if (first) {
            const targetSection =
              adapter.resolveHref(first.href) ??
              sectionIndices[0] ??
              0
            try {
              await element.goTo(targetSection)
            } catch {
              try {
                await (element as any).init?.()
              } catch {}
            }
          }
        }

        if (cancelled) return
        setReady(true)
      } catch (err: unknown) {
        if (cancelled) return
        reportRuntimeError(err instanceof Error ? err : new Error(String(err)), {
          source: 'reader',
          op: 'openFoliateBook',
          filePath,
        })
      }
    })()

    return () => {
      cancelled = true
      if (saveProgressTimerRef.current !== null) {
        window.clearTimeout(saveProgressTimerRef.current)
        saveProgressTimerRef.current = null
      }
      docCleanups.forEach((cleanup) => cleanup())
      docCleanups.clear()
      try {
        ;(view as any)?.destroy?.()
      } catch {}
      if (view?.parentElement) {
        view.parentElement.removeChild(view)
      }
      viewRef.current = null
      adapterRef.current = null
    }
  }, [
    bindRailFollow,
    containerRef,
    data,
    filePath,
    persistReadingProgress,
    resolveGlobalProgress,
    schedulePersistReadingProgress,
    syncChapterNav,
  ])

  // 3. 主题与排版动态更新
  useEffect(() => {
    if (!ready) return
    getRenderedDocs().forEach(({ doc }) => {
      applyDocTheme(doc, theme, typography)
    })
  }, [getRenderedDocs, ready, theme, typography])

  // 4. 内容注册提供给 Agent 与听书
  useEffect(() => {
    return registerReaderContent({
      filePath,
      getCurrentText: () => {
        return getRenderedDocs()
          .map((item) => extractDocumentText(item.doc))
          .join('\n\n')
      },
      getViewportText: () => {
        const range = lastVisibleRangeRef.current
        if (range) {
          try {
            const rangeText = range.toString()?.trim()
            if (rangeText && rangeText.length > 5) {
              return rangeText
            }
          } catch {}
        }
        return getRenderedDocs()
          .map((item) => extractViewportText(item.doc))
          .filter(Boolean)
          .join('\n\n')
      },
      iterateUnits: async function* () {
        const adapter = adapterRef.current
        if (!adapter) return
        for (const section of adapter.sections) {
          const text = await adapter.loadSectionText(section.index)
          const chapter = chaptersRef.current.find(
            (_, flat) => chapterSectionsRef.current[flat] === section.index,
          )
          if (text) yield { label: chapter?.label ?? `第 ${section.index + 1} 节`, text }
        }
      },
      getUnitByIndex: async (flatIndex) => {
        const adapter = adapterRef.current
        const chapter = chaptersRef.current[flatIndex]
        if (!adapter || !chapter) return null
        const sectionIndex = chapterSectionsRef.current[flatIndex]
        if (sectionIndex === null || sectionIndex === undefined || sectionIndex < 0) return null
        const text = await adapter.loadSectionText(sectionIndex)
        return text ? { label: chapter.label, text } : null
      },
    })
  }, [filePath, getRenderedDocs])

  // 5. 标记创建注册
  useEffect(() => {
    return registerReaderMarks({
      filePath,
      createBookmark: () => callbacksRef.current.createBookmark?.() ?? Promise.reject(new Error('not ready')),
      createNoteFromSelection: (note) => callbacksRef.current.createNoteFromSelection?.(note) ?? Promise.reject(new Error('not ready')),
      createMarkAt: (params) => callbacksRef.current.handleCreateMarkAt?.(params) ?? Promise.reject(new Error('not ready')),
      navigateToFlatIndex: (index) => {
        const chapter = chaptersRef.current[index]
        if (chapter) goToChapter(chapter, index)
      },
    })
  }, [filePath, goToChapter])

  // 6. E2E 探针注入
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!appApi.isE2EFoliateReader()) return

    window.__montreeE2eReader = {
      selectText: async (excerpt: string): Promise<boolean> => {
        const timeoutAt = Date.now() + 6000
        while (Date.now() < timeoutAt) {
          for (const { doc, index } of getRenderedDocs()) {
            const body = doc.body
            if (!body) continue
            const range = findTextRangeInRoot(body, excerpt)
            if (!range) continue
            const sel = doc.defaultView?.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
            const text = range.toString()
            const cfiRange = viewRef.current?.getCFI(index, range) ?? ''
            if (!cfiRange) continue
            commitReaderSelection(filePath, text)
            focusAgentComposerOnReaderSelection()
            callbacksRef.current.onE2eSelectRange?.(doc, range, cfiRange)
            return true
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        return false
      },
      listMarks: () => {
        return marksRef.current.map((m) => ({
          id: m.id,
          kind: m.kind,
          excerpt: m.excerpt,
        }))
      },
      clickMark: async (markId: string): Promise<boolean> => {
        const mark = marksRef.current.find((m) => m.id === markId)
        if (!mark) return false
        const cfi = mark.anchor?.format === 'epub' ? mark.anchor.cfi : undefined
        if (!cfi) return false
        const view = viewRef.current
        if (!view) return false
        let parsed: { spinePos?: number } | null = null
        try {
          parsed = parseFoliateCfi(cfi) as any
        } catch {
          return false
        }
        const spineIndex = parsed?.spinePos
        if (spineIndex === undefined) return false
        const targetDoc = getRenderedDocs().find((d) => d.index === spineIndex)?.doc
        if (!targetDoc) return false
        let range: Range
        try {
          range = foliateCfiToRange(targetDoc, cfi)
        } catch {
          return false
        }
        return callbacksRef.current.openInspectorAtRange?.(mark, range) ?? false
      },
    }
    return () => {
      delete window.__montreeE2eReader
    }
  }, [filePath, getRenderedDocs, marksRef])

  // 7. 快捷键
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ready) return
      if (!(event.altKey || event.metaKey)) return
      const { nav: currentNav } = useReaderNavigationStore.getState()
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        const chapter = currentNav.previous
        if (chapter) goToChapter(chapter, currentNav.previousIndex)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        const chapter = currentNav.next
        if (chapter) goToChapter(chapter, currentNav.nextIndex)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToChapter, ready])

  return {
    viewRef,
    adapterRef,
    chaptersRef,
    chapterSectionsRef,
    chapters,
    ready,
    globalProgress,
    lastLocationRef,
    lastVisibleRangeRef,
    getRenderedDocs,
    goToChapter,
    handleJumpToLabel,
    handleSelectMark,
  }
}
