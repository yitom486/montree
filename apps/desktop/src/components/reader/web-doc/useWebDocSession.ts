import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReadingMark } from '@montree/contracts'
import {
  bindDocumentSelectionCollapse,
  bindOutsideReaderPointerDismiss,
  clearWindowSelection,
  copyTextToClipboard,
  findWebDocFlatIndex,
  injectMobiMarkStyles,
  isClickNotDrag,
  readMobiSelection,
  type ReaderUnit,
} from '@montree/reader-core'
import {
  findMobiMarksAtPoint,
  findMobiNoteMarkAtPoint,
  applyMobiPendingSelectionHighlight,
  renderWebMarkOverlays,
} from '@/lib/reader/marks/mobi-reading-marks'
import {
  runRevealPlan,
  scrollElementTextIntoView,
  subscribeAnchorHighlight,
  subscribeRevealMark,
  type RevealAdapter,
} from '@/lib/reader/marks/mark-linkage'
import { extractDocumentText, extractViewportText } from '@/lib/agent/context/extract-dom-text'
import { focusAgentComposerOnReaderSelection } from '@/lib/agent/context/focus-agent-composer'
import { registerReaderContent } from '@/lib/agent/context/reader-content-registry'
import { registerReaderMarks, type CreateMarkAtParams } from '@/lib/agent/context/reader-marks-registry'
import {
  clearReaderSelection,
  commitReaderSelection,
  registerSelectionProvider,
} from '@/lib/agent/context/reader-selection-registry'
import { useDeferredReaderLayout } from '@/hooks/reader/useDeferredReaderLayout'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import type { AppTheme } from '@/stores/editor-ui-store'
import { appApi } from '@/api/app-api'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { toast } from 'sonner'
import { applyCopyButtonFeedback, getCodeBlockTextFromCopyButton } from '@/lib/preview/code-block-copy'
import { activateWebDocCodeTab } from '@/lib/reader/web-doc/web-doc-code-blocks'
import { buildWebDocReaderDocument } from '@/lib/reader/web-doc/web-doc-html'
import {
  detectWebDocIframeEscape,
  isCrossOriginIframeEscape,
  isWebDocNavigationTarget,
  resolveWebDocClickHref,
  resolveWebDocFragment,
} from '@/lib/reader/web-doc/web-doc-link'
import {
  iterateWebDocUnits,
  primeWebDocAgentTextCache,
  readWebDocUnitByIndex,
} from '@/lib/reader/web-doc/web-doc-agent-content'
import { logWebDoc } from '@/lib/reader/web-doc/web-doc-debug'
import type { WebDocPageData } from '@/hooks/reader/useWebDocPage'
import type { useReadingMarkInspector } from '@/hooks/reader/useReadingMarkInspector'
import type { PdfSelectionSnapshot } from '@montree/reader-core'

type UseReadingMarkInspectorReturn = ReturnType<typeof useReadingMarkInspector>

const WEB_PROGRESS_SAVE_MS = 400

export interface UseWebDocSessionOptions {
  pageUrl: string
  documentId: string
  documentUrl: string
  normalizedPageUrl: string
  fileFingerprint: string
  theme: AppTheme
  data: WebDocPageData | null | undefined
  units: ReaderUnit[]
  unitsRef: React.RefObject<ReaderUnit[]>
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  marks: ReadingMark[]
  marksRef: React.RefObject<ReadingMark[]>
  inspector: UseReadingMarkInspectorReturn
  inspectorRef: React.RefObject<UseReadingMarkInspectorReturn>
  noteDialogOpen: boolean
  editingNoteMark: ReadingMark | null
  selectionSnapshotRef: React.RefObject<PdfSelectionSnapshot | null>
  pointerOriginRef: React.RefObject<{ x: number; y: number } | null>
  hoveredMarkIdRef: React.RefObject<string | null>
  setSelectionSnapshot: (snapshot: PdfSelectionSnapshot | null) => void
  setSelectionToolbarPos: (pos: { x: number; y: number } | null) => void
  setHoveredMark: (mark: ReadingMark | null) => void
  setMarkTooltipPos: (pos: { x: number; y: number } | null) => void
  dimTextSelection: () => void
  navigateToUrl: (url: string, flatIndex?: number) => void
  scrollToWebDocFragment: (fragment: string) => boolean
  handleWebDocLink: (href: string) => void
  syncActiveHeadingFromScroll: () => void
  persistScrollProgress: () => void
  restoreScrollProgress: () => void
  addPageBookmark: () => Promise<ReadingMark>
  handleSaveAnnotation: (note: string) => Promise<ReadingMark>
  handleCreateMarkAt: (params: CreateMarkAtParams) => Promise<ReadingMark>
}

