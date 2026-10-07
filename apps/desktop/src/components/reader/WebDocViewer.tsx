import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { PaneErrorBoundary } from '@/components/shared/PaneErrorBoundary'
import { AnnotationNoteDialog } from '@/components/reader/AnnotationNoteDialog'
import { EpubMarkTooltip } from '@/components/reader/EpubMarkTooltip'
import { ReaderContentShell } from '@/components/reader/ReaderContentShell'
import { ReaderFooterNav } from '@/components/reader/ReaderFooterNav'
import { ReaderToolbarShell } from '@/components/reader/ReaderToolbarShell'
import { useIsDockedAgentVisible } from '@/components/agent/AgentPanel'
import { DockedAgentPane } from '@/components/agent/DockedAgentPane'
import { ReaderTypographyControls } from '@/components/reader/ReaderTypographyControls'
import { ReadingMarkPopover } from '@/components/reader/ReadingMarkPopover'
import { SelectionToolbar } from '@/components/reader/SelectionToolbar'
import { DeepAnswerDialog } from '@/components/reader/DeepAnswerDialog'
import { useWebDocPage } from '@/hooks/reader/useWebDocPage'
import { useWebDocToc } from '@/hooks/reader/useWebDocToc'
import { useReaderSidePanels } from '@/hooks/reader/useReaderSidePanels'
import { useReadingMarkInspector } from '@/hooks/reader/useReadingMarkInspector'
import { useReaderSelectionActions } from '@/hooks/reader/useReaderSelectionActions'
import { parseNoteToCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import {
  runRevealPlan,
  scrollElementTextIntoView,
  subscribeRevealMark,
  subscribeAnchorHighlight,
  type RevealAdapter,
} from '@/lib/reader/marks/mark-linkage'
import { useReaderExportMenu } from '@/hooks/reader/useReaderExportMenu'
import { useReadingMarks } from '@/hooks/reader/useReadingMarks'
import { useDeferredReaderLayout } from '@/hooks/reader/useDeferredReaderLayout'
import { appApi } from '@/api/app-api'
import { queryKeys } from '@/api/query-keys'
import { extractDocumentText, extractViewportText } from '@/lib/agent/context/extract-dom-text'
import { focusAgentComposerOnReaderSelection } from '@/lib/agent/context/focus-agent-composer'
import { registerReaderContent } from '@/lib/agent/context/reader-content-registry'
import { registerReaderMarks } from '@/lib/agent/context/reader-marks-registry'
import { registerSelectionProvider, commitReaderSelection, clearReaderSelection } from '@/lib/agent/context/reader-selection-registry'
import { useTtsStore } from '@/stores/tts-store'
import { DEFAULT_HIGHLIGHT_COLOR } from '@montree/reader-core'
import { findMarkForSelection, isClickNotDrag } from '@montree/reader-core'
import { buildWebDocReaderDocument } from '@/lib/reader/web-doc/web-doc-html'
import { extractWebDocHeadings } from '@/lib/reader/web-doc/web-doc-outline'
import {
  collectPreviewHeadingPositions,
  findActiveHeadingByPositions,
  type MarkdownHeading,
} from '@/lib/editor/markdown-headings'
import type { EditorOutlineState } from '@/components/layout/main/EditorWorkspaceMain'
import {
  buildWebDocFileFingerprint,
  formatWebDocTitle,
  resolveWebDocDocumentId,
  resolveWebDocSiteId,
  resolveWebDocTocDiscoveryUrl,
  stripWebDocFragment,
} from '@montree/web-doc'
import {
  resolveWebDocClickHref,
  resolveWebDocFragment,
  shouldNavigateWebDocInApp,
  isWebDocNavigationTarget,
  detectWebDocIframeEscape,
  isCrossOriginIframeEscape,
} from '@/lib/reader/web-doc/web-doc-link'
import { logWebDoc } from '@/lib/reader/web-doc/web-doc-debug'
import { findWebDocFlatIndex, normalizeWebDocNavUrl, webDocTocEntriesToReaderUnits } from '@montree/reader-core'
import { toCanonicalChapter } from '@montree/reader-core'
import {
  iterateWebDocUnits,
  primeWebDocAgentTextCache,
  readWebDocUnitByIndex,
} from '@/lib/reader/web-doc/web-doc-agent-content'
import { readMobiSelection, buildMobiSnapshotFromRange } from '@montree/reader-core'
import { findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'
import { waitForDom } from '@/lib/reader/wait-for-dom'
import type { CreateMarkAtParams } from '@/lib/agent/context/reader-marks-registry'
import {
  applyMobiPendingSelectionHighlight,
  findMobiMarksAtPoint,
  findMobiNoteMarkAtPoint,
  removeMobiPendingSelectionHighlight,
  renderWebMarkOverlays,
} from '@/lib/reader/marks/mobi-reading-marks'
import { injectMobiMarkStyles } from '@montree/reader-core'
import {
  bindDocumentSelectionCollapse,
  bindOutsideReaderPointerDismiss,
  clearWindowSelection,
} from '@montree/reader-core'
import { copyTextToClipboard, type PdfSelectionSnapshot } from '@montree/reader-core'
import { applyCopyButtonFeedback, getCodeBlockTextFromCopyButton } from '@/lib/preview/code-block-copy'
import { activateWebDocCodeTab } from '@/lib/reader/web-doc/web-doc-code-blocks'
import {
  resolveWebChapter,
  tocFromWebUnits,
} from '@montree/reader-core'
import { reportAppError } from '@/lib/workspace/report-error'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useReadingProgressStore } from '@/stores/reading-progress-store'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useWebDocStore } from '@/stores/web-doc-store'
import { cn } from '@/lib/utils'
import { isOk } from '@montree/contracts'
import type { ReadingMark } from '@montree/contracts'
import { toast } from 'sonner'
import '@/styles/web-doc-viewer.css'

