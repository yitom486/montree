import { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { PaneErrorBoundary } from '@/components/shared/PaneErrorBoundary'
import { ReaderContentShell } from '@/components/reader/ReaderContentShell'
import { ReaderFooterNav } from '@/components/reader/ReaderFooterNav'
import { ReaderToolbarShell } from '@/components/reader/ReaderToolbarShell'
import { ReadingProgressRing } from '@/components/reader/ReadingProgressRing'
import { ReaderTypographyControls } from '@/components/reader/ReaderTypographyControls'
import { SelectionToolbar } from '@/components/reader/SelectionToolbar'
import { AnnotationNoteDialog } from '@/components/reader/AnnotationNoteDialog'
import { ReadingMarkPopover } from '@/components/reader/ReadingMarkPopover'
import { EpubMarkTooltip } from '@/components/reader/EpubMarkTooltip'
import { DeepAnswerDialog } from '@/components/reader/DeepAnswerDialog'
import { useIsDockedAgentVisible } from '@/components/agent/AgentPanel'
import { DockedAgentPane } from '@/components/agent/DockedAgentPane'
import { PdfBookSearch } from '@/components/reader/PdfBookSearch'
import { useReaderBinary } from '@/hooks/reader/useReaderBinary'
import { useReadingMarks } from '@/hooks/reader/useReadingMarks'
import { useReaderSidePanels } from '@/hooks/reader/useReaderSidePanels'
import { useReaderExportMenu } from '@/hooks/reader/useReaderExportMenu'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useReaderNavigationStore, useReaderNavTitles } from '@/stores/reader-navigation-store'
import { useTtsStore } from '@/stores/tts-store'
import { buildReadingFileFingerprint } from '@/lib/reader/adapter/reading-file-fingerprint'
import {
  findCurrentChapterRef,
  normalizeLoadKey,
  resolveEpubChapter,
  resolveMobiChapter,
  tocFromEpubUnits,
} from '@montree/reader-core'
import { isOk, type ReadingMark } from '@montree/contracts'
import { toast } from 'sonner'
import type { AppTheme } from '@/stores/editor-ui-store'
import type { FoliateViewElement } from '@foliate/view.js'
import type { FoliateBookAdapter } from '@/lib/reader/adapter/foliate-book-adapter'
import type { EpubChapter } from '@montree/reader-core'
import { useFoliateHighlights } from './foliate/useFoliateHighlights'
import { useFoliateInteractions } from './foliate/useFoliateInteractions'
import { useFoliateBookSession, type FoliateReaderEvents } from './foliate/useFoliateBookSession'

interface FoliateReaderViewerProps {
  filePath: string
  documentKind: 'epub' | 'mobi'
  theme: AppTheme
  /** 透传给内框 docked 侧栏，供 Agent 会话 cwd */
  workspaceRoot?: string
}