export function useWebDocSession({
  pageUrl,
  documentId,
  documentUrl,
  normalizedPageUrl,
  fileFingerprint,
  theme,
  data,
  units,
  unitsRef,
  iframeRef,
  marks,
  marksRef,
  inspector,
  inspectorRef,
  noteDialogOpen,
  editingNoteMark,
  selectionSnapshotRef,
  pointerOriginRef,
  hoveredMarkIdRef,
  setSelectionSnapshot,
  setSelectionToolbarPos,
  setHoveredMark,
  setMarkTooltipPos,
  dimTextSelection,
  navigateToUrl,
  scrollToWebDocFragment,
  handleWebDocLink,
  syncActiveHeadingFromScroll,
  persistScrollProgress,
  restoreScrollProgress,
  addPageBookmark,
  handleSaveAnnotation,
  handleCreateMarkAt,
}: UseWebDocSessionOptions) {
  const [iframeReady, setIframeReady] = useState(false)
  const ready = Boolean(data) && iframeReady

  const themeRef = useRef(theme)
  themeRef.current = theme
  const pageUrlRef = useRef(pageUrl)
  pageUrlRef.current = pageUrl

  const readerFontSize = useAppSettingsStore((state) => state.readerFontSize)
  const readerLineHeight = useAppSettingsStore((state) => state.readerLineHeight)

  const saveProgressTimerRef = useRef<number | null>(null)
  const lastInContentNavRef = useRef<{ href: string; at: number } | null>(null)
  const frameCleanupRef = useRef<(() => void) | null>(null)

  const readerDocument = useMemo(() => {
    if (!data) return ''
    return buildWebDocReaderDocument(data.content, theme, {
      fontSize: readerFontSize,
      lineHeight: readerLineHeight,
    })
  }, [data, readerFontSize, readerLineHeight, theme])

  const readerDocumentRef = useRef(readerDocument)
  readerDocumentRef.current = readerDocument

  const handleWebDocLinkRef = useRef(handleWebDocLink)
  handleWebDocLinkRef.current = handleWebDocLink

  const syncWebMarkOverlays = useCallback(
    (doc: Document, url: string) => {
      if (!doc.body) return
      injectMobiMarkStyles(doc, themeRef.current)
      renderWebMarkOverlays(doc.body, marksRef.current, url, themeRef.current)
      if (noteDialogOpen && !editingNoteMark) {
        const rects = selectionSnapshotRef.current?.rects
        if (rects?.length) {
          applyMobiPendingSelectionHighlight(doc.body, rects, themeRef.current)
        }
      }
    },
    [editingNoteMark, marksRef, noteDialogOpen, selectionSnapshotRef],
  )

  const scheduleWebMarkLayout = useDeferredReaderLayout(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc?.body) return
    hoveredMarkIdRef.current = null
    setHoveredMark(null)
    setMarkTooltipPos(null)
    syncWebMarkOverlays(doc, pageUrlRef.current)
  })

  // Navigation store session
  useEffect(() => {
    useReaderNavigationStore.getState().beginSession(documentId, 'web')
    return () => {
      useReaderNavigationStore.getState().beginSession('', 'web')
    }
  }, [documentId])

  useEffect(() => {
    if (units.length === 0) return
    useReaderNavigationStore.getState().setUnits(units)
  }, [units])

  useEffect(() => {
    if (!data || units.length === 0) return
    useReaderNavigationStore.getState().syncWeb(units, pageUrl)
    useReaderNavigationStore.getState().setReady(true)
  }, [data, pageUrl, units])

  // Mark overlays layout update
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc?.body || !iframeReady) return
    scheduleWebMarkLayout()
  }, [iframeReady, marks, normalizedPageUrl, readerFontSize, readerLineHeight, scheduleWebMarkLayout, theme])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !ready) return
    const observer = new ResizeObserver(() => scheduleWebMarkLayout())
    observer.observe(iframe)
    return () => observer.disconnect()
  }, [ready, scheduleWebMarkLayout])

  const bindIframeFrame = useCallback(
    (iframe: HTMLIFrameElement) => {
      frameCleanupRef.current?.()

      const doc = iframe.contentDocument
      const win = iframe.contentWindow
      if (!doc || !win || !doc.body) return

      scheduleWebMarkLayout()
      const frameRect = iframe.getBoundingClientRect()

      const onMouseDown = (event: MouseEvent) => {
        pointerOriginRef.current = { x: event.clientX, y: event.clientY }
      }

      const tryInContentNavigate = (href: string, targetWin: Window) => {
        const now = Date.now()
        const last = lastInContentNavRef.current
        if (last && last.href === href && now - last.at < 400) return
        lastInContentNavRef.current = { href, at: now }

        clearWindowSelection(targetWin)
        setSelectionToolbarPos(null)
        inspectorRef.current.close()
        handleWebDocLink(href)
      }

      const onMouseUp = (event: MouseEvent) => {
        if (isWebDocNavigationTarget(event.target, pageUrlRef.current)) {
          pointerOriginRef.current = null
          return
        }

        window.setTimeout(() => {
          if (isClickNotDrag(pointerOriginRef.current, event)) {
            const hits = findMobiMarksAtPoint(doc, event.clientX, event.clientY)
              .map((hit) => marksRef.current.find((item) => item.id === hit.markId))
              .filter((item): item is ReadingMark => Boolean(item))
            if (hits.length > 0) {
              clearWindowSelection(win)
              setSelectionToolbarPos(null)
              inspectorRef.current.openAt(
                hits,
                frameRect.left + event.clientX,
                frameRect.top + event.clientY,
              )
              return
            }
          }

          const snapshot = readMobiSelection(doc, win)
          if (!snapshot) {
            if (isClickNotDrag(pointerOriginRef.current, event)) {
              inspectorRef.current.close()
            }
            return
          }

          inspectorRef.current.close()
          setSelectionSnapshot(snapshot)
          commitReaderSelection(documentId, snapshot.text)
          focusAgentComposerOnReaderSelection()
          setSelectionToolbarPos({
            x: frameRect.left + snapshot.toolbarX,
            y: frameRect.top + snapshot.toolbarY,
          })
        }, 10)
      }

      const onScroll = () => {
        syncActiveHeadingFromScroll()
        if (saveProgressTimerRef.current != null) {
          window.clearTimeout(saveProgressTimerRef.current)
        }
        saveProgressTimerRef.current = window.setTimeout(() => {
          persistScrollProgress()
          saveProgressTimerRef.current = null
        }, WEB_PROGRESS_SAVE_MS)
      }

      const onCodeChromeClick = (event: MouseEvent) => {
        const target = event.target
        if (!(target instanceof Element)) return

        const tab =
          target.closest<HTMLElement>('.web-doc-tabs-tab') ??
          target.closest<HTMLElement>('[data-web-doc-tab]')
        if (tab) {
          event.preventDefault()
          event.stopPropagation()
          activateWebDocCodeTab(tab)
          return
        }

        const button = target.closest<HTMLButtonElement>('.code-block-copy')
        if (!button) return

        event.preventDefault()
        event.stopPropagation()

        const text = getCodeBlockTextFromCopyButton(button)
        if (!text) return

        void copyTextToClipboard(text).then((ok) => {
          if (!ok) return
          applyCopyButtonFeedback(button)
          toast.success('代码已复制')
        })
      }

      const onPointerDownCapture = (event: PointerEvent) => {
        if (event.button !== 0) return

        if (event.target instanceof Element) {
          const tab =
            event.target.closest<HTMLElement>('.web-doc-tabs-tab') ??
            event.target.closest<HTMLElement>('[data-web-doc-tab]')
          if (tab) {
            event.preventDefault()
            event.stopPropagation()
            activateWebDocCodeTab(tab)
            return
          }
        }

        const href = resolveWebDocClickHref(event.target, pageUrlRef.current)
        if (!href) return

        event.preventDefault()
        event.stopPropagation()

        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          void appApi.openExternal(href)
          return
        }

        tryInContentNavigate(href, win)
      }

      const onClickCapture = (event: MouseEvent) => {
        const href = resolveWebDocClickHref(event.target, pageUrlRef.current)
        if (!href) return

        event.preventDefault()
        event.stopPropagation()

        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          void appApi.openExternal(href)
          return
        }

        tryInContentNavigate(href, win)
      }

      const onKeyDownCapture = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return

        const href = resolveWebDocClickHref(event.target, pageUrlRef.current)
        if (!href) return

        event.preventDefault()
        event.stopPropagation()

        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          void appApi.openExternal(href)
          return
        }

        tryInContentNavigate(href, win)
      }

      const onSelectionChange = bindDocumentSelectionCollapse(doc, win, () => {
        setSelectionToolbarPos(null)
      })

      let hoverRaf = 0
      const onMouseMove = (event: MouseEvent) => {
        if (hoverRaf !== 0) return
        hoverRaf = window.requestAnimationFrame(() => {
          hoverRaf = 0
          const hit = findMobiNoteMarkAtPoint(doc, event.clientX, event.clientY)
          if (!hit) {
            if (hoveredMarkIdRef.current !== null) {
              hoveredMarkIdRef.current = null
              setHoveredMark(null)
              setMarkTooltipPos(null)
            }
            return
          }

          if (hoveredMarkIdRef.current === hit.markId) return

          const mark = marksRef.current.find((item) => item.id === hit.markId)
          if (!mark?.note?.trim()) return

          hoveredMarkIdRef.current = hit.markId
          const rect = hit.element.getBoundingClientRect()
          setHoveredMark(mark)
          setMarkTooltipPos({
            x: frameRect.left + rect.left + rect.width / 2,
            y: frameRect.top + rect.top,
          })
        })
      }

      doc.addEventListener('click', onCodeChromeClick)
      doc.addEventListener('click', onClickCapture, true)
      doc.addEventListener('keydown', onKeyDownCapture, true)
      doc.addEventListener('pointerdown', onPointerDownCapture, true)
      doc.addEventListener('mousedown', onMouseDown)
      doc.addEventListener('mouseup', onMouseUp)
      doc.addEventListener('scroll', onScroll, { passive: true })
      doc.addEventListener('mousemove', onMouseMove, { passive: true })
      syncActiveHeadingFromScroll()

      frameCleanupRef.current = () => {
        doc.removeEventListener('click', onCodeChromeClick)
        doc.removeEventListener('click', onClickCapture, true)
        doc.removeEventListener('keydown', onKeyDownCapture, true)
        doc.removeEventListener('pointerdown', onPointerDownCapture, true)
        doc.removeEventListener('mousedown', onMouseDown)
        doc.removeEventListener('mouseup', onMouseUp)
        doc.removeEventListener('scroll', onScroll)
        doc.removeEventListener('mousemove', onMouseMove)
        onSelectionChange()
        if (hoverRaf !== 0) window.cancelAnimationFrame(hoverRaf)
      }
    },
    [documentId, handleWebDocLink, hoveredMarkIdRef, inspectorRef, marksRef, persistScrollProgress, pointerOriginRef, scheduleWebMarkLayout, setHoveredMark, setMarkTooltipPos, setSelectionSnapshot, setSelectionToolbarPos, syncActiveHeadingFromScroll],
  )

  const bindIframeFrameRef = useRef(bindIframeFrame)
  bindIframeFrameRef.current = bindIframeFrame

  // Manage iframe loading & escapes
  useEffect(() => {
    setIframeReady(false)
    const iframe = iframeRef.current
    if (!iframe) return

    frameCleanupRef.current?.()
    frameCleanupRef.current = null

    if (!readerDocument) {
      iframe.srcdoc = ''
      logWebDoc('iframe-clear', { pageUrl, reason: 'empty-reader-document' })
      return
    }

    let fragmentRaf = 0

    const onLoad = () => {
      const escaped = detectWebDocIframeEscape(iframe, window.location.origin)
      if (escaped) {
        let isAppSelf = false
        if (!isCrossOriginIframeEscape(escaped)) {
          try {
            isAppSelf = new URL(escaped).origin === window.location.origin
          } catch {
            isAppSelf = false
          }
          if (!isAppSelf) {
            handleWebDocLinkRef.current(escaped)
          }
        }
        logWebDoc('iframe-escape', {
          pageUrl,
          escaped: isCrossOriginIframeEscape(escaped) ? escaped : escaped.slice(0, 160),
          isAppSelf,
        })
        if (readerDocumentRef.current) {
          iframe.srcdoc = readerDocumentRef.current
        }
        return
      }

      logWebDoc('iframe-load', {
        pageUrl,
        readerDocLen: readerDocument.length,
        bodyTextLen: iframe.contentDocument?.body?.textContent?.trim().length ?? 0,
      })
      setIframeReady(true)
      bindIframeFrameRef.current(iframe)

      const fragment = resolveWebDocFragment(pageUrl, documentUrl)
      if (fragment !== null) {
        fragmentRaf = window.requestAnimationFrame(() => {
          fragmentRaf = window.requestAnimationFrame(() => {
            fragmentRaf = 0
            const found = scrollToWebDocFragment(fragment)
            logWebDoc('fragment-scroll', { pageUrl, fragment, found })
          })
        })
      } else {
        restoreScrollProgress()
        syncActiveHeadingFromScroll()
      }

      const text = extractDocumentText(iframe.contentDocument)
      if (text.trim()) {
        primeWebDocAgentTextCache(pageUrl, text)
      }
    }

    iframe.addEventListener('load', onLoad)
    iframe.srcdoc = readerDocument
    logWebDoc('iframe-srcdoc', { pageUrl, readerDocLen: readerDocument.length })

    return () => {
      iframe.removeEventListener('load', onLoad)
      if (fragmentRaf !== 0) {
        window.cancelAnimationFrame(fragmentRaf)
        fragmentRaf = 0
      }
      frameCleanupRef.current?.()
      frameCleanupRef.current = null
    }
  }, [documentUrl, iframeRef, pageUrl, readerDocument, restoreScrollProgress, scrollToWebDocFragment, syncActiveHeadingFromScroll])

  // Persist scroll on unmount / pageUrl change
  useEffect(() => {
    return () => {
      if (saveProgressTimerRef.current != null) {
        window.clearTimeout(saveProgressTimerRef.current)
      }
      persistScrollProgress()
    }
  }, [pageUrl, persistScrollProgress])

  // Agent content registry
  useEffect(() => {
    return registerReaderContent({
      filePath: pageUrl,
      getCurrentText: () => extractDocumentText(iframeRef.current?.contentDocument),
      getViewportText: () => extractViewportText(iframeRef.current?.contentDocument),
      getUnitByIndex: async (flatIndex) => {
        if (unitsRef.current.length === 0) return null
        try {
          return await readWebDocUnitByIndex(unitsRef.current, flatIndex)
        } catch {
          return null
        }
      },
      iterateUnits: async function* () {
        if (unitsRef.current.length === 0) return
        yield* iterateWebDocUnits(unitsRef.current)
      },
    })
  }, [iframeRef, pageUrl, unitsRef])

  // Agent marks registry
  useEffect(() => {
    return registerReaderMarks({
      filePath: documentId,
      createBookmark: () => addPageBookmark(),
      createNoteFromSelection: (note) => handleSaveAnnotation(note),
      createMarkAt: (params) => handleCreateMarkAt(params),
      navigateToFlatIndex: (index) => {
        const unit = unitsRef.current[index]
        if (unit?.href) navigateToUrl(unit.href, index)
      },
    })
  }, [
    addPageBookmark,
    documentId,
    handleCreateMarkAt,
    handleSaveAnnotation,
    navigateToUrl,
    unitsRef,
  ])

  // Selection provider
  useEffect(() => {
    return registerSelectionProvider({
      filePath: documentId,
      getSelectionText: () => {
        const cached = selectionSnapshotRef.current?.text?.trim()
        if (cached) return cached
        const doc = iframeRef.current?.contentDocument
        const win = iframeRef.current?.contentWindow
        if (!doc || !win) return null
        return readMobiSelection(doc, win)?.text?.trim() || null
      },
    })
  }, [documentId, iframeRef, selectionSnapshotRef])

  useEffect(() => {
    return () => {
      clearReaderSelection()
    }
  }, [documentId])

  // Dismiss toolbar on clicking outside
  useEffect(() => {
    return bindOutsideReaderPointerDismiss((target) => {
      const iframe = iframeRef.current
      if (!iframe) return false
      return target === iframe || iframe.contains(target)
    }, () => {
      if (noteDialogOpen) return
      dimTextSelection()
    })
  }, [dimTextSelection, iframeRef, noteDialogOpen])

  // Reveal mark handling
  const handleSelectMark = useCallback(
    (mark: ReadingMark) => {
      const adapter: RevealAdapter = {
        tryStep: (step): boolean => {
          switch (step.type) {
            case 'web-url': {
              if (step.url !== pageUrlRef.current) {
                navigateToUrl(step.url)
                return true
              }
              if (step.headingId) return scrollToWebDocFragment(step.headingId)
              return false
            }
            case 'excerpt': {
              let doc: Document | null | undefined
              try {
                doc = iframeRef.current?.contentDocument
              } catch {
                return false
              }
              if (!doc?.body) return false
              const range = scrollElementTextIntoView(doc.body, step.text)
              if (!range) return false
              try {
                const selection = doc.defaultView?.getSelection()
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
            filePath: documentId,
            data: { markId: mark.id, reason: result.miss.reason },
          })
        }
      })
    },
    [documentId, iframeRef, navigateToUrl, scrollToWebDocFragment],
  )

  useEffect(() => {
    return subscribeRevealMark((id) => {
      const mark = marksRef.current.find((item) => item.id === id)
      if (mark) handleSelectMark(mark)
    })
  }, [handleSelectMark, marksRef])

  useEffect(() => {
    return subscribeAnchorHighlight((excerpt) => {
      let doc: Document | null | undefined
      try {
        doc = iframeRef.current?.contentDocument
      } catch {
        return
      }
      if (!doc?.body) return
      const range = scrollElementTextIntoView(doc.body, excerpt)
      if (!range) return
      try {
        const selection = doc.defaultView?.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range.cloneRange())
      } catch {
        // ignore
      }
    })
  }, [iframeRef])

  return {
    iframeReady,
    ready,
    readerDocument,
    syncWebMarkOverlays,
    scheduleWebMarkLayout,
    handleSelectMark,
  }
}