const WEB_PROGRESS_SAVE_MS = 400

export interface WebDocViewerHandle {
  selectHeading: (heading: MarkdownHeading) => void
}

import type { AppTheme } from '@/stores/editor-ui-store'

interface WebDocViewerProps {
  pageUrl: string
  theme: AppTheme
  onOutlineChange?: (state: EditorOutlineState) => void
  /** 透传给内框 docked 侧栏，供 Agent 会话 cwd */
  workspaceRoot?: string
}

export const WebDocViewer = forwardRef<WebDocViewerHandle, WebDocViewerProps>(
  function WebDocViewer({ pageUrl, theme, onOutlineChange, workspaceRoot }, ref) {
  // docked 侧栏挂载于内框行（工具栏之下、底导航之上），与正文同属左大块
  const dockedAgentVisible = useIsDockedAgentVisible()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const saveProgressTimerRef = useRef<number | null>(null)
  const themeRef = useRef(theme)
  themeRef.current = theme
  const pageUrlRef = useRef(pageUrl)
  pageUrlRef.current = pageUrl
  const lastInContentNavRef = useRef<{ href: string; at: number } | null>(null)
  const queryClient = useQueryClient()
  const openPage = useWebDocStore((state) => state.openPage)
  const readerFontSize = useAppSettingsStore((state) => state.readerFontSize)
  const readerLineHeight = useAppSettingsStore((state) => state.readerLineHeight)
  const { data, isLoading, isFetching, error, refetch } = useWebDocPage(pageUrl)
  const siteId = useMemo(() => resolveWebDocSiteId(pageUrl), [pageUrl])
  const documentId = useMemo(() => resolveWebDocDocumentId(pageUrl, siteId), [pageUrl, siteId])
  const documentUrl = useMemo(() => stripWebDocFragment(pageUrl), [pageUrl])
  const normalizedPageUrl = useMemo(() => normalizeWebDocNavUrl(pageUrl), [pageUrl])
  const fileFingerprint = useMemo(() => buildWebDocFileFingerprint(documentId), [documentId])
  const tocDiscoveryUrl = useMemo(
    () => resolveWebDocTocDiscoveryUrl(pageUrl, siteId),
    [pageUrl, siteId],
  )
  const { data: tocData } = useWebDocToc(tocDiscoveryUrl)
  const units = useMemo(
    () => webDocTocEntriesToReaderUnits(tocData?.entries ?? []),
    [tocData?.entries],
  )
  const unitsRef = useRef(units)
  unitsRef.current = units
  const { tocOpen, marksOpen, toggleToc, toggleMarks, closeToc, closeMarks } = useReaderSidePanels()
  const [iframeReady, setIframeReady] = useState(false)
  const ready = Boolean(data) && iframeReady
  const { marks, createMark, updateMark, deleteMark } = useReadingMarks(documentId)
  const marksRef = useRef(marks)
  marksRef.current = marks
  const inspector = useReadingMarkInspector(marks)
  const inspectorRef = useRef(inspector)
  inspectorRef.current = inspector
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
  const frameCleanupRef = useRef<(() => void) | null>(null)
  const nav = useReaderNavigationStore((state) => state.nav)

  const readerDocument = useMemo(() => {
    if (!data) return ''
    return buildWebDocReaderDocument(data.content, theme, {
      fontSize: readerFontSize,
      lineHeight: readerLineHeight,
    })
  }, [data, readerFontSize, readerLineHeight, theme])

  const displayTitle = useMemo(
    () => formatWebDocTitle(pageUrl, data?.content.title),
    [data?.content.title, pageUrl],
  )

  const pageHeadings = useMemo(
    () => (data?.content.bodyHtml ? extractWebDocHeadings(data.content.bodyHtml) : []),
    [data?.content.bodyHtml],
  )
  const pageHeadingsRef = useRef(pageHeadings)
  pageHeadingsRef.current = pageHeadings
  const [activeHeadingId, setActiveHeadingId] = useState<string>()

  useEffect(() => {
    setActiveHeadingId(undefined)
  }, [pageUrl])

  useEffect(() => {
    onOutlineChange?.({ headings: pageHeadings, activeHeadingId })
  }, [activeHeadingId, onOutlineChange, pageHeadings])

  const syncActiveHeadingFromScroll = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const root = doc?.scrollingElement ?? doc?.documentElement
    if (!root || !(root instanceof HTMLElement)) return
    const headings = pageHeadingsRef.current
    if (headings.length === 0) {
      setActiveHeadingId(undefined)
      return
    }
    const positions = collectPreviewHeadingPositions(root)
    const active = findActiveHeadingByPositions(headings, positions, root.scrollTop)
    setActiveHeadingId(active?.id)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      selectHeading: (heading: MarkdownHeading) => {
        const doc = iframeRef.current?.contentDocument
        const el = doc?.getElementById(heading.id)
        if (!el) return
        el.scrollIntoView({ block: 'start', behavior: 'smooth' })
        setActiveHeadingId(heading.id)
      },
    }),
    [],
  )

  const clearTextSelection = useCallback(() => {
    clearWindowSelection(iframeRef.current?.contentWindow ?? undefined)
    setSelectionSnapshot(null)
    setSelectionToolbarPos(null)
    clearReaderSelection()
    const body = iframeRef.current?.contentDocument?.body
    if (body) removeMobiPendingSelectionHighlight(body)
  }, [])

  const dimTextSelection = useCallback(() => {
    setSelectionToolbarPos(null)
    clearWindowSelection(iframeRef.current?.contentWindow ?? undefined)
  }, [])

  const showPendingSelectionHighlight = useCallback(() => {
    const body = iframeRef.current?.contentDocument?.body
    const rects = selectionSnapshotRef.current?.rects
    if (!body || !rects?.length) return
    applyMobiPendingSelectionHighlight(body, rects, themeRef.current)
  }, [])

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
    [editingNoteMark, noteDialogOpen],
  )

  const scheduleWebMarkLayout = useDeferredReaderLayout(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc?.body) return
    hoveredMarkIdRef.current = null
    setHoveredMark(null)
    setMarkTooltipPos(null)
    syncWebMarkOverlays(doc, pageUrlRef.current)
  })

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

  const navigateToUrl = useCallback(
    (targetUrl: string, flatIndex?: number) => {
      logWebDoc('navigate', { from: pageUrlRef.current, to: targetUrl, flatIndex })

      const currentUnits = unitsRef.current
      const resolvedIndex =
        typeof flatIndex === 'number' ? flatIndex : findWebDocFlatIndex(currentUnits, targetUrl)
      if (resolvedIndex >= 0) {
        useReaderNavigationStore.getState().syncWeb(currentUnits, targetUrl, resolvedIndex)
      }
      openPage(targetUrl)
    },
    [openPage],
  )

  const scrollToWebDocFragment = useCallback((fragment: string): boolean => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return false

    const target = doc.getElementById(fragment) ?? doc.getElementsByName(fragment)[0]
    if (!target) return false

    target.scrollIntoView({ block: 'start', behavior: 'auto' })
    setActiveHeadingId(target.id || undefined)
    return true
  }, [])

  const handleWebDocLink = useCallback(
    (href: string) => {
      logWebDoc('link-click', { href, pageUrl: pageUrlRef.current })
      if (shouldNavigateWebDocInApp(href, pageUrlRef.current)) {
        navigateToUrl(href)
        return
      }
      void appApi.openExternal(href)
    },
    [navigateToUrl],
  )

  const goPrevious = useCallback(() => {
    const previous = useReaderNavigationStore.getState().nav.previous
    if (!previous) return
    navigateToUrl(previous.href, useReaderNavigationStore.getState().nav.previousIndex)
  }, [navigateToUrl])

  const goNext = useCallback(() => {
    const next = useReaderNavigationStore.getState().nav.next
    if (!next) return
    navigateToUrl(next.href, useReaderNavigationStore.getState().nav.nextIndex)
  }, [navigateToUrl])

  const persistScrollProgress = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const root = doc?.documentElement
    if (!root) return

    const scrollHeight = root.scrollHeight - root.clientHeight
    if (scrollHeight <= 0) return

    const scrollRatio = root.scrollTop / scrollHeight
    useReadingProgressStore.getState().saveWebProgress(normalizedPageUrl, { scrollRatio })
  }, [normalizedPageUrl])

  const restoreScrollProgress = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const root = doc?.documentElement
    if (!root) return

    const saved = useReadingProgressStore.getState().getWebProgress(normalizedPageUrl)
    if (!saved) return

    const scrollHeight = root.scrollHeight - root.clientHeight
    if (scrollHeight <= 0) return

    root.scrollTop = scrollHeight * saved.scrollRatio
  }, [normalizedPageUrl])

  const addPageBookmark = useCallback(async () => {
    const result = await createMark({
      filePath: documentId,
      fileFingerprint,
      kind: 'bookmark',
      anchor: { format: 'web', url: normalizedPageUrl },
      label: nav.current?.label ?? data?.content.title ?? '书签',
      chapter: toCanonicalChapter(
        { format: 'web', url: normalizedPageUrl },
        tocFromWebUnits(units),
      ) ?? undefined,
    })
    if (!isOk(result)) {
      throw new Error(result.error.message || '创建书签失败')
    }
    toast.success('已添加书签')
    return result.value
  }, [createMark, data?.content.title, documentId, fileFingerprint, nav.current?.label, normalizedPageUrl])

  const handleSaveAnnotation = useCallback(
    async (
      note: string,
      color = DEFAULT_HIGHLIGHT_COLOR,
      overrideCategory?: import('@montree/contracts').ReadingMarkCategory,
      overrideTitle?: string,
    ) => {
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
        return result.value
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

      marksRef.current = [...marksRef.current, result.value]
      toast.success(note ? '已保存批注' : '已添加高亮')
      const doc = iframeRef.current?.contentDocument
      if (doc?.body) syncWebMarkOverlays(doc, pageUrl)
      clearTextSelection()
      return result.value
    },
    [clearTextSelection, createMark, documentId, fileFingerprint, marks, normalizedPageUrl, pageUrl, syncWebMarkOverlays, updateMark],
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
    async ({ excerpt, note, flatIndex, category, title }: CreateMarkAtParams) => {
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
    [handleSaveAnnotation, navigateToUrl],
  )

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

      const tryInContentNavigate = (href: string, win: Window) => {
        const now = Date.now()
        const last = lastInContentNavRef.current
        if (last && last.href === href && now - last.at < 400) return
        lastInContentNavRef.current = { href, at: now }

        clearWindowSelection(win)
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

      // 键盘回车激活链接只触发 click、不经过 pointerdown；此处补齐同一套路由，
      // 否则键盘操作的链接会走默认跳转导致 iframe 逃逸。鼠标左键已在 pointerdown
      // 处理过，tryInContentNavigate 的 400ms 同 href 去重会吞掉重复这次。
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
    [documentId, handleWebDocLink, persistScrollProgress, scheduleWebMarkLayout, syncActiveHeadingFromScroll],
  )

  useEffect(() => {
    logWebDoc('page-state', {
      pageUrl,
      isLoading,
      isFetching,
      hasData: Boolean(data),
      bodyLen: data?.content.bodyHtml.length ?? 0,
      readerDocLen: readerDocument.length,
      iframeReady,
      error: error?.message,
    })
  }, [data, error, iframeReady, isFetching, isLoading, pageUrl, readerDocument.length])

  const bindIframeFrameRef = useRef(bindIframeFrame)
  bindIframeFrameRef.current = bindIframeFrame
  const readerDocumentRef = useRef(readerDocument)
  readerDocumentRef.current = readerDocument
  const handleWebDocLinkRef = useRef(handleWebDocLink)
  handleWebDocLinkRef.current = handleWebDocLink

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
      // 逃逸恢复：任何漏网的默认跳转（空 href、SVG 链接、键盘激活等）一旦让 iframe
      // 离开 srcdoc，立刻拉回当前阅读文档，远端/应用自身内容永不占用阅读区。
      // srcdoc 恢复后 load 会再触发一次，此时已是 srcdoc，不会循环。
      const escaped = detectWebDocIframeEscape(iframe, window.location.origin)
      if (escaped) {
        let isAppSelf = false
        if (!isCrossOriginIframeEscape(escaped)) {
          try {
            isAppSelf = new URL(escaped).origin === window.location.origin
          } catch {
            isAppSelf = false
          }
          // 应用自身 URL（空 href 点到 base 的情况）只恢复、不路由，
          // 否则会把 dev server/file 地址丢给系统浏览器。
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
        // srcdoc has loaded, but layout can still settle after styles and
        // embeds are applied. Wait two frames before resolving the anchor.
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
  }, [documentUrl, pageUrl, readerDocument, restoreScrollProgress, scrollToWebDocFragment, syncActiveHeadingFromScroll])

  useEffect(() => {
    return () => {
      if (saveProgressTimerRef.current != null) {
        window.clearTimeout(saveProgressTimerRef.current)
      }
      persistScrollProgress()
    }
  }, [pageUrl, persistScrollProgress])

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
  }, [pageUrl])

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
  ])

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
  }, [documentId])

  useEffect(() => {
    return () => {
      clearReaderSelection()
    }
  }, [documentId])

  useEffect(() => {
    return bindOutsideReaderPointerDismiss((target) => {
      const iframe = iframeRef.current
      if (!iframe) return false
      return target === iframe || iframe.contains(target)
    }, () => {
      if (noteDialogOpen) return
      dimTextSelection()
    })
  }, [dimTextSelection, noteDialogOpen])

  useEffect(() => {
    if (error) {
      reportAppError(error)
    }
  }, [error])

  const handleReload = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.webDocPage(documentUrl) })
    void refetch()
  }

  const handleOpenInBrowser = () => {
    void appApi.openExternal(pageUrl)
  }

  const handleSelectMark = useCallback(
    (mark: ReadingMark) => {
      const adapter: RevealAdapter = {
        tryStep: (step): boolean => {
          switch (step.type) {
            case 'web-url': {
              // 跨页才导航；同页落到 heading/excerpt  intra 定位（此前同页也整页重载）
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
    [documentId, navigateToUrl, scrollToWebDocFragment],
  )

  // 悬浮窗卡片 reveal 请求：同文档 mark 才执行（跨文档请求忽略）。
  useEffect(() => {
    return subscribeRevealMark((id) => {
      const mark = marksRef.current.find((item) => item.id === id)
      if (mark) handleSelectMark(mark)
    })
  }, [handleSelectMark])

  // Agent 卡片与审计探针 anchor 原文定位请求：平滑定位原文并高亮选区
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
        // 选区失败不否定滚动定位
      }
    })
  }, [])

  const handleDeleteMark = useCallback(
    async (mark: ReadingMark) => {
      await deleteMark(mark.id)
      toast.success('已删除')
    },
    [deleteMark],
  )

  const { handleExportNotes, handleExportAnkiCards } = useReaderExportMenu({
    marks,
    filePath: documentId,
    getToc: () => tocFromWebUnits(units),
    getCurrentChapter: (toc) => {
      const currentHits = toc.filter((item) => item.matchKey === normalizedPageUrl)
      return currentHits.reduce(
        (best, item) => ((item.level ?? 0) >= (best.level ?? 0) ? item : best),
        currentHits[0] ?? null,
      )
    },
    resolveChapter: resolveWebChapter,
  })

  const currentUnitId = useMemo(() => {
    const flatIndex = findWebDocFlatIndex(units, pageUrl)
    if (flatIndex >= 0) return units[flatIndex]?.href
    return pageUrl
  }, [pageUrl, units])

  const readerHost = (
    <PaneErrorBoundary name="在线文档" filePath={pageUrl}>
      <div className={cn('web-doc-viewer-host relative h-full min-h-0 bg-[var(--color-bg-base)]', `theme-${theme}`)} data-theme={theme}>
        {isLoading && !data ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在加载页面…
          </div>
        ) : null}
        {error && !data ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {error.message}
          </div>
        ) : null}
        <iframe
          ref={iframeRef}
          title={displayTitle}
          className={cn('h-full w-full', !readerDocument && 'hidden')}
          // allow-scripts：否则 Chromium 会拦 contentDocument 上的 click 回调（语言 Tab / 复制失效）；正文仍经 DOMPurify 去 script
          sandbox="allow-same-origin allow-scripts"
        />
      </div>
    </PaneErrorBoundary>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReaderToolbarShell
        ready={ready}
        tocDisabled={units.length === 0}
        cardCount={marks.length}
        readAloudDisabled={true}
        readAloudDisabledReason="网页版语音朗读优化中，暂未开放"
        onTocToggle={toggleToc}
        onMarksToggle={toggleMarks}
        onAddBookmark={() => void addPageBookmark()}
        trailing={
          <>
            <ReaderTypographyControls disabled={!ready} />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isLoading || isFetching}
              onClick={handleReload}
              title="重新加载"
            >
              <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handleOpenInBrowser} title="在浏览器中打开">
              <ExternalLink className="size-4" />
            </Button>
            {(isLoading || isFetching) && !data ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : null}
          </>
        }
      />

      {/* 内框行：正文（含卡轨）与 AI 侧栏并列，同属左大块；底导航收进正文列 */}
      <div className="flex min-h-0 flex-1">
        <ReaderContentShell
          bookTitle={displayTitle}
        footerNav={
          <ReaderFooterNav ready={ready && units.length > 0} onPrevious={goPrevious} onNext={goNext} />
        }
        marksOpen={marksOpen}
        marks={marks}
        onSelectMark={handleSelectMark}
        onDeleteMark={(mark) => void handleDeleteMark(mark)}
        onCloseMarks={closeMarks}
        onExportNotes={handleExportNotes}
        onExportAnkiCards={handleExportAnkiCards}
        marksToc={tocFromWebUnits(units)}
        marksCurrentChapterKey={normalizedPageUrl}
        marksResolveChapter={resolveWebChapter}
        tocOpen={tocOpen}
        units={units}
        currentUnitId={currentUnitId}
        onCloseToc={closeToc}
        onSelectUnit={(unit) => navigateToUrl(unit.href)}
      >
        {readerHost}
        </ReaderContentShell>
        {dockedAgentVisible ? (
          <DockedAgentPane workspaceRoot={workspaceRoot} />
        ) : null}
      </div>

      {markTooltipPos && hoveredMark && !inspector.active ? (
        <EpubMarkTooltip mark={hoveredMark} x={markTooltipPos.x} y={markTooltipPos.y} />
      ) : null}

      {inspector.pos && inspector.active ? (
        <ReadingMarkPopover
          mark={inspector.active}
          stack={inspector.stack}
          x={inspector.pos.x}
          y={inspector.pos.y}
          onSelect={inspector.select}
          onChangeColor={(color) => {
            void updateMark({ id: inspector.active!.id, color })
          }}
          onEditNote={() => {
            setEditingNoteMark(inspector.active)
            setNoteDialogOpen(true)
            inspector.close()
          }}
          onDelete={() => {
            void handleDeleteMark(inspector.active!).then(() => inspector.close())
          }}
        />
      ) : null}

      {selectionToolbarPos && selectionSnapshot ? (
        <SelectionToolbar
          x={selectionToolbarPos.x}
          y={selectionToolbarPos.y}
          readOnly
          onCopy={selectionActions.handleCopy}
          hasSelectionForCopy={Boolean(selectionSnapshot?.text?.trim())}
          keyEventDocs={
            iframeRef.current?.contentDocument ? [iframeRef.current.contentDocument] : []
          }
          onAnnotate={selectionActions.handleAnnotate}
          onReadAloud={() => {
            if (selectionSnapshot?.text) {
              void useTtsStore.getState().playFromSnippet(selectionSnapshot.text)
              selectionActions.handleDismiss()
            }
          }}
          onHighlight={selectionActions.handleHighlight}
          onAddToChat={selectionActions.handleAddToChat}
          onAskAgent={selectionActions.handleAskAgent}
          onAskDeepAnswer={selectionActions.askDeepAnswer}
          deepAnswerPending={selectionActions.deepAnswerPending}
          onGenerateCardPreset={selectionActions.generateAiCard}
          cardPresetPending={selectionActions.aiCardPending}
          onDismiss={selectionActions.handleDismiss}
        />
      ) : null}

      <DeepAnswerDialog
        data={selectionActions.deepAnswer}
        pending={selectionActions.deepAnswerPending}
        onClose={selectionActions.dismissDeepAnswer}
        onRetry={selectionActions.retryDeepAnswer}
        onSaveAsNote={selectionActions.saveDeepAnswerAsNote}
      />

      <AnnotationNoteDialog
        open={noteDialogOpen}
        filePath={documentId}
        fileFingerprint={fileFingerprint}
        aiAssist
        excerpt={editingNoteMark?.excerpt ?? selectionSnapshot?.text}
        initialNote={editingNoteMark?.note ?? ''}
        title={editingNoteMark ? '编辑批注' : '添加批注'}
        onOpenChange={(open) => {
          setNoteDialogOpen(open)
          if (!open) {
            const wasEditing = Boolean(editingNoteMark)
            setEditingNoteMark(null)
            if (!wasEditing) clearTextSelection()
          }
        }}
        onSave={(note) => {
          if (editingNoteMark) {
            void updateMark({
              id: editingNoteMark.id,
              note,
              kind: editingNoteMark.kind === 'highlight' ? 'highlight' : 'note',
            }).then((result) => {
              if (isOk(result)) toast.success(note.trim() ? '已保存批注' : '已清除批注')
            })
            return
          }
          void handleSaveAnnotation(note)
        }}
      />
    </div>
  )
})
