import { useCallback, useEffect, useRef } from 'react'
import type { FoliateViewElement } from '@foliate/view.js'
import type { ReadingMark } from '@montree/contracts'
import type { EpubChapter } from '@montree/reader-core'
import type { AppTheme } from '@/stores/editor-ui-store'
import {
  findMarkForSelection,
  MARK_CATEGORY_SWATCH_FALLBACK,
  resolveMarkCategorySwatch,
} from '@montree/reader-core'
import {
  buildChapterSectionMap,
  buildMarkFlag,
  isExcerptDrawAllowed,
  resolveMarkRangeDetailed,
  type CfiResolverView,
} from '@/lib/reader/marks/epub-mark-overlay'
import { resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'
import { locateExcerptInDocuments, overlayerKeyForMark } from '@/lib/reader/marks/mark-linkage'
import { subscribeTtsHighlight } from '@/lib/reader/marks/mark-linkage'
import { EPUB_MARK_FLAGS_PER_DOC_CAP } from './foliate-theme'

export interface UseFoliateHighlightsOptions {
  viewRef: React.RefObject<FoliateViewElement | null>
  marksRef: React.RefObject<ReadingMark[]>
  chaptersRef: React.RefObject<EpubChapter[]>
  chapterSectionsRef: React.RefObject<Array<number | null>>
  themeRef: React.RefObject<AppTheme>
  kindRef: React.RefObject<'epub' | 'mobi'>
  ready: boolean
  marks: ReadingMark[]
  theme: AppTheme
  readerFontSize: number
  readerLineHeight: number
  selectionSnapshotRef: React.RefObject<{ text: string; cfiRange: string; rect: DOMRect } | null>
  editingNoteMark: ReadingMark | null
}

export function useFoliateHighlights({
  viewRef,
  marksRef,
  chaptersRef,
  chapterSectionsRef,
  themeRef,
  kindRef,
  ready,
  marks,
  theme,
  readerFontSize,
  readerLineHeight,
  selectionSnapshotRef,
  editingNoteMark,
}: UseFoliateHighlightsOptions) {
  const markHighlightStyleSigRef = useRef<WeakMap<Document, string>>(new WeakMap())
  const pendingAnnotateKeyRef = useRef<string | null>(null)
  const hoverStyleInjectedRef = useRef<WeakSet<Document>>(new WeakSet())
  const jumpFlashTokenRef = useRef(0)

  // 1. M1 卡片常驻标记：CSS Custom Highlight 自绘层
  const syncMarkHighlights = useCallback(() => {
    const view = viewRef.current
    const cfiView = (view ?? null) as unknown as CfiResolverView | null
    const chapterSections = buildChapterSectionMap(
      chaptersRef.current,
      chapterSectionsRef.current,
    )
    let docs: Array<{ doc: Document; index: number }> = []
    try {
      const renderer = viewRef.current?.renderer as unknown as {
        getContents: () => Array<{ doc: Document; index: number }>
      } | null
      docs = renderer?.getContents() ?? []
    } catch {
      return
    }
    if (docs.length === 0) return
    const rootCS = document.defaultView?.getComputedStyle(document.documentElement)
    const getVar = (name: string) => rootCS?.getPropertyValue(name).trim() || undefined
    const palette: Record<string, string> = {}
    for (const cat of Object.keys(MARK_CATEGORY_SWATCH_FALLBACK)) {
      palette[cat] = resolveMarkCategorySwatch(cat, getVar, themeRef.current)
    }
    const sig = Object.values(palette).join('|')
    const buckets = new Map<string, Range[]>()
    for (const { doc, index } of docs) {
      try {
        const viewWindow = doc.defaultView as unknown as {
          CSS?: { highlights?: { set: (name: string, h: object) => void; delete: (n: string) => void } }
          Highlight?: new (...ranges: AbstractRange[]) => object
        } | null
        const registry = viewWindow?.CSS?.highlights
        const HighlightCtor = viewWindow?.Highlight
        if (!registry || !HighlightCtor) continue
        if (markHighlightStyleSigRef.current.get(doc) !== sig) {
          let style = doc.querySelector('style[data-montree-marks]') as HTMLStyleElement | null
          if (!style) {
            style = doc.createElement('style')
            style.setAttribute('data-montree-marks', '')
            ;(doc.head ?? doc.documentElement)?.appendChild(style)
          }
          style.textContent = Object.entries(palette)
            .map(
              ([cat, color]) =>
                `::highlight(montree-mark-${cat}){text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:${color};}`,
            )
            .join('\n')
          markHighlightStyleSigRef.current.set(doc, sig)
        }
        for (const cat of Object.keys(palette)) {
          registry.delete(`montree-mark-${cat}`)
          buckets.set(cat, [])
        }
        for (const mark of marksRef.current) {
          const resolved = resolveMarkRangeDetailed(doc, index, mark, cfiView)
          if (!resolved) continue
          if (
            resolved.via === 'excerpt' &&
            !isExcerptDrawAllowed(mark.chapter?.key, index, chapterSections)
          ) {
            continue
          }
          const range = resolved.range
          const cat = (mark.category ?? resolveCardMeta(mark).category) as string
          if (!palette[cat]) continue
          const bucket = buckets.get(cat)
          if (bucket && bucket.length < 40) bucket.push(range)
        }
        for (const [cat, ranges] of buckets) {
          if (ranges.length === 0) continue
          try {
            registry.set(`montree-mark-${cat}`, new HighlightCtor(...ranges))
          } catch {
            // 单个失败不影响其余分类
          }
        }
      } catch {
        // 单文档失败不影响其余文档
      }
    }
  }, [chapterSectionsRef, chaptersRef, marksRef, themeRef, viewRef])

  // 2. M2 页边旗标：每渲染文档内 absolute 圆点
  const syncMarkFlags = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const cfiView = view as unknown as CfiResolverView
    let contents: Array<{ doc: Document; index: number }> = []
    try {
      const renderer = view.renderer as unknown as {
        getContents: () => Array<{ doc: Document; index: number }>
      } | null
      contents = renderer?.getContents() ?? []
    } catch {
      return
    }
    if (contents.length === 0) return
    const rootCS = document.defaultView?.getComputedStyle(document.documentElement)
    const getVar = (name: string) => rootCS?.getPropertyValue(name).trim() || undefined
    const flagChapterSections = buildChapterSectionMap(
      chaptersRef.current,
      chapterSectionsRef.current,
    )
    for (const { doc, index } of contents) {
      try {
        doc.querySelectorAll('[data-montree-flag]').forEach((el) => el.remove())
        const host = doc.documentElement
        if (!host) continue
        let placed = 0
        for (const mark of marksRef.current) {
          if (placed >= EPUB_MARK_FLAGS_PER_DOC_CAP) break
          if (mark.kind === 'bookmark') continue
          const resolved = resolveMarkRangeDetailed(doc, index, mark, cfiView)
          if (!resolved) continue
          if (
            resolved.via === 'excerpt' &&
            !isExcerptDrawAllowed(mark.chapter?.key, index, flagChapterSections)
          ) {
            continue
          }
          const range = resolved.range
          const cat = (mark.category ?? resolveCardMeta(mark).category) as string
          const flag = buildMarkFlag(doc, mark.id, range, {
            background: resolveMarkCategorySwatch(cat, getVar, themeRef.current),
          })
          if (!flag) continue
          host.appendChild(flag)
          placed += 1
        }
      } catch {
        // 单文档失败不影响其余文档
      }
    }
  }, [chapterSectionsRef, chaptersRef, marksRef, themeRef, viewRef])

  // 3. Foliate overlayer 批注同步
  const syncVisualMarks = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    for (const mark of marksRef.current) {
      const key = overlayerKeyForMark(mark)
      if (!key) continue
      void view.addAnnotation({ value: key }).catch(() => undefined)
    }
  }, [marksRef, viewRef])

  // 4. 临时选区高亮展示与清除
  const removePendingAnnotateHighlight = useCallback(() => {
    const key = pendingAnnotateKeyRef.current
    pendingAnnotateKeyRef.current = null
    if (!key) return
    void viewRef.current?.deleteAnnotation({ value: key }).catch(() => undefined)
  }, [viewRef])

  const showPendingAnnotateHighlight = useCallback(() => {
    const snapshot = selectionSnapshotRef.current
    const view = viewRef.current
    if (!snapshot?.cfiRange || !view || editingNoteMark) return
    const existing = findMarkForSelection(marksRef.current, {
      format: kindRef.current,
      text: snapshot.text,
      cfiRange: snapshot.cfiRange,
    })
    if (existing) return
    pendingAnnotateKeyRef.current = snapshot.cfiRange
    void view.addAnnotation({ value: snapshot.cfiRange }).catch(() => undefined)
  }, [editingNoteMark, kindRef, marksRef, selectionSnapshotRef, viewRef])

  // 5. 卡片悬停→正文高亮
  const handleHoverExcerpt = useCallback((excerpt: string | undefined) => {
    let docs: Array<{ doc: Document }> = []
    try {
      const renderer = viewRef.current?.renderer as unknown as {
        getContents: () => Array<{ doc: Document }>
      } | null
      docs = renderer?.getContents() ?? []
    } catch {
      return
    }
    for (const { doc } of docs) {
      try {
        const viewWindow = doc.defaultView as unknown as {
          CSS?: { highlights?: { set: (name: string, highlight: object) => void; delete: (name: string) => void } }
          Highlight?: new (...ranges: AbstractRange[]) => object
        } | null
        const registry = viewWindow?.CSS?.highlights
        const HighlightCtor = viewWindow?.Highlight
        if (!registry || !HighlightCtor) continue
        if (!hoverStyleInjectedRef.current.has(doc)) {
          let style = doc.querySelector('style[data-montree-hover]') as HTMLStyleElement | null
          if (!style) {
            style = doc.createElement('style')
            style.setAttribute('data-montree-hover', '')
            style.textContent =
              '::highlight(montree-hover){background:rgba(139,92,246,.25);border-radius:2px;}'
            ;(doc.head ?? doc.documentElement)?.appendChild(style)
          }
          hoverStyleInjectedRef.current.add(doc)
        }
        if (!excerpt || !excerpt.trim()) {
          registry.delete('montree-hover')
          continue
        }
        const body = doc.body
        if (!body) continue
        const range = findTextRangeInRoot(body, excerpt.trim())
        registry.delete('montree-hover')
        if (range) {
          registry.set('montree-hover', new HighlightCtor(range))
        }
      } catch {
        // 忽略
      }
    }
  }, [viewRef])

  // 6. 跳转落定的方框闪现
  const flashJumpRange = useCallback((cfiKey: string) => {
    const token = ++jumpFlashTokenRef.current
    window.setTimeout(() => {
      if (jumpFlashTokenRef.current !== token) return
      let resolved: { index: number; anchor: (doc: Document) => Range } | null = null
      try {
        resolved = viewRef.current?.resolveCFI(cfiKey) ?? null
      } catch {
        resolved = null
      }
      if (!resolved) return
      let renderer: { getContents: () => Array<{ doc: Document; index: number }> } | null = null
      try {
        renderer = viewRef.current?.renderer as unknown as {
          getContents: () => Array<{ doc: Document; index: number }>
        } | null
      } catch {
        return
      }
      const target = renderer?.getContents().find((item) => item.index === resolved.index)
      if (!target) return
      let range: Range | null = null
      try {
        range = resolved.anchor(target.doc)
      } catch {
        return
      }
      if (!range) return
      try {
        const viewWindow = target.doc.defaultView as unknown as {
          CSS?: { highlights?: { set: (name: string, h: object) => void; delete: (n: string) => void } }
          Highlight?: new (...ranges: AbstractRange[]) => object
        } | null
        const registry = viewWindow?.CSS?.highlights
        const HighlightCtor = viewWindow?.Highlight
        if (!registry || !HighlightCtor) return
        if (!target.doc.querySelector('style[data-montree-hover]')) {
          const style = target.doc.createElement('style')
          style.setAttribute('data-montree-hover', '')
          style.textContent =
            '::highlight(montree-hover){background:rgba(139,92,246,.32);border-radius:2px;}'
          ;(target.doc.head ?? target.doc.documentElement)?.appendChild(style)
        }
        registry.set('montree-hover', new HighlightCtor(range))
        window.setTimeout(() => {
          if (jumpFlashTokenRef.current !== token) return
          try {
            registry.delete('montree-hover')
          } catch {}
        }, 2500)
      } catch {}
    }, 180)
  }, [viewRef])

  // 7. 标记状态变更响应
  useEffect(() => {
    if (!ready) return
    syncVisualMarks()
    syncMarkHighlights()
    syncMarkFlags()
  }, [marks, ready, readerFontSize, readerLineHeight, syncVisualMarks, syncMarkHighlights, syncMarkFlags, theme])

  // 8. TTS 语音朗读逐句微光临时标记跟随
  useEffect(() => {
    const clearTtsHighlight = () => {
      let docs: Array<{ doc: Document }> = []
      try {
        const renderer = viewRef.current?.renderer as unknown as {
          getContents: () => Array<{ doc: Document }>
        } | null
        docs = renderer?.getContents() ?? []
      } catch {
        docs = []
      }
      for (const { doc } of docs) {
        try {
          const viewWindow = doc.defaultView as unknown as {
            CSS?: { highlights?: { delete: (name: string) => void } }
          } | null
          viewWindow?.CSS?.highlights?.delete('montree-tts-active')
        } catch {}
      }
    }

    return subscribeTtsHighlight(
      (sentence) => {
        let docs: Array<{ doc: Document }> = []
        try {
          const renderer = viewRef.current?.renderer as unknown as {
            getContents: () => Array<{ doc: Document }>
          } | null
          docs = renderer?.getContents() ?? []
        } catch {
          docs = []
        }
        if (!docs.length) return

        clearTtsHighlight()

        const cleanCore = sentence
          .replace(/[，。！？；：“”‘’（）《》、\s,.!?;:'"()[\]]/g, '')
          .slice(0, 15)
        let hit = locateExcerptInDocuments(docs, sentence)
        if (!hit && cleanCore.length >= 4) {
          hit = locateExcerptInDocuments(docs, cleanCore)
        }
        if (!hit) {
          hit = locateExcerptInDocuments(docs, sentence.slice(0, 20))
        }

        if (hit) {
          try {
            const host =
              hit.range.startContainer instanceof Element
                ? hit.range.startContainer
                : hit.range.startContainer.parentElement
            host?.scrollIntoView({ behavior: 'smooth', block: 'center' })

            const viewWindow = hit.doc.defaultView as unknown as {
              CSS?: { highlights?: { set: (name: string, h: object) => void; delete: (name: string) => void } }
              Highlight?: new (...ranges: AbstractRange[]) => object
            } | null
            const registry = viewWindow?.CSS?.highlights
            const HighlightCtor = viewWindow?.Highlight
            if (registry && HighlightCtor) {
              if (!hit.doc.querySelector('style[data-montree-tts-highlight]')) {
                const style = hit.doc.createElement('style')
                style.setAttribute('data-montree-tts-highlight', '')
                style.textContent = `
                  ::highlight(montree-tts-active) {
                    background-color: rgba(245, 158, 11, 0.35) !important;
                    color: inherit !important;
                    border-radius: 4px;
                  }
                `
                ;(hit.doc.head ?? hit.doc.documentElement)?.appendChild(style)
              }
              registry.set('montree-tts-active', new HighlightCtor(hit.range))
            }
          } catch {}
        }
      },
      () => {
        clearTtsHighlight()
      },
    )
  }, [viewRef])

  return {
    syncMarkHighlights,
    syncMarkFlags,
    syncVisualMarks,
    removePendingAnnotateHighlight,
    showPendingAnnotateHighlight,
    handleHoverExcerpt,
    flashJumpRange,
  }
}
