import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { useDefaultLayout } from 'react-resizable-panels'
import { FileBreadcrumb } from '@/components/layout/panels/FileBreadcrumb'
import { WelcomePage } from '@/components/layout/main/WelcomePage'
import { ViewModeToggle } from '@/components/layout/main/ViewModeToggle'
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
import { registerSelectionProvider } from '@/lib/agent/context/reader-selection-registry'
import { useMarkdownPreview } from '@/hooks/editor/useMarkdownPreview'
import { usePasteImage } from '@/hooks/editor/usePasteImage'
import {
  findActiveHeading,
  parseMarkdownHeadings,
  type MarkdownHeading,
} from '@/lib/editor/markdown-headings'
import { useEditorUiStore, useFileUiState, type EditorViewMode } from '@/stores/editor-ui-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import type { FileTreeNode } from '@montree/contracts'
import { flattenFileTree } from '@/lib/workspace/quick-open'
import type { WikilinkCandidate } from '@/lib/editor/wikilink-completion'

export interface EditorWorkspaceMainHandle {
  selectHeading: (heading: MarkdownHeading) => void
  openFind: () => void
  openReplace: () => void
}

export interface EditorOutlineState {
  headings: MarkdownHeading[]
  activeHeadingId?: string
}

interface EditorWorkspaceMainProps {
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
  onOpenWebDoc: (url: string) => void
  onOutlineChange?: (state: EditorOutlineState) => void
}

export const EditorWorkspaceMain = forwardRef<
  EditorWorkspaceMainHandle,
  EditorWorkspaceMainProps
>(function EditorWorkspaceMain(
  {
    filePath,
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
    onOpenWebDoc,
    onOutlineChange,
  },
  ref,
) {
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const previewRef = useRef<PreviewPaneHandle>(null)
  const fileState = useFileUiState(filePath)
  const setViewMode = useEditorUiStore((state) => state.setViewMode)
  const theme = useEditorUiStore((state) => state.theme)
  const previewDebounceMs = useAppSettingsStore((state) => state.previewDebounceMs)
  const tabSize = useAppSettingsStore((state) => state.tabSize)
  const editorFontSize = useAppSettingsStore((state) => state.editorFontSize)

  useEffect(() => {
    if (!filePath) return
    return registerSelectionProvider({
      filePath,
      getSelectionText: () => editorRef.current?.getSelectionText() ?? null,
    })
  }, [filePath])

  const viewMode = fileState.viewMode
  const previewHtml = useMarkdownPreview(content, filePath, previewDebounceMs)
  const { handlePasteImage } = usePasteImage(filePath)
  const headings = useMemo(() => {
    try {
      return parseMarkdownHeadings(content)
    } catch (error) {
      reportRuntimeError(error, { source: 'outline', filePath, silentToast: true })
      return []
    }
  }, [content, filePath])
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
      selectHeading: handleSelectHeading,
      openFind: () => setFindReplace({ open: true, mode: 'find' }),
      openReplace: () => setFindReplace({ open: true, mode: 'replace' }),
    }),
    [handleSelectHeading],
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return

      const key = event.key.toLowerCase()
      const code = event.code

      if (key === 'f' || code === 'KeyF') {
        if (filePath) {
          event.preventDefault()
          setFindReplace({ open: true, mode: 'find' })
        }
        return
      }
      if (key === 'h' || code === 'KeyH') {
        if (filePath) {
          event.preventDefault()
          setFindReplace({ open: true, mode: 'replace' })
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
  }, [filePath, setViewMode])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileBreadcrumb
        filePath={filePath}
        isDirty={isDirty}
        welcome={showWelcome}
        trailing={
          showWelcome ? undefined : (
            <ViewModeToggle mode={viewMode} onChange={(mode) => setViewMode(filePath, mode)} />
          )
        }
      />

      <main className="min-h-0 flex-1 bg-editor">
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
        ) : (
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
                      filePath={filePath}
                      theme={theme}
                      tabSize={tabSize}
                      fontSize={editorFontSize}
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
        )}
      </main>
    </div>
  )
})
