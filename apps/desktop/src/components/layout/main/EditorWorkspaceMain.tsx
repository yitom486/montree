import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  Suspense,
  lazy,
} from 'react'
import { Loader2 } from 'lucide-react'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { useDefaultLayout } from 'react-resizable-panels'
import { FileBreadcrumb } from '@/components/layout/panels/FileBreadcrumb'
import { WelcomePage } from '@/components/layout/main/WelcomePage'
import { ViewModeToggle } from '@/components/layout/main/ViewModeToggle'
import { EditorModeToggle } from '@/components/layout/main/EditorModeToggle'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '@/components/editor/MarkdownEditor'
import { FindReplaceBar } from '@/components/editor/FindReplaceBar'
import { PreviewPane, type PreviewPaneHandle } from '@/components/preview/PreviewPane'
import { PaneErrorBoundary } from '@/components/shared/PaneErrorBoundary'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useScrollSync } from '@/hooks/editor/useScrollSync'
import type { TextDocument } from '@/lib/editor/text-document'
import { useDocumentReader } from '@/hooks/agent/useDocumentReader'
import { EditorView } from '@codemirror/view'
import { findExcerptOffsets, findTextRangeInRoot } from '@/lib/reader/marks/excerpt-text-match'

function TextDataReaderContext({ filePath, content, kind, root }: { filePath: string; content: string; kind: string; root: () => HTMLElement | null }) {
  useDocumentReader({ filePath, root, text: () => content,
    units: () => {
      if (kind === 'json') {
        try {
          const parsed: unknown = JSON.parse(content)
          if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([key, value]) => ({ label: `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, text: JSON.stringify(value, null, 2) }))
        } catch { /* 无效 JSON 仍可读取源码和搜索。 */ }
      }
      const lines = content.split('\n')
      return Array.from({ length: Math.max(1, Math.ceil(lines.length / 200)) }, (_, i) => ({ label: `第 ${i * 200 + 1}–${Math.min(lines.length, (i + 1) * 200)} 行`, text: lines.slice(i * 200, (i + 1) * 200).map((line, j) => `${i * 200 + j + 1}: ${line}`).join('\n') }))
    } })
  return null
}
import { useMarkdownPreview } from '@/hooks/editor/useMarkdownPreview'
import { usePasteImage } from '@/hooks/editor/usePasteImage'
import {
  findActiveHeading,
  parseMarkdownHeadings,
  type MarkdownHeading,
} from '@/lib/editor/markdown-headings'
import { useEditorUiStore, useFileUiState, type EditorViewMode } from '@/stores/editor-ui-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { getDocumentKind, getFileExtension, type FileTreeNode } from '@yitom/contracts'
import { flattenFileTree } from '@/lib/workspace/quick-open'
import { ProposalReviewLayout } from '@/components/editor/ai-proposals/ProposalReviewBar'
import type { WikilinkCandidate } from '@/lib/editor/wikilink-completion'
const JsonTreeViewer = lazy(() =>
  import('@/components/data/JsonTreeViewer').then((m) => ({ default: m.JsonTreeViewer })),
)
const LogStreamViewer = lazy(() =>
  import('@/components/data/LogStreamViewer').then((m) => ({ default: m.LogStreamViewer })),
)
const DocxViewer = lazy(() =>
  import('@/components/office/DocxViewer').then((m) => ({ default: m.DocxViewer })),
)
const SpreadsheetViewer = lazy(() =>
  import('@/components/office/SpreadsheetViewer').then((m) => ({ default: m.SpreadsheetViewer })),
)
const PptxViewer = lazy(() =>
  import('@/components/office/PptxViewer').then((m) => ({ default: m.PptxViewer })),
)
const HtmlViewer = lazy(() =>
  import('@/components/html/HtmlViewer').then((m) => ({ default: m.HtmlViewer })),
)
const TypstWorkspace = lazy(() =>
  import('@/components/typst/TypstWorkspace').then((m) => ({ default: m.TypstWorkspace })),
)

export interface EditorWorkspaceMainHandle {
  navigateToUnit: (index: number, excerpt?: string) => Promise<boolean>
  selectHeading: (heading: MarkdownHeading) => void
  openFind: () => void
  openReplace: () => void
}

export interface EditorOutlineState {
  headings: MarkdownHeading[]
  activeHeadingId?: string
}

interface EditorWorkspaceMainProps {
  textDocument?: TextDocument
  filePath?: string
  isDirty: boolean
  content: string
  workspaceRoot?: string
  recentFiles: string[]
  recentWebUrls?: string[]
  fileTree?: FileTreeNode[]
  onOpenWikilink?: (target: string) => void
  onOpenDeepLink?: (url: string) => void
  onContentChange: (value: string) => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onOpenRecentFile: (path: string) => void
  onOpenTypstFile?: (path: string, line?: number, character?: number) => void
  onOpenWebDoc: (url: string) => void
  onOutlineChange?: (state: EditorOutlineState) => void
  /**
   * P1 外部修改冲突横幅（dirty 时磁盘被外部改写）：重载丢弃 buffer，
   * 覆盖用磁盘版本显式写入；关闭仅推迟处理，下次保存继续拒绝。
   */
  externalConflict?: { fileName: string } | null
  onReloadDisk?: () => void
  onOverwriteDisk?: () => void
  onDismissConflict?: () => void
}

export const EditorWorkspaceMain = forwardRef<
  EditorWorkspaceMainHandle,
  EditorWorkspaceMainProps
>(function EditorWorkspaceMain(
  {
    filePath,
    textDocument,
    isDirty,
    content,
    workspaceRoot,
    recentFiles,
    recentWebUrls,
    fileTree,
    onOpenWikilink,
    onOpenDeepLink,
    onContentChange,
    onOpenFile,
    onOpenFolder,
    onOpenRecentFile,
    onOpenTypstFile,
    onOpenWebDoc,
    onOutlineChange,
    externalConflict,
    onReloadDisk,
    onOverwriteDisk,
    onDismissConflict,
  },
  ref,
) {
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const documentRef = useRef(textDocument)
  documentRef.current = textDocument
  const previewRef = useRef<PreviewPaneHandle>(null)
  const fileState = useFileUiState(filePath)
  const setViewMode = useEditorUiStore((state) => state.setViewMode)
  const theme = useEditorUiStore((state) => state.theme)
  const previewDebounceMs = useAppSettingsStore((state) => state.previewDebounceMs)
  const tabSize = useAppSettingsStore((state) => state.tabSize)
  const editorFontSize = useAppSettingsStore((state) => state.editorFontSize)
  const markdownEditorMode = useAppSettingsStore((state) => state.markdownEditorMode)
  const setMarkdownEditorMode = useAppSettingsStore((state) => state.setMarkdownEditorMode)
  const toggleMarkdownEditorMode = useAppSettingsStore((state) => state.toggleMarkdownEditorMode)

  const viewMode = fileState.viewMode
  const previewHtml = useMarkdownPreview(filePath && getDocumentKind(filePath) !== 'markdown' ? '' : content, filePath, previewDebounceMs)
  const { handlePasteImage } = usePasteImage(filePath)
  const headings = useMemo(() => {
    if (filePath && getDocumentKind(filePath) !== 'markdown') return []
    try {
      return parseMarkdownHeadings(content)
    } catch (error) {
      reportRuntimeError(error, { source: 'outline', filePath, silentToast: true })
      return []
    }
  }, [content, filePath])
  useEffect(() => {
    if (!textDocument || getDocumentKind(textDocument.filePath) !== 'markdown') return
    textDocument.previewUnitIndex = () => {
      const activeId = previewRef.current?.getActiveHeadingId()
      const heading = headings.find((item) => item.id === activeId)
      const offset = heading ? textDocument.state.doc.line(Math.min(textDocument.state.doc.lines, heading.line + 1)).from : 0
      return Math.max(0, textDocument.units().findLastIndex((unit) => unit.from <= offset))
    }
    return () => { textDocument.previewUnitIndex = undefined }
  }, [textDocument, headings])
  const [activeHeadingId, setActiveHeadingId] = useState<string>()
  const [findReplace, setFindReplace] = useState<{ open: boolean; mode: 'find' | 'replace' }>({
    open: false,
    mode: 'find',
  })

  const showEditor = Boolean(filePath) && (viewMode === 'editor' || viewMode === 'split')
  const showPreview = Boolean(filePath) && (viewMode === 'preview' || viewMode === 'split')
  const showWelcome = !filePath

  const contentPanelIds = useMemo(() => {
    if (showEditor && showPreview) return ['editor', 'preview']
    if (showEditor) return ['editor']
    return ['preview-full']
  }, [showEditor, showPreview])

  const contentLayout = useDefaultLayout({
    id: `markdown-editor-content-${viewMode}`,
    panelIds: contentPanelIds,
  })

  const updateActiveHeading = useCallback(() => {
    const visibleLine = editorRef.current?.getTopVisibleLine() ?? 0
    const active = findActiveHeading(headings, visibleLine)
    setActiveHeadingId(active?.id)
  }, [headings])

  const { onEditorScroll, onPreviewScroll, jumpToHeading } = useScrollSync({
    filePath,
    viewMode,
    previewHtml,
    editorRef,
    previewRef,
  })

  const handleEditorScroll = useCallback(() => {
    onEditorScroll()
    if (viewMode !== 'preview') {
      updateActiveHeading()
    }
  }, [onEditorScroll, updateActiveHeading, viewMode])

  const updateActiveHeadingFromPreview = useCallback(() => {
    const activeId = previewRef.current?.getActiveHeadingId()
    if (activeId) {
      setActiveHeadingId(activeId)
    }
  }, [])

  const handlePreviewScroll = useCallback(() => {
    onPreviewScroll()
    if (viewMode !== 'editor') {
      updateActiveHeadingFromPreview()
    }
  }, [onPreviewScroll, updateActiveHeadingFromPreview, viewMode])

  const handlePreviewHeadingActivate = useCallback(
    (headingId: string) => {
      setActiveHeadingId(headingId)
      const heading = headings.find((item) => item.id === headingId)
      if (!heading || viewMode === 'preview') return
      editorRef.current?.scrollToLine(heading.line)
    },
    [headings, viewMode],
  )

  const handleSelectHeading = useCallback(
    (heading: MarkdownHeading) => {
      jumpToHeading(heading)
      setActiveHeadingId(heading.id)
    },
    [jumpToHeading],
  )

  const getWikilinkCandidates = useCallback((): WikilinkCandidate[] => {
    if (!fileTree || fileTree.length === 0) return []
    const items = flattenFileTree(fileTree, workspaceRoot)
    return items.map((item) => ({
      name: item.name,
      path: item.relativePath || item.name,
      kind: item.documentKind,
    }))
  }, [fileTree, workspaceRoot])

  useImperativeHandle(
    ref,
    () => ({
      navigateToUnit: async (index, excerpt) => {
        const doc = textDocument
        const unit = doc?.units()[index]
        if (!doc || !unit || documentRef.current !== doc) return false
        const revision = doc.revision
        const heading = headings.find((item) => doc.state.doc.line(item.line + 1).from === unit.from)
        if (heading) handleSelectHeading(heading)
        else {
          editorRef.current?.scrollToLine(doc.state.doc.lineAt(unit.from).number)
          previewRef.current?.setScrollRatio(0)
        }
        if (viewMode !== 'preview') {
          const view = editorRef.current?.getView()
          if (!view) return false
          const source = doc.text.slice(unit.from, unit.to)
          const matched = excerpt ? findExcerptOffsets(source, excerpt) : null
          if (excerpt && !matched) return false
          const from = unit.from + (matched?.from ?? 0)
          const to = unit.from + (matched?.to ?? 0)
          view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        if (documentRef.current !== doc || doc.revision !== revision) return false
        if (viewMode === 'preview' && excerpt) {
          const root = previewRef.current?.getScrollElement()
          if (!root) return false
          const start = heading ? root.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`) : root.firstElementChild
          let target: Element | null = start
          let range: Range | null = null
          while (target) {
            if (target !== start && /^H[1-6]$/.test(target.tagName) && Number(target.tagName[1]) <= unit.level) break
            range = findTextRangeInRoot(target as HTMLElement, excerpt)
            if (range) break
            target = target.nextElementSibling
          }
          if (!range) return false
          const selection = root.ownerDocument.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          const block = range.startContainer.parentElement
          if (block) {
            root.scrollTop += block.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientHeight / 3
          }
        }
        return true
      },
      selectHeading: handleSelectHeading,
      openFind: () => setFindReplace({ open: true, mode: 'find' }),
      openReplace: () => setFindReplace({ open: true, mode: 'replace' }),
    }),
    [handleSelectHeading, textDocument, headings, viewMode],
  )

  useEffect(() => {
    onOutlineChange?.({ headings, activeHeadingId })
  }, [activeHeadingId, headings, onOutlineChange])

  useEffect(() => {
    if (viewMode === 'preview' && previewHtml) {
      requestAnimationFrame(() => {
        updateActiveHeadingFromPreview()
      })
    }
  }, [previewHtml, updateActiveHeadingFromPreview, viewMode])

  useEffect(() => {
    if (viewMode !== 'preview') {
      updateActiveHeading()
    }
  }, [headings, updateActiveHeading, viewMode])

  const documentKind = filePath ? getDocumentKind(filePath) : 'markdown'
  // TXT shares Markdown's file routing, but should not receive Markdown preview decorations.
  const isMarkdown = documentKind === 'markdown' && (!filePath || getFileExtension(filePath) !== '.txt')
  const dataRoot = useRef<HTMLElement>(null)

  useEffect(() => {
    setMarkdownEditorMode('live-preview')
  }, [filePath, setMarkdownEditorMode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return

      const key = event.key.toLowerCase()
      const code = event.code

      if (key === 'f' || code === 'KeyF') {
        if (filePath && getDocumentKind(filePath) === 'typst') return
        if (filePath) {
          event.preventDefault()
          setFindReplace({ open: true, mode: 'find' })
        }
        return
      }
      if (key === 'h' || code === 'KeyH') {
        if (filePath && getDocumentKind(filePath) === 'typst') return
        if (filePath) {
          event.preventDefault()
          setFindReplace({ open: true, mode: 'replace' })
        }
        return
      }

      if (key === '/' || code === 'Slash') {
        if (filePath && isMarkdown) {
          event.preventDefault()
          toggleMarkdownEditorMode()
          if (viewMode === 'preview') setViewMode(filePath, 'editor')
        }
        return
      }

      if (!filePath) return

      const shortcuts: Record<string, EditorViewMode> = {
        '1': 'editor',
        '2': 'split',
        '3': 'preview',
      }
      const nextMode = shortcuts[event.key]
      if (!nextMode) return

      event.preventDefault()
      setViewMode(filePath, nextMode)
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [filePath, setViewMode, isMarkdown, viewMode, toggleMarkdownEditorMode])

  const isTextData = documentKind === 'json' || documentKind === 'log'
  const isDataOrOfficeDoc =
    documentKind === 'csv' ||
    documentKind === 'tsv' ||
    documentKind === 'json' ||
    documentKind === 'log' ||
    documentKind === 'docx' ||
    documentKind === 'xlsx' ||
    documentKind === 'pptx' ||
    documentKind === 'html'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileBreadcrumb
        filePath={filePath}
        workspaceRoot={workspaceRoot}
        isDirty={isDirty}
        welcome={showWelcome}
        trailing={
          showWelcome || isDataOrOfficeDoc ? undefined : (
            <div className="flex items-center gap-1.5">
              {isMarkdown && (
                <EditorModeToggle
                  mode={markdownEditorMode}
                  onChange={(mode) => {
                    setMarkdownEditorMode(mode)
                    if (!showEditor) setViewMode(filePath, 'editor')
                  }}
                />
              )}
              <ViewModeToggle mode={viewMode} onChange={(mode) => setViewMode(filePath, mode)} />
            </div>
          )
        }
      />

      {externalConflict ? (
        <div
          role="alert"
          data-testid="external-change-banner"
          className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200"
        >
          <span className="min-w-0 flex-1 truncate">
            {externalConflict.fileName} 在磁盘上被外部修改，未保存内容已保留。普通保存会继续拒绝覆盖。
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-0.5 font-medium hover:bg-amber-500/20"
            onClick={() => onReloadDisk?.()}
          >
            重载磁盘版
          </button>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-0.5 font-medium hover:bg-amber-500/20"
            onClick={() => onOverwriteDisk?.()}
          >
            覆盖磁盘版
          </button>
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 opacity-70 hover:opacity-100"
            aria-label="稍后处理"
            onClick={() => onDismissConflict?.()}
          >
            ✕
          </button>
        </div>
      ) : null}

      <main ref={dataRoot} data-reader-viewport className="min-h-0 flex-1 bg-editor flex flex-col overflow-hidden">
        {isTextData && filePath && <TextDataReaderContext filePath={filePath} content={content} kind={documentKind} root={() => dataRoot.current} />}
        {showWelcome ? (
          <WelcomePage
            recentFiles={recentFiles}
            recentWebUrls={recentWebUrls}
            workspaceRoot={workspaceRoot}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
            onOpenRecentFile={onOpenRecentFile}
            onOpenWebDoc={onOpenWebDoc}
          />
        ) : documentKind === 'typst' && filePath ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin" aria-label="正在加载 Typst 编辑器" /></div>}>
            <TypstWorkspace filePath={filePath} textDocument={textDocument} content={content}
              onContentChange={onContentChange} workspaceRoot={workspaceRoot} viewMode={viewMode}
              onOpenFile={onOpenTypstFile} />
          </Suspense>
        ) : documentKind === 'html' && filePath ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载 HTML 视图…</div>}>
            <HtmlViewer filePath={filePath} content={content} onChange={onContentChange} />
          </Suspense>
        ) : documentKind === 'docx' && filePath ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载 DOCX 视图…</div>}>
            <DocxViewer filePath={filePath} />
          </Suspense>
        ) : documentKind === 'xlsx' && filePath ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载表格视图…</div>}>
            <SpreadsheetViewer filePath={filePath} />
          </Suspense>
        ) : documentKind === 'pptx' && filePath ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载幻灯片视图…</div>}>
            <PptxViewer filePath={filePath} />
          </Suspense>
        ) : documentKind === 'csv' || documentKind === 'tsv' ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载表格视图…</div>}>
            <SpreadsheetViewer filePath={filePath} content={content} onChange={onContentChange} />
          </Suspense>
        ) : documentKind === 'json' ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载 JSON 视图…</div>}>
            <JsonTreeViewer content={content} onChange={onContentChange} />
          </Suspense>
        ) : documentKind === 'log' ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载日志视图…</div>}>
            <LogStreamViewer content={content} onChange={onContentChange} />
          </Suspense>
        ) : (
          <ProposalReviewLayout document={textDocument}>
          <ResizablePanelGroup
            id={`markdown-editor-content-${viewMode}`}
            orientation="horizontal"
            defaultLayout={contentLayout.defaultLayout}
            onLayoutChanged={contentLayout.onLayoutChanged}
            className="h-full min-h-0"
          >
            {showEditor && (
              <ResizablePanel
                id="editor"
                defaultSize={showPreview ? '50%' : '100%'}
                minSize={showPreview ? '28%' : '100%'}
                className="min-w-0"
              >
                <div className="relative h-full min-h-0">
                  <FindReplaceBar
                    open={findReplace.open}
                    mode={findReplace.mode}
                    editorView={editorRef.current?.getView() ?? null}
                    onClose={() => setFindReplace((state) => ({ ...state, open: false }))}
                  />
                  <PaneErrorBoundary name="编辑器" filePath={filePath}>
                    <MarkdownEditor
                      ref={editorRef}
                      value={content}
                      textDocument={textDocument}
                      filePath={filePath}
                      theme={theme}
                      tabSize={tabSize}
                      fontSize={editorFontSize}
                      livePreview={isMarkdown && markdownEditorMode === 'live-preview'}
                      onChange={onContentChange}
                      onScroll={handleEditorScroll}
                      onPasteImage={handlePasteImage}
                      getWikilinkCandidates={getWikilinkCandidates}
                    />
                  </PaneErrorBoundary>
                </div>
              </ResizablePanel>
            )}

            {showEditor && showPreview && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel id="preview" defaultSize="50%" minSize="28%" className="min-w-0">
                  <PaneErrorBoundary name="预览" filePath={filePath}>
                    <PreviewPane
                      ref={previewRef}
                      html={previewHtml}
                      theme={theme}
                      onScroll={handlePreviewScroll}
                      onHeadingActivate={handlePreviewHeadingActivate}
                      onOpenWikilink={onOpenWikilink}
                      onOpenDeepLink={onOpenDeepLink}
                    />
                  </PaneErrorBoundary>
                </ResizablePanel>
              </>
            )}

            {!showEditor && showPreview && (
              <ResizablePanel id="preview-full" defaultSize="100%" className="min-w-0">
                <PaneErrorBoundary name="预览" filePath={filePath}>
                  <PreviewPane
                    ref={previewRef}
                    html={previewHtml}
                    theme={theme}
                    onScroll={handlePreviewScroll}
                    onHeadingActivate={handlePreviewHeadingActivate}
                    onOpenWikilink={onOpenWikilink}
                    onOpenDeepLink={onOpenDeepLink}
                  />
                </PaneErrorBoundary>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
          </ProposalReviewLayout>
        )}
      </main>
    </div>
  )
})
