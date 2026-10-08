import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { ReadingMark } from '@montree/contracts'
import { isOk } from '@montree/contracts'
import {
  clearWindowSelection,
  DEFAULT_HIGHLIGHT_COLOR,
  findMarkForSelection,
  getSelectionToolbarPosition,
  isClickNotDrag,
  readPdfSelection,
  toCanonicalChapter,
  type PdfSelectionSnapshot,
  type ReaderUnit,
} from '@montree/reader-core'
import { findPdfMarksAtPoint, findPdfNoteMarkAtPoint } from '@/lib/reader/marks/pdf-reading-marks'
import { parseNoteToCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { useReaderSelectionActions } from '@/hooks/reader/useReaderSelectionActions'
import { useReadingMarkInspector } from '@/hooks/reader/useReadingMarkInspector'
import {
  revealExcerptOf,
  runRevealPlan,
  scrollElementTextIntoView,
  subscribeAnchorHighlight,
  subscribeRevealMark,
  subscribeTtsHighlight,
  type RevealAdapter,
} from '@/lib/reader/marks/mark-linkage'
import { registerReaderMarks, type CreateMarkAtParams } from '@/lib/agent/context/reader-marks-registry'
import {
  clearReaderSelection,
  commitReaderSelection,
  registerSelectionProvider,
} from '@/lib/agent/context/reader-selection-registry'
import { focusAgentComposerOnReaderSelection } from '@/lib/agent/context/focus-agent-composer'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useTtsStore } from '@/stores/tts-store'
import { findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'
import { buildPdfSnapshotFromRange } from '@montree/reader-core'
import { waitForDom } from '@/lib/reader/wait-for-dom'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { toast } from 'sonner'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface UsePdfInteractionsOptions {
  filePath: string
  fileFingerprint: string
  numPages: number
  pageNum: number
  pageNumRef: React.RefObject<number>
  pdfDocRef: React.RefObject<PDFDocumentProxy | null>
  pageAnchorRefs: React.RefObject<Map<number, HTMLDivElement>>
  marks: ReadingMark[]
  marksToc: ReturnType<typeof import('@montree/reader-core').tocFromPdfUnits>
  outlineUnits: ReaderUnit[]
  inspector: ReturnType<typeof useReadingMarkInspector>
  createMark: (payload: any) => Promise<any>
  updateMark: (payload: any) => Promise<any>
  deleteMark: (id: string) => Promise<any>
  jumpToPage: (page: number) => void
  goToFlatIndex: (index: number) => void
}

export function usePdfInteractions({
  filePath,
  fileFingerprint,
  numPages,
  pageNum,
  pageNumRef,
  pdfDocRef,
  pageAnchorRefs,
  marks,
  marksToc,
  inspector,
  createMark,
  updateMark,
  deleteMark,
  jumpToPage,
  goToFlatIndex,
}: UsePdfInteractionsOptions) {
  const [selectionSnapshot, setSelectionSnapshot] = useState<PdfSelectionSnapshot | null>(null)
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{ x: number; y: number } | null>(null)
  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [editingNoteMark, setEditingNoteMark] = useState<ReadingMark | null>(null)
  const [hoveredMark, setHoveredMark] = useState<ReadingMark | null>(null)
  const [markTooltipPos, setMarkTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null)
  const selectionTransactionRef = useRef<PdfSelectionSnapshot | null>(null)

  const clearTextSelection = useCallback(() => {
    selectionTransactionRef.current = null
    setSelectionSnapshot(null)
    setSelectionToolbarPos(null)
    clearReaderSelection()
    clearWindowSelection(window)
  }, [])

  const dimTextSelection = useCallback(() => {
    clearTextSelection()
    inspector.close()
  }, [clearTextSelection, inspector])

  const captureSelectionSnapshot = useCallback((snapshot: PdfSelectionSnapshot) => {
    selectionTransactionRef.current = snapshot
    setSelectionSnapshot(snapshot)
    commitReaderSelection(filePath, snapshot.text)
    setSelectionToolbarPos(getSelectionToolbarPosition(snapshot))
    clearWindowSelection(window)
    focusAgentComposerOnReaderSelection()
  }, [filePath])

  const handlePageMouseUp = useCallback((
    pageNumber: number,
    pageElement: HTMLElement,
    point: { clientX: number; clientY: number },
  ) => {
    const immediateSnapshot = readPdfSelection(pageElement, pageNumber)

    window.setTimeout(() => {
      if (isClickNotDrag(pointerOriginRef.current, point)) {
        const hits = findPdfMarksAtPoint(
          marks,
          pageNumber,
          point.clientX,
          point.clientY,
          pageElement,
        )
        if (hits.length > 0) {
          clearWindowSelection(window)
          selectionTransactionRef.current = null
          setSelectionToolbarPos(null)
          setSelectionSnapshot(null)
          inspector.openAt(hits, point.clientX, point.clientY)
          return
        }
      }

      const snapshot = immediateSnapshot ?? readPdfSelection(pageElement, pageNumber)
      if (!snapshot) {
        if (isClickNotDrag(pointerOriginRef.current, point)) {
          inspector.close()
          clearTextSelection()
        }
        return
      }

      inspector.close()
      captureSelectionSnapshot(snapshot)
    }, 10)
  }, [captureSelectionSnapshot, clearTextSelection, inspector, marks])

  const nav = useReaderNavigationStore((state) => state.nav)

  const addPageBookmark = useCallback(async () => {
    if (!fileFingerprint || numPages === 0) {
      throw new Error('无法获取当前页')
    }
    const result = await createMark({
      filePath,
      fileFingerprint,
      kind: 'bookmark',
      anchor: { format: 'pdf', page: pageNum },
      label: nav.current?.label ?? `第 ${pageNum} 页`,
      chapter: toCanonicalChapter({ format: 'pdf', page: pageNum }, marksToc) ?? undefined,
    })
    if (!isOk(result)) {
      throw new Error(result.error.message || '创建书签失败')
    }
    toast.success('已添加书签')
    return result.value as ReadingMark
  }, [createMark, fileFingerprint, filePath, marksToc, nav.current?.label, numPages, pageNum])

  const handleSaveAnnotation = useCallback(
    async (
      note: string,
      color = DEFAULT_HIGHLIGHT_COLOR,
      overrideCategory?: import('@montree/contracts').ReadingMarkCategory,
      overrideTitle?: string,
    ) => {
      const snapshot = selectionTransactionRef.current
      if (!snapshot) {
        throw new Error('当前没有可用选区，请先划选文本')
      }
      if (!fileFingerprint) {
        throw new Error('文件尚未加载完成，请稍后再试')
      }

      const existing = findMarkForSelection(marks, {
        format: 'pdf',
        text: snapshot.text,
        page: snapshot.page,
      })
      const meta = parseNoteToCardMeta(note)
      if (existing) {
        const trimmed = meta.note?.trim()
        const result = await updateMark({
          id: existing.id,
          color,
          chapter: toCanonicalChapter({ format: 'pdf', page: snapshot.page }, marksToc) ?? undefined,
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
        clearTextSelection()
        return result.value as ReadingMark
      }

      const result = await createMark({
        filePath,
        fileFingerprint,
        kind: note ? 'note' : 'highlight',
        anchor: {
          format: 'pdf',
          page: snapshot.page,
          selectedText: snapshot.text,
          version: snapshot.begin && snapshot.end && snapshot.quads?.length ? 2 : undefined,
          begin: snapshot.begin,
          end: snapshot.end,
          quote: snapshot.quote,
          quads: snapshot.quads,
          rects: snapshot.rects,
        },
        chapter: toCanonicalChapter(
          { format: 'pdf', page: snapshot.page },
          marksToc,
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

      toast.success(note ? '已保存批注' : '已添加高亮')
      clearTextSelection()
      return result.value as ReadingMark
    },
    [clearTextSelection, createMark, fileFingerprint, filePath, marks, marksToc, updateMark],
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
    hasSelection: () => selectionTransactionRef.current !== null || selectionSnapshot !== null,
    retainSelection: () => {
      if (selectionSnapshot) {
        selectionTransactionRef.current = selectionSnapshot
      }
    },
    saveHighlight: handleSaveAnnotation,
    onHighlightError: (cause) => {
      toast.error(cause instanceof Error ? cause.message : '添加高亮失败')
    },
    sessionKey: fileFingerprint ?? filePath,
  })

  const handleCreateMarkAt = useCallback(
    async ({ excerpt, note, flatIndex, category, title }: CreateMarkAtParams) => {
      if (typeof flatIndex === 'number' && flatIndex >= 0) {
        const navState = useReaderNavigationStore.getState().nav
        if (flatIndex !== navState.flatIndex) {
          goToFlatIndex(flatIndex)
        }
      }

      const totalPages = pdfDocRef.current?.numPages ?? numPages
      const startPage = pageNumRef.current
      const candidates: number[] = [startPage]
      for (const delta of [1, -1, 2, -2]) {
        const page = startPage + delta
        if (page >= 1 && page <= totalPages && !candidates.includes(page)) {
          candidates.push(page)
        }
      }

      let snapshot: PdfSelectionSnapshot | null = null
      for (const page of candidates) {
        if (page !== pageNumRef.current) {
          jumpToPage(page)
        }
        snapshot = await waitForDom(() => {
          const pageElement = pageAnchorRefs.current.get(pageNumRef.current)
          if (!pageElement || pageNumRef.current !== page) return null
          const range = findTextRangeInRoot(pageElement, excerpt)
          if (!range) return null
          return buildPdfSnapshotFromRange(pageElement, page, range, excerpt)
        }, { attempts: page === startPage ? 24 : 32, delayMs: 50 })
        if (snapshot) break
      }

      if (!snapshot) {
        throw new Error('本页未建立可定位文字层，请识别本页后重试')
      }

      captureSelectionSnapshot(snapshot)
      return handleSaveAnnotation(note, DEFAULT_HIGHLIGHT_COLOR, category, title) as Promise<ReadingMark>
    },
    [captureSelectionSnapshot, goToFlatIndex, handleSaveAnnotation, jumpToPage, numPages, pageAnchorRefs, pageNumRef, pdfDocRef],
  )

  useEffect(() => {
    return registerReaderMarks({
      filePath,
      createBookmark: () => addPageBookmark(),
      createNoteFromSelection: (note) => handleSaveAnnotation(note),
      createMarkAt: (params) => handleCreateMarkAt(params),
      navigateToFlatIndex: (index) => goToFlatIndex(index),
    })
  }, [addPageBookmark, filePath, goToFlatIndex, handleCreateMarkAt, handleSaveAnnotation])

  const handleSelectMark = useCallback(
    (mark: ReadingMark) => {
      const adapter: RevealAdapter = {
        tryStep: async (step): Promise<boolean> => {
          switch (step.type) {
            case 'pdf-page': {
              if (!Number.isFinite(step.page) || step.page < 1) return false
              if (step.page !== pageNumRef.current) jumpToPage(step.page)
              const text = revealExcerptOf(mark)
              if (text) {
                const range = await waitForDom(() => {
                  const el = pageAnchorRefs.current.get(step.page)
                  return el ? scrollElementTextIntoView(el, text) : null
                }, { attempts: 10, delayMs: 100 })
                if (range) {
                  try {
                    const selection = window.getSelection()
                    selection?.removeAllRanges()
                    selection?.addRange(range.cloneRange())
                  } catch {
                    // ignore
                  }
                }
              }
              return true
            }
            case 'excerpt': {
              const el = pageAnchorRefs.current.get(pageNumRef.current)
              if (!el) return false
              const range = scrollElementTextIntoView(el, step.text)
              if (!range) return false
              try {
                const selection = window.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range.cloneRange())
              } catch {
                return false
              }
              return true
            }
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
    [filePath, jumpToPage, pageAnchorRefs, pageNumRef],
  )

  useEffect(() => {
    return subscribeRevealMark((id) => {
      const mark = marks.find((item) => item.id === id)
      if (mark) handleSelectMark(mark)
    })
  }, [handleSelectMark, marks])

  useEffect(() => {
    return subscribeAnchorHighlight((excerpt) => {
      const currentEl = pageAnchorRefs.current.get(pageNumRef.current)
      if (currentEl) {
        const range = scrollElementTextIntoView(currentEl, excerpt)
        if (range) {
          try {
            const selection = window.getSelection()
            selection?.removeAllRanges()
            selection?.addRange(range.cloneRange())
          } catch {}
          return
        }
      }

      for (const [page, el] of pageAnchorRefs.current.entries()) {
        if (page === pageNumRef.current) continue
        const range = scrollElementTextIntoView(el, excerpt)
        if (range) {
          jumpToPage(page)
          try {
            const selection = window.getSelection()
            selection?.removeAllRanges()
            selection?.addRange(range.cloneRange())
          } catch {}
          return
        }
      }
    })
  }, [jumpToPage, pageAnchorRefs, pageNumRef])

  const lastTtsRangeRef = useRef<{ range: Range; page?: number } | null>(null)
  const isUserInteractingRef = useRef(false)
  const userInteractionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const centerPdfRange = useCallback(
    (item: { range: Range; page?: number }) => {
      try {
        if (item.page != null && item.page !== pageNumRef.current) {
          jumpToPage(item.page)
        }
        const host =
          item.range.startContainer instanceof Element
            ? item.range.startContainer
            : item.range.startContainer.parentElement
        host?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {}
    },
    [jumpToPage, pageNumRef],
  )

  useEffect(() => {
    const markUserInteraction = () => {
      isUserInteractingRef.current = true
      if (userInteractionTimerRef.current) {
        clearTimeout(userInteractionTimerRef.current)
      }
      userInteractionTimerRef.current = setTimeout(() => {
        let hasActiveSelection = false
        try {
          const sel = window.getSelection()
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
            centerPdfRange(lastTtsRangeRef.current)
          }
        }
      }, 3000)
    }

    const onWheel = () => {
      markUserInteraction()
    }

    const onSelectionChange = () => {
      try {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
          markUserInteraction()
        }
      } catch {}
    }

    window.addEventListener('wheel', onWheel, { passive: true, capture: true })
    document.addEventListener('selectionchange', onSelectionChange, { passive: true })

    return () => {
      if (userInteractionTimerRef.current) {
        clearTimeout(userInteractionTimerRef.current)
        userInteractionTimerRef.current = null
      }
      window.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [centerPdfRange])

  useEffect(() => {
    const clearTtsHighlight = () => {
      try {
        const viewWindow = window as any
        viewWindow?.CSS?.highlights?.delete('montree-tts-active')
      } catch {}
    }

    const isPdfRangeInViewport = (range: Range): boolean => {
      try {
        const rect = range.getBoundingClientRect()
        const winH = window.innerHeight
        const winW = window.innerWidth
        if (rect.width === 0 && rect.height === 0) {
          const parent =
            range.startContainer instanceof Element
              ? range.startContainer
              : range.startContainer.parentElement
          if (!parent) return false
          const pRect = parent.getBoundingClientRect()
          return pRect.top >= 48 && pRect.bottom <= winH - 48
        }
        return rect.top >= 48 && rect.bottom <= winH - 48 && rect.left >= 0 && rect.right <= winW
      } catch {
        return false
      }
    }

    return subscribeTtsHighlight(
      (sentence, forceScroll) => {
        clearTtsHighlight()
        const currentEl = pageAnchorRefs.current.get(pageNumRef.current)

        const cleanCore = sentence
          .replace(/[，。！？；：“”‘’（）《》、\s,.!?;:'"()[\]]/g, '')
          .slice(0, 15)
        let range: Range | null = null
        let targetPage: number | undefined = pageNumRef.current

        if (currentEl) {
          range = findTextRangeInRoot(currentEl, sentence)
          if (!range && cleanCore.length >= 4) {
            range = findTextRangeInRoot(currentEl, cleanCore)
          }
          if (!range) {
            range = findTextRangeInRoot(currentEl, sentence.slice(0, 20))
          }
        }

        // 若当前页未找到（如朗读已跨到后续页面），扫描其余已挂载页面
        if (!range) {
          for (const [page, el] of pageAnchorRefs.current.entries()) {
            if (page === pageNumRef.current) continue
            let candidate = findTextRangeInRoot(el, sentence)
            if (!candidate && cleanCore.length >= 4) {
              candidate = findTextRangeInRoot(el, cleanCore)
            }
            if (!candidate) {
              candidate = findTextRangeInRoot(el, sentence.slice(0, 20))
            }
            if (candidate) {
              range = candidate
              targetPage = page
              break
            }
          }
        }

        if (range) {
          lastTtsRangeRef.current = { range, page: targetPage }
          try {
            const viewWindow = window as any
            const registry = viewWindow?.CSS?.highlights
            const HighlightCtor = viewWindow?.Highlight
            if (registry && HighlightCtor) {
              registry.set('montree-tts-active', new HighlightCtor(range))
            }

            const inViewport = isPdfRangeInViewport(range)
            if (forceScroll) {
              isUserInteractingRef.current = false
              if (userInteractionTimerRef.current) {
                clearTimeout(userInteractionTimerRef.current)
                userInteractionTimerRef.current = null
              }
              centerPdfRange({ range, page: targetPage })
            } else if (!isUserInteractingRef.current && (!inViewport || targetPage !== pageNumRef.current)) {
              centerPdfRange({ range, page: targetPage })
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
        clearTtsHighlight()
      },
    )
  }, [centerPdfRange, pageAnchorRefs, pageNumRef])

  const handleDeleteMark = useCallback(
    async (mark: ReadingMark) => {
      await deleteMark(mark.id)
      toast.success('已删除')
    },
    [deleteMark],
  )

  const handlePdfMarkHoverMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (inspector.active || noteDialogOpen || selectionToolbarPos) {
        if (hoveredMark) {
          setHoveredMark(null)
          setMarkTooltipPos(null)
        }
        return
      }

      const target = (event.target as HTMLElement | null)?.closest?.('[data-page]')
      if (!(target instanceof HTMLElement)) {
        if (hoveredMark) {
          setHoveredMark(null)
          setMarkTooltipPos(null)
        }
        return
      }
      const page = Number.parseInt(target.dataset.page ?? '', 10)
      if (!Number.isFinite(page)) return

      const pageElement = pageAnchorRefs.current.get(page)
      if (!pageElement) return

      const hit = findPdfNoteMarkAtPoint(marks, page, event.clientX, event.clientY, pageElement)
      if (!hit) {
        if (hoveredMark) {
          setHoveredMark(null)
          setMarkTooltipPos(null)
        }
        return
      }
      if (hoveredMark?.id === hit.id) {
        setMarkTooltipPos({ x: event.clientX, y: event.clientY })
        return
      }
      setHoveredMark(hit)
      setMarkTooltipPos({ x: event.clientX, y: event.clientY })
    },
    [hoveredMark, inspector.active, marks, noteDialogOpen, pageAnchorRefs, selectionToolbarPos],
  )

  const handlePdfMarkHoverLeave = useCallback(() => {
    setHoveredMark(null)
    setMarkTooltipPos(null)
  }, [])

  useEffect(() => {
    return registerSelectionProvider({
      filePath,
      getSelectionText: () => selectionTransactionRef.current?.text?.trim() || null,
    })
  }, [filePath])

  useEffect(() => {
    selectionTransactionRef.current = null
    setSelectionSnapshot(null)
    setSelectionToolbarPos(null)
    clearReaderSelection()
  }, [filePath])

  return {
    selectionSnapshot,
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
    pointerOriginRef,
    selectionTransactionRef,
    clearTextSelection,
    dimTextSelection,
    captureSelectionSnapshot,
    handlePageMouseUp,
    addPageBookmark,
    handleSaveAnnotation,
    selectionActions,
    handleCreateMarkAt,
    handleSelectMark,
    handleDeleteMark,
    handlePdfMarkHoverMove,
    handlePdfMarkHoverLeave,
  }
}