export function FoliateReaderViewer({
  filePath,
  documentKind,
  theme,
  workspaceRoot,
}: FoliateReaderViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dockedAgentVisible = useIsDockedAgentVisible()
  const { tocOpen, marksOpen, toggleToc, toggleMarks, closeToc, closeMarks } = useReaderSidePanels()
  const nav = useReaderNavigationStore((state) => state.nav)
  const readerFontSize = useAppSettingsStore((state) => state.readerFontSize)
  const readerLineHeight = useAppSettingsStore((state) => state.readerLineHeight)

  const { data, isLoading, error } = useReaderBinary(filePath)
  const { marks, createMark, updateMark, deleteMark } = useReadingMarks(filePath)

  const themeRef = useRef(theme)
  themeRef.current = theme
  const kindRef = useRef(documentKind)
  kindRef.current = documentKind
  const marksRef = useRef<ReadingMark[]>([])
  marksRef.current = marks

  const fileFingerprint = data
    ? buildReadingFileFingerprint(filePath, data.data.byteLength)
    : ''
  const isEpub = documentKind === 'epub'

  // 跨模块稳定共享引用
  const viewRef = useRef<FoliateViewElement | null>(null)
  const adapterRef = useRef<FoliateBookAdapter | null>(null)
  const chaptersRef = useRef<EpubChapter[]>([])
  const chapterSectionsRef = useRef<Array<number | null>>([])
  const lastLocationRef = useRef<{ cfi?: string; sectionIndex: number; fraction: number } | null>(null)
  const selectionSnapshotRef = useRef<{ text: string; cfiRange: string; rect: DOMRect } | null>(null)
  const editingNoteMarkRef = useRef<ReadingMark | null>(null)
  const eventsRef = useRef<FoliateReaderEvents>({})

  // 1. 阅读生命周期与会话（核心底座，优先初始化）
  const session = useFoliateBookSession({
    filePath,
    documentKind,
    data,
    error,
    containerRef,
    theme,
    readerFontSize,
    readerLineHeight,
    marksRef,
    viewRef,
    adapterRef,
    chaptersRef,
    chapterSectionsRef,
    lastLocationRef,
    eventsRef,
  })

  // 2. 高亮层、页边旗标、悬停联动与 TTS 标记
  const highlights = useFoliateHighlights({
    viewRef,
    marksRef,
    chaptersRef,
    chapterSectionsRef,
    themeRef,
    kindRef,
    ready: session.ready,
    marks,
    theme,
    readerFontSize,
    readerLineHeight,
    selectionSnapshotRef,
    editingNoteMarkRef,
  })

  // 3. 选区划词、浮层与标注动作
  const interactions = useFoliateInteractions({
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
    showPendingAnnotateHighlight: highlights.showPendingAnnotateHighlight,
    removePendingAnnotateHighlight: highlights.removePendingAnnotateHighlight,
    syncVisualMarks: highlights.syncVisualMarks,
    getRenderedDocs: session.getRenderedDocs,
    goToChapter: session.goToChapter,
    nav,
    selectionSnapshotRef,
    editingNoteMarkRef,
  })

  // 4. 事件委托镜像更新，彻底解耦生命周期 Effect 与上层交互
  eventsRef.current = {
    openInspectorAtRange: interactions.openInspectorAtRange,
    bindSectionDocInteractions: interactions.bindSectionDocInteractions,
    syncVisualMarks: highlights.syncVisualMarks,
    syncMarkHighlights: highlights.syncMarkHighlights,
    syncMarkFlags: highlights.syncMarkFlags,
    flashJumpRange: highlights.flashJumpRange,
    handleCreateMarkAt: interactions.handleCreateMarkAt,
    createBookmark: () => interactions.addBookmarkAtCurrent(),
    createNoteFromSelection: (note) => interactions.handleSaveAnnotation(note),
    onE2eSelectRange: (doc, range, cfiRange) => {
      interactions.inspector.close()
      const text = range.toString()
      const rect = range.getBoundingClientRect()
      const snapshot = { text, cfiRange, rect }
      interactions.setSelectionSnapshot(snapshot)
      if (interactions.selectionSnapshotRef) {
        interactions.selectionSnapshotRef.current = snapshot
      }
      const frame = doc.defaultView?.frameElement as HTMLElement | null
      const frameRect = frame?.getBoundingClientRect()
      interactions.setSelectionToolbarPos({
        x: (frameRect?.left ?? 0) + snapshot.rect.left + snapshot.rect.width / 2,
        y: (frameRect?.top ?? 0) + snapshot.rect.top,
      })
    },
  }

  const { currentUnitId } = useReaderNavTitles()
  const resolveChapter = isEpub ? resolveEpubChapter : resolveMobiChapter

  const { handleExportNotes, handleExportAnkiCards } = useReaderExportMenu({
    marks,
    filePath,
    getToc: () => tocFromEpubUnits(session.chapters),
    getCurrentChapter: (toc) =>
      findCurrentChapterRef(toc, currentUnitId ? normalizeLoadKey(currentUnitId) : ''),
    resolveChapter,
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReaderToolbarShell
        ready={session.ready}
        tocDisabled={session.chapters.length === 0}
        cardCount={marks.length}
        onTocToggle={toggleToc}
        onMarksToggle={toggleMarks}
        onAddBookmark={() => void interactions.addBookmarkAtCurrent()}
        trailing={
          <>
            <PdfBookSearch
              fingerprint={filePath}
              backend="memory"
              docKey={filePath}
              onJumpToLabel={session.handleJumpToLabel}
            />
            <ReaderTypographyControls disabled={!session.ready} />
            {session.ready ? (
              <div className="relative text-muted-foreground">
                <ReadingProgressRing progress={session.globalProgress} />
              </div>
            ) : null}
            {isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          </>
        }
      />

      {/* 内框行：正文（含卡轨）与 AI 侧栏并列，同属左大块；底导航收进正文列 */}
      <div className="flex min-h-0 flex-1">
        <ReaderContentShell
          filePath={filePath}
          marksOpen={marksOpen}
          marks={marks}
          onSelectMark={session.handleSelectMark}
          onDeleteMark={(mark) => void interactions.handleDeleteMark(mark)}
          onCloseMarks={closeMarks}
          onExportNotes={handleExportNotes}
          onExportAnkiCards={handleExportAnkiCards}
          marksToc={tocFromEpubUnits(session.chapters)}
          marksCurrentChapterKey={currentUnitId ? normalizeLoadKey(currentUnitId) : undefined}
          marksResolveChapter={resolveChapter}
          tocOpen={tocOpen}
          units={session.chapters}
          currentUnitId={currentUnitId}
          onCloseToc={closeToc}
          onSelectUnit={(unit) => {
            const index = session.chapters.findIndex(
              (item) => item.href === unit.href && item.label === unit.label,
            )
            session.goToChapter(unit, index >= 0 ? index : undefined)
          }}
          onHoverExcerpt={highlights.handleHoverExcerpt}
          readingFraction={session.globalProgress}
          footerNav={
            <ReaderFooterNav
              ready={session.ready}
              onPrevious={() => session.goToChapter(nav.previous, nav.previousIndex)}
              onNext={() => session.goToChapter(nav.next, nav.nextIndex)}
            />
          }
        >
          <PaneErrorBoundary name={isEpub ? 'EPUB 阅读' : 'MOBI 阅读'} filePath={filePath}>
            <div
              ref={containerRef}
              className="foliate-reader-host relative h-full min-h-0 overflow-hidden bg-[var(--color-bg-base)]"
              data-theme={theme}
            >
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  正在加载{isEpub ? ' EPUB' : ' MOBI'}…
                </div>
              )}
            </div>
          </PaneErrorBoundary>
        </ReaderContentShell>
        {dockedAgentVisible ? (
          <DockedAgentPane workspaceRoot={workspaceRoot} />
        ) : null}
      </div>

      {interactions.markTooltipPos && interactions.hoveredMark && !interactions.inspector.active ? (
        <EpubMarkTooltip
          mark={interactions.hoveredMark}
          x={interactions.markTooltipPos.x}
          y={interactions.markTooltipPos.y}
        />
      ) : null}

      {interactions.inspector.pos && interactions.inspector.active ? (
        <ReadingMarkPopover
          mark={interactions.inspector.active}
          stack={interactions.inspector.stack}
          x={interactions.inspector.pos.x}
          y={interactions.inspector.pos.y}
          onSelect={interactions.inspector.select}
          onChangeColor={(color) => {
            void updateMark({ id: interactions.inspector.active!.id, color }).then(() =>
              highlights.syncVisualMarks(),
            )
          }}
          onEditNote={() => {
            interactions.setEditingNoteMark(interactions.inspector.active)
            interactions.setNoteDialogOpen(true)
            interactions.inspector.close()
          }}
          onDelete={() => {
            void interactions.handleDeleteMark(interactions.inspector.active!).then(() =>
              interactions.inspector.close(),
            )
          }}
        />
      ) : null}

      {interactions.selectionToolbarPos && interactions.selectionSnapshot ? (
        <SelectionToolbar
          x={interactions.selectionToolbarPos.x}
          y={interactions.selectionToolbarPos.y}
          readOnly
          onCopy={interactions.selectionActions.handleCopy}
          hasSelectionForCopy={Boolean(interactions.selectionSnapshot?.text?.trim())}
          keyEventDocs={session.getRenderedDocs().map((item) => item.doc)}
          onAnnotate={interactions.selectionActions.handleAnnotate}
          onReadAloud={() => {
            if (interactions.selectionSnapshot?.text) {
              void useTtsStore.getState().playFromSnippet(interactions.selectionSnapshot.text)
              interactions.selectionActions.handleDismiss()
            }
          }}
          onHighlight={interactions.selectionActions.handleHighlight}
          onAddToChat={interactions.selectionActions.handleAddToChat}
          onAskAgent={interactions.selectionActions.handleAskAgent}
          onAskDeepAnswer={interactions.selectionActions.askDeepAnswer}
          deepAnswerPending={interactions.selectionActions.deepAnswerPending}
          onGenerateCardPreset={interactions.selectionActions.generateAiCard}
          cardPresetPending={interactions.selectionActions.aiCardPending}
          onDismiss={interactions.selectionActions.handleDismiss}
        />
      ) : null}

      <DeepAnswerDialog
        data={interactions.selectionActions.deepAnswer}
        pending={interactions.selectionActions.deepAnswerPending}
        onClose={interactions.selectionActions.dismissDeepAnswer}
        onRetry={interactions.selectionActions.retryDeepAnswer}
        onSaveAsNote={interactions.selectionActions.saveDeepAnswerAsNote}
      />

      <AnnotationNoteDialog
        open={interactions.noteDialogOpen}
        filePath={filePath}
        fileFingerprint={fileFingerprint}
        aiAssist
        excerpt={interactions.editingNoteMark?.excerpt ?? interactions.selectionSnapshot?.text}
        initialNote={interactions.editingNoteMark?.note ?? ''}
        title={interactions.editingNoteMark ? '编辑批注' : '添加批注'}
        onOpenChange={(open) => {
          interactions.setNoteDialogOpen(open)
          if (!open) {
            const wasEditing = Boolean(interactions.editingNoteMark)
            interactions.setEditingNoteMark(null)
            highlights.removePendingAnnotateHighlight()
            if (!wasEditing) interactions.clearTextSelection()
          }
        }}
        onSave={(note) => {
          if (interactions.editingNoteMark) {
            void updateMark({
              id: interactions.editingNoteMark.id,
              note,
              kind: interactions.editingNoteMark.kind === 'highlight' ? 'highlight' : 'note',
            }).then((result) => {
              if (isOk(result)) {
                toast.success(note.trim() ? '已保存批注' : '已清除批注')
                highlights.syncVisualMarks()
              }
            })
            return
          }
          void interactions.handleSaveAnnotation(note)
        }}
      />
    </div>
  )
}
