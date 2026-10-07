import { useCallback, useEffect, useRef, useState } from 'react'
import type { FoliateViewElement } from '@foliate/view.js'
import type { ReadingMark } from '@montree/contracts'
import type { FoliateBookAdapter } from '@/lib/reader/adapter/foliate-book-adapter'
import type { EpubChapter } from '@montree/reader-core'
import {
  clearReaderSelection,
  commitReaderSelection,
} from '@/lib/agent/context/reader-selection-registry'
import { focusAgentComposerOnReaderSelection } from '@/lib/agent/context/focus-agent-composer'
import {
  bindDocumentSelectionCollapse,
  bindOutsideReaderPointerDismiss,
  buildEpubSnapshotFromRange,
  findMarkForSelection,
  isClickNotDrag,
  readEpubSelection,
  toCanonicalChapter,
  tocFromEpubUnits,
} from '@montree/reader-core'
import {
  findMarkByOverlayerKey,
  overlayerKeyForMark,
} from '@/lib/reader/marks/mark-linkage'
import { parseNoteToCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'
import { waitForDom } from '@/lib/reader/wait-for-dom'
import { emitRailFocus } from '@/lib/reader/rail-follow'
import { useReadingMarkInspector } from '@/hooks/reader/useReadingMarkInspector'
import { useReaderSelectionActions } from '@/hooks/reader/useReaderSelectionActions'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import type { CreateMarkAtParams } from '@/lib/agent/context/reader-marks-registry'
import { isOk } from '@montree/contracts'
import { toast } from 'sonner'

const DEFAULT_HIGHLIGHT_COLOR = 'rgba(234, 179, 8, 0.45)'

export interface UseFoliateInteractionsOptions {
  filePath: string
  fileFingerprint: string
  kindRef: React.RefObject<'epub' | 'mobi'>
  viewRef: React.RefObject<FoliateViewElement | null>
  adapterRef: React.RefObject<FoliateBookAdapter | null>
  chaptersRef: React.RefObject<EpubChapter[]>
  lastLocationRef: React.RefObject<{ cfi?: string; sectionIndex: number; fraction: number } | null>
  marks: ReadingMark[]
  marksRef: React.RefObject<ReadingMark[]>
  createMark: (payload: any) => Promise<any>
  updateMark: (payload: any) => Promise<any>
  deleteMark: (id: string) => Promise<any>
  showPendingAnnotateHighlight: () => void
  removePendingAnnotateHighlight: () => void
  syncVisualMarks: () => void
  getRenderedDocs: () => Array<{ doc: Document; index: number }>
  goToChapter: (chapter: EpubChapter | null, flatIndex?: number) => void
  nav: { current: EpubChapter | null; flatIndex: number }
}

export function useFoliateInteractions({
  filePath,
  fileFingerprint,
  kindRef,
  viewRef,
  adapterRef,
  chaptersRef,
  lastLocationRef,
  marks,
  marksRef,
  createMark,
  updateMark,
  deleteMark,
  showPendingAnnotateHighlight,
  removePendingAnnotateHighlight,
  syncVisualMarks,
  getRenderedDocs,
  goToChapter,
  nav,
}: UseFoliateInteractionsOptions) {
  const [selectionSnapshot, setSelectionSnapshot] = useState<{
    text: string
    cfiRange: string
    rect: DOMRect
  } | null>(null)
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(null)
  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [editingNoteMark, setEditingNoteMark] = useState<ReadingMark | null>(null)
  const [hoveredMark, setHoveredMark] = useState<ReadingMark | null>(null)
  const [markTooltipPos, setMarkTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const hoveredMarkIdRef = useRef<string | null>(null)
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null)
  const selectionSnapshotRef = useRef<typeof selectionSnapshot>(null)
  selectionSnapshotRef.current = selectionSnapshot

  const inspector = useReadingMarkInspector(marks)
  const inspectorRef = useRef(inspector)
  inspectorRef.current = inspector

  const clearTextSelection = useCallback(() => {
    setSelectionSnapshot(null)
    setSelectionToolbarPos(null)
    clearReaderSelection()
    try {
      viewRef.current?.renderer?.getContents().forEach((item) => {
        item.doc.defaultView?.getSelection()?.removeAllRanges()
      })
    } catch {
      // 视图已销毁时忽略
    }
  }, [viewRef])

  const dimTextSelection = useCallback(() => {
    if (noteDialogOpen) return
    setSelectionToolbarPos(null)
    inspectorRef.current.close()
  }, [noteDialogOpen])

  const handleDeleteMark = useCallback(
    async (mark: ReadingMark) => {
      const key = overlayerKeyForMark(mark)
      if (key) {
        try {
          await viewRef.current?.deleteAnnotation({ value: key })
        } catch {
          // overlay 缺失不影响删除本体
        }
      }
      await deleteMark(mark.id)
      toast.success('已删除')
    },
    [deleteMark, viewRef],
  )

  const addBookmarkAtCurrent = useCallback(async (): Promise<ReadingMark> => {
    const current = lastLocationRef.current
    if (!current?.cfi || !fileFingerprint) {
      toast.error('无法获取当前阅读位置')
      throw new Error('无法获取当前阅读位置')
    }
    const sectionId = adapterRef.current?.sections[current.sectionIndex]?.id
    const bookmarkAnchor =
      kindRef.current === 'epub'
        ? { format: 'epub' as const, cfi: current.cfi, href: sectionId }
        : { format: 'mobi' as const, chapterId: sectionId ?? '', cfi: current.cfi }
    const result = await createMark({
      filePath,
      fileFingerprint,
      kind: 'bookmark',
      anchor: bookmarkAnchor,
      label: nav.current?.label ?? '书签',
      chapter: toCanonicalChapter(bookmarkAnchor, tocFromEpubUnits(chaptersRef.current)) ?? undefined,
    })
    if (!isOk(result)) {
      throw new Error(result.error.message || '创建书签失败')
    }
    toast.success('已添加书签')
    return result.value as ReadingMark
  }, [adapterRef, chaptersRef, createMark, fileFingerprint, filePath, kindRef, lastLocationRef, nav.current?.label])

  const handleSaveAnnotation = useCallback(
    async (
      note: string,
      color = DEFAULT_HIGHLIGHT_COLOR,
      overrideCategory?: import('@montree/contracts').ReadingMarkCategory,
      overrideTitle?: string,
    ): Promise<ReadingMark> => {
      const snapshot = selectionSnapshotRef.current
      if (!snapshot || !fileFingerprint) {
        throw new Error('当前没有可用选区，请先划选文本')
      }
      const sectionIndex = lastLocationRef.current?.sectionIndex
      const sectionId =
        typeof sectionIndex === 'number'
          ? (adapterRef.current?.sections[sectionIndex]?.id ?? '')
          : ''
      const anchor =
        kindRef.current === 'epub'
          ? {
              format: 'epub' as const,
              cfi: snapshot.cfiRange,
              cfiRange: snapshot.cfiRange,
              href: sectionId,
              selectedText: snapshot.text,
            }
          : {
              format: 'mobi' as const,
              chapterId: sectionId,
              cfi: snapshot.cfiRange,
              cfiRange: snapshot.cfiRange,
              selectedText: snapshot.text,
            }

      const existing = findMarkForSelection(marks, {
        format: kindRef.current,
        text: snapshot.text,
        cfiRange: snapshot.cfiRange,
      })
      const anchorChapter =
        toCanonicalChapter(anchor, tocFromEpubUnits(chaptersRef.current)) ?? undefined
      const meta = parseNoteToCardMeta(note)
      if (existing) {
        const trimmed = meta.note?.trim()
        const result = await updateMark({
          id: existing.id,
          color,
          chapter: anchorChapter,
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
        removePendingAnnotateHighlight()
        syncVisualMarks()
        toast.success(trimmed ? '已保存批注' : '已更新高亮')
        clearTextSelection()
        return result.value as ReadingMark
      }

      const result = await createMark({
        filePath,
        fileFingerprint,
        kind: note ? 'note' : 'highlight',
        anchor,
        excerpt: snapshot.text,
        note: meta.note,
        category: overrideCategory ?? meta.category,
        title: overrideTitle ?? meta.title,
        aiSummary: meta.aiSummary,
        keyPoints: meta.keyPoints,
        diagramId: meta.diagramId,
        color,
        chapter: anchorChapter,
      })
      if (!isOk(result)) {
        throw new Error(result.error.message || '创建批注失败')
      }
      removePendingAnnotateHighlight()
      syncVisualMarks()
      toast.success(note ? '已保存批注' : '已添加高亮')
      clearTextSelection()
      return result.value as ReadingMark
    },
    [
      adapterRef,
      chaptersRef,
      clearTextSelection,
      createMark,
      fileFingerprint,
      filePath,
      kindRef,
      lastLocationRef,
      marks,
      removePendingAnnotateHighlight,
      syncVisualMarks,
      updateMark,
    ],
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
    showPendingHighlight: showPendingAnnotateHighlight,
    saveHighlight: handleSaveAnnotation,
    sessionKey: fileFingerprint ?? filePath,
  })

  const markHoverHandlers = useCallback(
    () => ({
      onEnter: (mark: ReadingMark, anchor: { left: number; top: number; width: number }) => {
        setHoveredMark(mark)
        setMarkTooltipPos({
          x: anchor.left + anchor.width / 2,
          y: anchor.top,
        })
      },
      onLeave: () => {
        setHoveredMark(null)
        setMarkTooltipPos(null)
      },
    }),
    [],
  )

  const openInspectorAtRange = useCallback((mark: ReadingMark, range: Range) => {
    const doc = range.startContainer.ownerDocument
    if (!doc) return false
    const frame = doc.defaultView?.frameElement as HTMLElement | null
    const frameRect = frame?.getBoundingClientRect()
    const rect = range.getBoundingClientRect()
    inspectorRef.current.openAt(
      [mark],
      (frameRect?.left ?? 0) + rect.left + rect.width / 2,
      (frameRect?.top ?? 0) + rect.top,
    )
    return true
  }, [])

  const handleCreateMarkAt = useCallback(
    async ({ excerpt, note, flatIndex, category, title }: CreateMarkAtParams) => {
      const navState = useReaderNavigationStore.getState().nav
      if (typeof flatIndex === 'number' && flatIndex >= 0 && flatIndex !== navState.flatIndex) {
        const chapter = chaptersRef.current[flatIndex]
        if (!chapter) throw new Error('章节索引无效')
        goToChapter(chapter, flatIndex)
      }
      const snapshot = await waitForDom(() => {
        for (const { doc, index } of getRenderedDocs()) {
          const body = doc.body
          if (!body) continue
          const range = findTextRangeInRoot(body, excerpt)
          if (!range) continue
          const text = range.toString().trim()
          if (!text) continue
          let cfiRange = ''
          try {
            cfiRange = viewRef.current?.getCFI(index, range) ?? ''
          } catch {
            cfiRange = ''
          }
          if (!cfiRange) continue
          const built = buildEpubSnapshotFromRange(
            {
              window: doc.defaultView as Window,
              cfiFromRange: (target) => viewRef.current?.getCFI(index, target) ?? '',
            },
            range,
            text,
          )
          if (built) return built
        }
        return null
      })
      if (!snapshot) {
        throw new Error('未在当前章节找到该摘录，请打开对应章节后重试')
      }
      selectionSnapshotRef.current = snapshot
      setSelectionSnapshot(snapshot)
      return handleSaveAnnotation(note, DEFAULT_HIGHLIGHT_COLOR, category, title)
    },
    [chaptersRef, getRenderedDocs, goToChapter, handleSaveAnnotation, viewRef],
  )

  const bindSectionDocInteractions = useCallback(
    (doc: Document, index: number) => {
      const cleanupFns: Array<() => void> = []
      const onMouseDown = (event: MouseEvent) => {
        pointerOriginRef.current = { x: event.clientX, y: event.clientY }
      }
      const handleDocPointerUp = (isClick: boolean): void => {
        const frame = doc.defaultView?.frameElement as HTMLElement | null
        const frameRect = frame?.getBoundingClientRect()
        const view = viewRef.current
        if (!view) return
        const contents = {
          window: doc.defaultView as Window,
          cfiFromRange: (range: Range) => view.getCFI(index, range),
        }
        const snapshot = readEpubSelection(contents)
        if (!snapshot) {
          if (isClick) {
            inspectorRef.current.close()
          }
          return
        }
        inspectorRef.current.close()
        setSelectionSnapshot(snapshot)
        selectionSnapshotRef.current = snapshot
        commitReaderSelection(filePath, snapshot.text)
        focusAgentComposerOnReaderSelection()
        setSelectionToolbarPos({
          x: (frameRect?.left ?? 0) + snapshot.rect.left + snapshot.rect.width / 2,
          y: (frameRect?.top ?? 0) + snapshot.rect.top,
        })
      }
      const onMouseUp = (event: MouseEvent) => {
        const origin = pointerOriginRef.current
        const isClick = isClickNotDrag(origin, {
          clientX: event.clientX,
          clientY: event.clientY,
        } as MouseEvent)
        window.setTimeout(() => {
          handleDocPointerUp(isClick)
        }, 10)
      }
      doc.addEventListener('mousedown', onMouseDown)
      doc.addEventListener('mouseup', onMouseUp)

      const onMarkClick = (event: MouseEvent) => {
        const origin = pointerOriginRef.current
        if (
          !isClickNotDrag(origin, {
            clientX: event.clientX,
            clientY: event.clientY,
          } as MouseEvent)
        ) {
          return
        }
        const overlayer = viewRef.current?.renderer
          ?.getContents()
          .find((item) => item.doc === doc)?.overlayer
        if (!overlayer) return
        const [key] = overlayer.hitTest({ x: event.clientX, y: event.clientY })
        const mark =
          typeof key === 'string' ? findMarkByOverlayerKey(marksRef.current, key) : undefined
        if (!mark) return
        emitRailFocus(mark.id)
      }
      doc.addEventListener('click', onMarkClick)
      const unbindCollapse = bindDocumentSelectionCollapse(doc, doc.defaultView as Window, () => {
        setSelectionToolbarPos(null)
      })
      cleanupFns.push(() => {
        doc.removeEventListener('mousedown', onMouseDown)
        doc.removeEventListener('mouseup', onMouseUp)
        doc.removeEventListener('click', onMarkClick)
        unbindCollapse()
      })

      let hoverRaf = 0
      const onMouseMove = (event: MouseEvent) => {
        if (hoverRaf !== 0) return
        hoverRaf = window.requestAnimationFrame(() => {
          hoverRaf = 0
          const overlayer = viewRef.current?.renderer
            ?.getContents()
            .find((item) => item.doc === doc)?.overlayer
          if (!overlayer) return
          const [key] = overlayer.hitTest({ x: event.clientX, y: event.clientY })
          const mark =
            typeof key === 'string' ? findMarkByOverlayerKey(marksRef.current, key) : undefined
          if (!mark?.note?.trim()) {
            if (hoveredMarkIdRef.current !== null) {
              hoveredMarkIdRef.current = null
              markHoverHandlers().onLeave()
            }
            return
          }
          if (hoveredMarkIdRef.current === mark.id) return
          hoveredMarkIdRef.current = mark.id
          const frame = doc.defaultView?.frameElement as HTMLElement | null
          const frameRect = frame?.getBoundingClientRect()
          markHoverHandlers().onEnter(mark, {
            left: (frameRect?.left ?? 0) + event.clientX,
            top: (frameRect?.top ?? 0) + event.clientY,
            width: 0,
          })
        })
      }
      const onMouseLeave = () => {
        hoveredMarkIdRef.current = null
        markHoverHandlers().onLeave()
      }
      doc.addEventListener('mousemove', onMouseMove, { passive: true })
      doc.addEventListener('mouseleave', onMouseLeave)
      cleanupFns.push(() => {
        doc.removeEventListener('mousemove', onMouseMove)
        doc.removeEventListener('mouseleave', onMouseLeave)
        if (hoverRaf !== 0) {
          window.cancelAnimationFrame(hoverRaf)
          hoverRaf = 0
        }
      })
      return () => {
        cleanupFns.forEach((fn) => {
          try {
            fn()
          } catch {}
        })
      }
    },
    [filePath, markHoverHandlers, marksRef, viewRef],
  )

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
    markTooltipPos,
    inspector,
    clearTextSelection,
    dimTextSelection,
    handleDeleteMark,
    addBookmarkAtCurrent,
    handleSaveAnnotation,
    handleCreateMarkAt,
    selectionActions,
    bindSectionDocInteractions,
    openInspectorAtRange,
  }
}
