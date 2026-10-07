import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
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
import { useReaderSidePanels } from '@/hooks/reader/useReaderSidePanels'
import { useReaderExportMenu } from '@/hooks/reader/useReaderExportMenu'
import { useReadingMarks } from '@/hooks/reader/useReadingMarks'
import { appApi } from '@/api/app-api'
import { queryKeys } from '@/api/query-keys'
import { useTtsStore } from '@/stores/tts-store'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'
import type { EditorOutlineState } from '@/components/layout/main/EditorWorkspaceMain'
import { findWebDocFlatIndex, resolveWebChapter, tocFromWebUnits } from '@montree/reader-core'
import { reportAppError } from '@/lib/workspace/report-error'
import { cn } from '@/lib/utils'
import { isOk } from '@montree/contracts'
import { toast } from 'sonner'
import '@/styles/web-doc-viewer.css'
import type { AppTheme } from '@/stores/editor-ui-store'
import { useWebDocNavigation } from '@/components/reader/web-doc/useWebDocNavigation'
import { useWebDocInteractions } from '@/components/reader/web-doc/useWebDocInteractions'
import { useWebDocSession } from '@/components/reader/web-doc/useWebDocSession'

export interface WebDocViewerHandle {
  selectHeading: (heading: MarkdownHeading) => void
}

interface WebDocViewerProps {
  pageUrl: string
  theme: AppTheme
  onOutlineChange?: (state: EditorOutlineState) => void
  /** 透传给内框 docked 侧栏，供 Agent 会话 cwd */
  workspaceRoot?: string
}

export const WebDocViewer = forwardRef<WebDocViewerHandle, WebDocViewerProps>(
  function WebDocViewer({ pageUrl, theme, onOutlineChange, workspaceRoot }, ref) {
    const dockedAgentVisible = useIsDockedAgentVisible()
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const queryClient = useQueryClient()

    // 1. 导航与大纲能力
    const nav = useWebDocNavigation({
      pageUrl,
      iframeRef,
      onOutlineChange,
    })

    const {
      data,
      isLoading,
      isFetching,
      error,
      refetch,
      documentId,
      documentUrl,
      normalizedPageUrl,
      fileFingerprint,
      units,
      unitsRef,
      displayTitle,
      selectHeading,
      navigateToUrl,
      scrollToWebDocFragment,
      handleWebDocLink,
      goPrevious,
      goNext,
      persistScrollProgress,
      restoreScrollProgress,
      syncActiveHeadingFromScroll,
    } = nav

    useImperativeHandle(ref, () => ({ selectHeading }), [selectHeading])

    // 2. 阅读标记数据库响应
    const { marks, createMark, updateMark, deleteMark } = useReadingMarks(documentId)
    const marksRef = useRef(marks)
    marksRef.current = marks

    const syncWebMarkOverlaysRef = useRef<(doc: Document, url: string) => void>(() => {})

    // 3. 划选交互与批注弹窗
    const interactions = useWebDocInteractions({
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
      syncWebMarkOverlays: (doc, url) => syncWebMarkOverlaysRef.current(doc, url),
      navigateToUrl,
    })

    const {
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
      addPageBookmark,
      handleSaveAnnotation,
      handleCreateMarkAt,
      handleDeleteMark,
      selectionActions,
    } = interactions

    // 4. iframe 会话生命周期与系统级注册
    const session = useWebDocSession({
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
    })

    syncWebMarkOverlaysRef.current = session.syncWebMarkOverlays

    const { ready, readerDocument, handleSelectMark } = session
    const { tocOpen, marksOpen, toggleToc, toggleMarks, closeToc, closeMarks } = useReaderSidePanels()

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
        <div
          className={cn('web-doc-viewer-host relative h-full min-h-0 bg-[var(--color-bg-base)]', `theme-${theme}`)}
          data-theme={theme}
        >
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
          {dockedAgentVisible ? <DockedAgentPane workspaceRoot={workspaceRoot} /> : null}
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
            keyEventDocs={iframeRef.current?.contentDocument ? [iframeRef.current.contentDocument] : []}
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
  },
)
