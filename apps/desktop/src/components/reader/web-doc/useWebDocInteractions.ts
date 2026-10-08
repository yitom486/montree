import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReadingMark, ReadingMarkCategory } from '@montree/contracts'
import { isOk } from '@montree/contracts'
import { subscribeTtsHighlight } from '@/lib/reader/marks/mark-linkage'
import { toast } from 'sonner'
import { useReadingMarkInspector } from '@/hooks/reader/useReadingMarkInspector'
import { useReaderSelectionActions } from '@/hooks/reader/useReaderSelectionActions'
import { parseNoteToCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { findMarkForSelection } from '@montree/reader-core'
import {
  clearWindowSelection,
  toCanonicalChapter,
  tocFromWebUnits,
  type PdfSelectionSnapshot,
  DEFAULT_HIGHLIGHT_COLOR,
  type ReaderUnit,
} from '@montree/reader-core'
import {
  applyMobiPendingSelectionHighlight,
  removeMobiPendingSelectionHighlight,
} from '@/lib/reader/marks/mobi-reading-marks'
import { clearReaderSelection } from '@/lib/agent/context/reader-selection-registry'
import { findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'
import { waitForDom } from '@/lib/reader/wait-for-dom'
import { buildMobiSnapshotFromRange } from '@montree/reader-core'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useTtsStore } from '@/stores/tts-store'
import type { CreateMarkAtParams } from '@/lib/agent/context/reader-marks-registry'
import type { AppTheme } from '@/stores/editor-ui-store'

export interface UseWebDocInteractionsOptions {
  documentId: string
  pageUrl: string
  normalizedPageUrl: string
  fileFingerprint: string
  theme: AppTheme
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  marks: ReadingMark[]
  marksRef: React.RefObject<ReadingMark[]>
  units: ReaderUnit[]
  unitsRef: React.RefObject<ReaderUnit[]>
  createMark: (payload: any) => Promise<any>
  updateMark: (payload: any) => Promise<any>
  deleteMark: (id: string) => Promise<any>
  syncWebMarkOverlays: (doc: Document, url: string) => void
  navigateToUrl: (url: string, flatIndex?: number) => void
}

export function useWebDocInteractions({
  documentId,
  pageUrl,
  normalizedPageUrl,
  fileFingerprint,
  theme,
  iframeRef,
  marks,
  marksRef,
  units,
  unitsRef,
  createMark,
  updateMark,
  deleteMark,
  syncWebMarkOverlays,
  navigateToUrl,
}: UseWebDocInteractionsOptions) {
  const themeRef = useRef(theme)
  themeRef.current = theme

  const [selectionSnapshot, setSelectionSnapshot] = useState<PdfSelectionSnapshot | null>(null)
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(null)
  const selectionSnapshotRef = useRef(selectionSnapshot)
  selectionSnapshotRef.current = selectionSnapshot

  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [editingNoteMark, setEditingNoteMark] = useState<ReadingMark | null>(null)
  const [hoveredMark, setHoveredMark] = useState<ReadingMark | null>(null)
  const [markTooltipPos, setMarkTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const hoveredMarkIdRef = useRef<string | null>(null)
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null)

  const inspector = useReadingMarkInspector(marks)
  const inspectorRef = useRef(inspector)
  inspectorRef.current = inspector

  const clearTextSelection = useCallback(() => {
    clearWindowSelection(iframeRef.current?.contentWindow ?? undefined)
    setSelectionSnapshot(null)
    setSelectionToolbarPos(null)
    clearReaderSelection()
    const body = iframeRef.current?.contentDocument?.body
    if (body) removeMobiPendingSelectionHighlight(body)
  }, [iframeRef])

  const dimTextSelection = useCallback(() => {
    setSelectionToolbarPos(null)
    clearWindowSelection(iframeRef.current?.contentWindow ?? undefined)
  }, [iframeRef])

  const showPendingSelectionHighlight = useCallback(() => {
    const body = iframeRef.current?.contentDocument?.body
    const rects = selectionSnapshotRef.current?.rects
    if (!body || !rects?.length) return
    applyMobiPendingSelectionHighlight(body, rects, themeRef.current)
  }, [iframeRef])

  const addPageBookmark = useCallback(async (): Promise<ReadingMark> => {
    const nav = useReaderNavigationStore.getState().nav
    const result = await createMark({
      filePath: documentId,
      fileFingerprint,
      kind: 'bookmark',
      anchor: { format: 'web', url: normalizedPageUrl },
      label: nav.current?.label ?? '书签',
      chapter: toCanonicalChapter(
        { format: 'web', url: normalizedPageUrl },
        tocFromWebUnits(units),
      ) ?? undefined,
    })
    if (!isOk(result)) {
      throw new Error(result.error.message || '创建书签失败')
    }
    toast.success('已添加书签')
    return result.value as ReadingMark
  }, [createMark, documentId, fileFingerprint, normalizedPageUrl, units])

  const handleSaveAnnotation = useCallback(
    async (
      note: string,
      color = DEFAULT_HIGHLIGHT_COLOR,
      overrideCategory?: ReadingMarkCategory,
      overrideTitle?: string,
    ): Promise<ReadingMark> => {
      const snapshot = selectionSnapshotRef.current
      if (!snapshot) {
        throw new Error('当前没有可用选区，请先划选文本')
      }

      const existing = findMarkForSelection(marks, {
        format: 'web',
        text: snapshot.text,
        pageUrl: normalizedPageUrl,
      })
      const meta = parseNoteToCardMeta(note)
      if (existing) {
        const trimmed = meta.note?.trim()
        const result = await updateMark({
          id: existing.id,
          color,
          chapter: toCanonicalChapter(
            { format: 'web', url: normalizedPageUrl },
            tocFromWebUnits(units),
          ) ?? undefined,
          ...(trimmed
            ? {
                note: trimmed,
                kind: existing.kind === 'highlight' ? ('highlight' as const) : ('note' as const),
              }
            : {}),
          ...((overrideCategory ?? meta.category) ? { category: overrideCategory ?? meta.category } : {}),
          ...((overrideTitle ?? meta.title) ? { title: overrideTitle ?? meta.title } : {}),
          ...(meta.aiSummary ? { aiSummary: meta.aiSummary } : {}),
          ...(meta.keyPoints ? { keyPoints: meta.keyPoints } : {}),
          ...(meta.diagramId ? { diagramId: meta.diagramId } : {}),
        })
        if (!isOk(result)) {
          throw new Error(result.error.message || '更新标记失败')
        }
        toast.success(trimmed ? '已保存批注' : '已更新高亮')
        const doc = iframeRef.current?.contentDocument
        if (doc?.body) syncWebMarkOverlays(doc, pageUrl)
        clearTextSelection()
        return result.value as ReadingMark
      }

      const result = await createMark({
        filePath: documentId,
        fileFingerprint,
        kind: note ? 'note' : 'highlight',
        anchor: {
          format: 'web',
          url: normalizedPageUrl,
          selectedText: snapshot.text,
          rects: snapshot.rects,
        },
        chapter: toCanonicalChapter(
          { format: 'web', url: normalizedPageUrl },
          tocFromWebUnits(units),
        ) ?? undefined,
        excerpt: snapshot.text,
        note: meta.note,
        category: overrideCategory ?? meta.category,
        title: overrideTitle ?? meta.title,
        aiSummary: meta.aiSummary,
        keyPoints: meta.keyPoints,
        diagramId: meta.diagramId,
        color,
      })

      if (!isOk(result)) {
        throw new Error(result.error.message || '创建批注失败')
      }

      marksRef.current = [...marksRef.current, result.value as ReadingMark]
      toast.success(note ? '已保存批注' : '已添加高亮')
      const doc = iframeRef.current?.contentDocument
      if (doc?.body) syncWebMarkOverlays(doc, pageUrl)
      clearTextSelection()
      return result.value as ReadingMark
    },
    [clearTextSelection, createMark, documentId, fileFingerprint, iframeRef, marks, marksRef, normalizedPageUrl, pageUrl, syncWebMarkOverlays, units, updateMark],
  )

  const selectionActions = useReaderSelectionActions({
    snapshotText: selectionSnapshot?.text,
    dimTextSelection,
    clearTextSelection,
    openAnnotateDialog: () => {
      setEditingNoteMark(null)
      setNoteDialogOpen(true)
      setSelectionToolbarPos(null)
    },
    showPendingHighlight: showPendingSelectionHighlight,
    saveHighlight: handleSaveAnnotation,
    sessionKey: fileFingerprint ?? documentId,
  })

  const handleCreateMarkAt = useCallback(
    async ({ excerpt, note, flatIndex, category, title }: CreateMarkAtParams): Promise<ReadingMark> => {
      const navState = useReaderNavigationStore.getState().nav
      if (typeof flatIndex === 'number' && flatIndex >= 0 && flatIndex !== navState.flatIndex) {
        const unit = unitsRef.current[flatIndex]
        if (!unit) throw new Error('章节索引无效')
        await new Promise<void>((resolve) => {
          const iframe = iframeRef.current
          if (!iframe) {
            resolve()
            return
          }
          const onLoad = () => {
            iframe.removeEventListener('load', onLoad)
            resolve()
          }
          iframe.addEventListener('load', onLoad)
          navigateToUrl(unit.href, flatIndex)
          window.setTimeout(() => {
            iframe.removeEventListener('load', onLoad)
            resolve()
          }, 4000)
        })
      }

      const snapshot = await waitForDom(() => {
        const doc = iframeRef.current?.contentDocument
        const body = doc?.body
        if (!doc || !body) return null
        const range = findTextRangeInRoot(body, excerpt)
        if (!range) return null
        return buildMobiSnapshotFromRange(doc, range, excerpt)
      })
      if (!snapshot) {
        throw new Error('未在当前页找到该摘录，请打开对应章节后重试')
      }

      selectionSnapshotRef.current = snapshot
      setSelectionSnapshot(snapshot)
      return handleSaveAnnotation(note, DEFAULT_HIGHLIGHT_COLOR, category, title)
    },
    [handleSaveAnnotation, iframeRef, navigateToUrl, unitsRef],
  )

  const handleDeleteMark = useCallback(
    async (mark: ReadingMark) => {
      await deleteMark(mark.id)
      toast.success('已删除')
    },
    [deleteMark],
  )

  const lastTtsRangeRef = useRef<Range | null>(null)
  const isUserInteractingRef = useRef(false)
  const userInteractionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const centerWebDocRange = useCallback((range: Range) => {
    try {
      const host =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement
      host?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {}
  }, [])

  useEffect(() => {
    const markUserInteraction = () => {
      isUserInteractingRef.current = true
      if (userInteractionTimerRef.current) {
        clearTimeout(userInteractionTimerRef.current)
      }
      userInteractionTimerRef.current = setTimeout(() => {
        let hasActiveSelection = false
        try {
          const iframeDoc = iframeRef.current?.contentDocument
          const sel = iframeDoc?.getSelection() ?? window.getSelection()
          if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
            hasActiveSelection = true
          }
        } catch {}

        if (hasActiveSelection) {
          markUserInteraction()
          return
        }

        isUserInteractingRef.current = false
        // 用户停止操作满 3 秒：若仍有正在朗读的高亮且处于播放状态，平滑居中跳回高亮处
        if (lastTtsRangeRef.current) {
          const { isSpeaking, isPaused } = useTtsStore.getState()
          if (isSpeaking && !isPaused) {
            centerWebDocRange(lastTtsRangeRef.current)
          }
        }
      }, 3000)
    }

    const onWheel = () => {
      markUserInteraction()
    }

    const onSelectionChange = (e: Event) => {
      try {
        const targetDoc = (e.target as Document) ?? (e.currentTarget as Document) ?? document
        const sel = targetDoc.getSelection() ?? window.getSelection()
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
          markUserInteraction()
        }
      } catch {}
    }

    window.addEventListener('wheel', onWheel, { passive: true, capture: true })
    document.addEventListener('selectionchange', onSelectionChange, { passive: true })

    const iframeDoc = iframeRef.current?.contentDocument
    if (iframeDoc) {
      iframeDoc.addEventListener('wheel', onWheel, { passive: true, capture: true })
      iframeDoc.addEventListener('selectionchange', onSelectionChange, { passive: true })
    }

    return () => {
      if (userInteractionTimerRef.current) {
        clearTimeout(userInteractionTimerRef.current)
        userInteractionTimerRef.current = null
      }
      window.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('selectionchange', onSelectionChange)
      if (iframeDoc) {
        iframeDoc.removeEventListener('wheel', onWheel, { capture: true })
        iframeDoc.removeEventListener('selectionchange', onSelectionChange)
      }
    }
  }, [centerWebDocRange, iframeRef])

  useEffect(() => {
    return subscribeTtsHighlight(
      (sentence, forceScroll) => {
        const doc = iframeRef.current?.contentDocument
        const body = doc?.body
        if (!doc || !body) return

        try {
          const viewWindow = doc.defaultView as any
          viewWindow?.CSS?.highlights?.delete('montree-tts-active')
        } catch {}

        const cleanCore = sentence
          .replace(/[，。！？；：“”‘’（）《》、\s,.!?;:'"()[\]]/g, '')
          .slice(0, 15)
        let range = findTextRangeInRoot(body, sentence)
        if (!range && cleanCore.length >= 4) {
          range = findTextRangeInRoot(body, cleanCore)
        }
        if (!range) {
          range = findTextRangeInRoot(body, sentence.slice(0, 20))
        }

        if (range) {
          lastTtsRangeRef.current = range
          try {
            const host =
              range.startContainer instanceof Element
                ? range.startContainer
                : range.startContainer.parentElement
            const rect = host?.getBoundingClientRect?.()
            const viewH = doc.defaultView?.innerHeight || 800
            const inViewport = rect && rect.top >= 48 && rect.bottom <= viewH - 48

            const viewWindow = doc.defaultView as any
            const registry = viewWindow?.CSS?.highlights
            const HighlightCtor = viewWindow?.Highlight
            if (registry && HighlightCtor) {
              if (!doc.querySelector('style[data-montree-tts-highlight]')) {
                const style = doc.createElement('style')
                style.setAttribute('data-montree-tts-highlight', '')
                style.textContent = `
                  ::highlight(montree-tts-active) {
                    background-color: rgba(245, 158, 11, 0.42) !important;
                    color: inherit !important;
                    border-radius: 4px;
                  }
                `
                ;(doc.head ?? doc.documentElement)?.appendChild(style)
              }
              registry.set('montree-tts-active', new HighlightCtor(range))
            }

            if (forceScroll) {
              isUserInteractingRef.current = false
              if (userInteractionTimerRef.current) {
                clearTimeout(userInteractionTimerRef.current)
                userInteractionTimerRef.current = null
              }
              centerWebDocRange(range)
            } else if (!isUserInteractingRef.current && !inViewport) {
              centerWebDocRange(range)
            }
          } catch {}
        }
      },
      () => {
        lastTtsRangeRef.current = null
        if (userInteractionTimerRef.current) {
          clearTimeout(userInteractionTimerRef.current)
          userInteractionTimerRef.current = null
        }
        isUserInteractingRef.current = false
        const doc = iframeRef.current?.contentDocument
        if (!doc) return
        try {
          const viewWindow = doc.defaultView as any
          viewWindow?.CSS?.highlights?.delete('montree-tts-active')
        } catch {}
      },
    )
  }, [centerWebDocRange, iframeRef])

  return {
    selectionSnapshot,
    selectionSnapshotRef,
    setSelectionSnapshot,
    selectionToolbarPos,
    setSelectionToolbarPos,
    noteDialogOpen,
    setNoteDialogOpen,
    editingNoteMark,
    setEditingNoteMark,
    hoveredMark,
    setHoveredMark,
    markTooltipPos,
    setMarkTooltipPos,
    hoveredMarkIdRef,
    pointerOriginRef,
    inspector,
    inspectorRef,
    clearTextSelection,
    dimTextSelection,
    showPendingSelectionHighlight,
    addPageBookmark,
    handleSaveAnnotation,
    handleCreateMarkAt,
    handleDeleteMark,
    selectionActions,
  }
}
