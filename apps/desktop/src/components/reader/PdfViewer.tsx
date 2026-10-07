import { useCallback, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, ScanText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PaneErrorBoundary } from '@/components/shared/PaneErrorBoundary'
import { AnnotationNoteDialog } from '@/components/reader/AnnotationNoteDialog'
import { EpubMarkTooltip } from '@/components/reader/EpubMarkTooltip'
import { PdfPageView } from '@/components/reader/PdfPageView'
import { ReaderContentShell } from '@/components/reader/ReaderContentShell'
import { ReaderFooterNav } from '@/components/reader/ReaderFooterNav'
import { ReaderToolbarShell } from '@/components/reader/ReaderToolbarShell'
import { useIsDockedAgentVisible } from '@/components/agent/AgentPanel'
import { DockedAgentPane } from '@/components/agent/DockedAgentPane'
import { ReadingMarkPopover } from '@/components/reader/ReadingMarkPopover'
import { SelectionToolbar } from '@/components/reader/SelectionToolbar'
import { DeepAnswerDialog } from '@/components/reader/DeepAnswerDialog'
import { useReaderBinary } from '@/hooks/reader/useReaderBinary'
import { useReadingMarkInspector } from '@/hooks/reader/useReadingMarkInspector'
import { useReadingMarks } from '@/hooks/reader/useReadingMarks'
import { usePdfPageOcr } from '@/hooks/reader/usePdfPageOcr'
import { useReaderExportMenu } from '@/hooks/reader/useReaderExportMenu'
import { useTtsStore } from '@/stores/tts-store'
import { buildReadingFileFingerprint } from '@/lib/reader/adapter/reading-file-fingerprint'
import { resolvePdfChapter } from '@montree/reader-core'
import { shouldRenderPdfPage } from '@/lib/reader/pdf/pdf-render'
import { TocDocLifecycle } from '@/lib/reader/pdf-ocr/ocr-toc-op'
import type { OcrTocNotice } from '@/lib/reader/pdf-ocr/ocr-toc-notice'
import { PdfOcrBanner } from '@/components/reader/PdfOcrBanner'
import { PdfOcrTocEditor } from '@/components/reader/PdfOcrTocEditor'
import { PdfBookSearch } from '@/components/reader/PdfBookSearch'
import { PdfToolbarMoreMenu } from '@/components/reader/PdfToolbarMoreMenu'
import { BodyWatermarkPreviewDialog } from '@/components/reader/BodyWatermarkPreviewDialog'
import { TocAiPolishControl } from '@/components/reader/TocAiPolishControl'
import { useReaderNavigationStore, useReaderNavTitles } from '@/stores/reader-navigation-store'
import { isOk } from '@montree/contracts'
import { toast } from 'sonner'
import type { AppTheme } from '@/stores/editor-ui-store'
import '@/styles/pdf-viewer.css'

import { usePdfDocumentSession } from '@/components/reader/pdf/usePdfDocumentSession'
import { usePdfOcrTocManager } from '@/components/reader/pdf/usePdfOcrTocManager'
import { usePdfInteractions } from '@/components/reader/pdf/usePdfInteractions'

interface PdfViewerProps {
  filePath: string
  theme: AppTheme
  /** 透传给内框 docked 侧栏，供 Agent 会话 cwd */
  workspaceRoot?: string
}

export function PdfViewer({ filePath, theme, workspaceRoot }: PdfViewerProps) {
  const dockedAgentVisible = useIsDockedAgentVisible()
  const containerRef = useRef<HTMLDivElement>(null)
  const pageAnchorRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const tocLifecycleRef = useRef<TocDocLifecycle | null>(null)
  if (tocLifecycleRef.current === null) {
    tocLifecycleRef.current = new TocDocLifecycle()
  }

  const { data, isLoading } = useReaderBinary(filePath)
  const fileFingerprint = useMemo(
    () => (data ? buildReadingFileFingerprint(filePath, data.data.byteLength) : ''),
    [data, filePath],
  )

  const [ocrTocNotice, setOcrTocNotice] = useState<OcrTocNotice | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [marksOpen, setMarksOpen] = useState(false)

  // 1. PDF 页面级 OCR
  const pdfDocHolderRef = useRef<any>(null)
  const pdfPageOcr = usePdfPageOcr({
    filePath,
    fileFingerprint,
    pageNum: 1,
    pdfDocRef: pdfDocHolderRef,
    isScannedPdf: false,
    isMixedPdf: false,
    importRunning: false,
    getPageSizePt: useCallback(async (page: number) => {
      const pdf = pdfDocHolderRef.current
      if (!pdf) return null
      try {
        const proxy = await pdf.getPage(page)
        const viewport = proxy.getViewport({ scale: 1 })
        if (!(viewport.width > 0) || !(viewport.height > 0)) return null
        return { width: viewport.width, height: viewport.height }
      } catch {
        return null
      }
    }, []),
  })

  // 跨模块调用解耦引用
  const handleOpenOcrTocEditorRef = useRef<() => void>(() => {})
  const handleClearOcrCacheRef = useRef<() => Promise<void>>(async () => {})
  const ocrTocEntriesRef = useRef<any[]>([])
  const tocPageOffsetRef = useRef<number>(12)

  // 2. PDF 文档渲染会话
  const session = usePdfDocumentSession({
    filePath,
    fileFingerprint,
    data,
    containerRef,
    pageAnchorRefs,
    tocLifecycleRef,
    pdfPageOcr,
    setOcrBannerDismissed: (val) => ocrTocManager.setOcrBannerDismissed(val),
    setBookmarkSlimDismissed: (val) => ocrTocManager.setBookmarkSlimDismissed(val),
    setOcrTocEditorOpen: (val) => ocrTocManager.setOcrTocEditorOpen(val),
    setOcrTocEditMode: (val) => ocrTocManager.setOcrTocEditMode(val),
    setOcrTocEntries: (entries) => ocrTocManager.setOcrTocEntries(entries),
    setOcrTocNotice,
    setTocPageFrom: (page) => ocrTocManager.setTocPageFrom(page),
    setTocPageTo: (page) => ocrTocManager.setTocPageTo(page),
    setTocPageOffset: (offset) => ocrTocManager.setTocPageOffset(offset),
    setTocOpen,
    ocrTocEntries: ocrTocEntriesRef.current,
    tocPageOffset: tocPageOffsetRef.current,
    handleOpenOcrTocEditor: () => handleOpenOcrTocEditorRef.current(),
    handleClearOcrCache: () => handleClearOcrCacheRef.current(),
  })

  pdfDocHolderRef.current = session.pdfDoc

  // 3. OCR 目录管理器
  const ocrTocManager = usePdfOcrTocManager({
    filePath,
    fileFingerprint,
    numPages: session.numPages,
    pdfDocRef: session.pdfDocRef,
    outlineUnits: session.outlineUnits,
    outlineSource: session.outlineSource,
    isScannedPdf: session.isScannedPdf,
    isMixedPdf: session.isMixedPdf,
    rosettaImportRunning: session.rosettaImport.state === 'running',
    tocLifecycleRef,
    readPageText: pdfPageOcr.readPageText,
    resetPageOcr: pdfPageOcr.resetPageOcr,
    setOutlineUnits: session.setOutlineUnits,
    setOutlineSource: session.setOutlineSource,
    setOutlineNotice: session.setOutlineNotice,
    setTocOpen,
    ocrTocNotice,
    setOcrTocNotice,
  })

  handleOpenOcrTocEditorRef.current = ocrTocManager.handleOpenOcrTocEditor
  handleClearOcrCacheRef.current = ocrTocManager.handleClearOcrCache
  ocrTocEntriesRef.current = ocrTocManager.ocrTocEntries
  tocPageOffsetRef.current = ocrTocManager.tocPageOffset

  // 4. 阅读标注与批注
  const { marks, createMark, updateMark, deleteMark } = useReadingMarks(filePath)
  const inspector = useReadingMarkInspector(marks)

  const interactions = usePdfInteractions({
    filePath,
    fileFingerprint,
    numPages: session.numPages,
    pageNum: session.pageNum,
    pageNumRef: session.pageNumRef,
    pdfDocRef: session.pdfDocRef,
    pageAnchorRefs,
    marks,
    marksToc: session.marksToc,
    outlineUnits: session.outlineUnits,
    inspector,
    createMark,
    updateMark,
    deleteMark,
    jumpToPage: session.jumpToPage,
    goToFlatIndex: session.goToFlatIndex,
  })

  const {
    selectionSnapshot,
    selectionToolbarPos,
    noteDialogOpen,
    setNoteDialogOpen,
    editingNoteMark,
    setEditingNoteMark,
    hoveredMark,
    markTooltipPos,
    pointerOriginRef,
    clearTextSelection,
    handlePageMouseUp,
    addPageBookmark,
    handleSaveAnnotation,
    selectionActions,
    handleSelectMark,
    handleDeleteMark,
    handlePdfMarkHoverMove,
    handlePdfMarkHoverLeave,
  } = interactions

  const { currentUnitId } = useReaderNavTitles()
  const nav = useReaderNavigationStore((state) => state.nav)

  const { handleExportNotes, handleExportAnkiCards } = useReaderExportMenu({
    marks,
    filePath,
    getToc: () => session.marksToc,
    getCurrentChapter: () => session.currentPdfChapter,
    resolveChapter: resolvePdfChapter,
  })

  const estimatedPageHeight = Math.max(120, session.scaledPageSize.height)
  const estimatedPageWidth = Math.max(120, session.scaledPageSize.width)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {ocrTocManager.showOcrBanner ? (
        <PdfOcrBanner
          mode={
            ocrTocManager.ocrRecognizing
              ? 'recognizing'
              : ocrTocManager.ocrTocEditorOpen
                ? 're-recognize-toc'
                : session.isScannedPdf
                  ? 'scanned-no-outline'
                  : 'mixed-no-outline'
          }
          tocPageFrom={ocrTocManager.tocPageFrom}
          tocPageTo={ocrTocManager.tocPageTo}
          tocPageOffset={ocrTocManager.tocPageOffset}
          onTocPageFromChange={ocrTocManager.handleTocPageFromChange}
          onTocPageToChange={ocrTocManager.handleTocPageToChange}
          onTocPageOffsetChange={ocrTocManager.setTocPageOffset}
          onSuggestOffset={() => void ocrTocManager.handleSuggestOffset()}
          suggestingOffset={ocrTocManager.suggestingOffset}
          onDetectTocPages={() => void ocrTocManager.handleDetectTocPages()}
          detectingTocPages={ocrTocManager.tocDetecting}
          busy={ocrTocManager.ocrTocBusy}
          detectFeedback={ocrTocManager.tocDetectFeedback}
          onSelectDetectCandidate={ocrTocManager.handleSelectDetectCandidate}
          onRecognize={() => void ocrTocManager.handleRecognizeToc()}
          onDismiss={() => {
            ocrTocManager.setOcrTocEditorOpen(false)
            ocrTocManager.setOcrBannerDismissed(true)
          }}
          entryCount={session.outlineSource === 'ocr' ? session.outlineUnits.length : undefined}
          extraActions={
            ocrTocManager.placedOcrTocNotice.bannerExtra ? (
              <span className="text-xs text-amber-900/80 dark:text-amber-100/80">
                {ocrTocManager.placedOcrTocNotice.bannerExtra}
              </span>
            ) : undefined
          }
        />
      ) : null}

      {ocrTocManager.placedOcrTocNotice.statusBar ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-950 dark:text-amber-100">
          <ScanText className="size-3.5 shrink-0 opacity-80" aria-hidden />
          <span className="min-w-0 flex-1">{ocrTocManager.placedOcrTocNotice.statusBar.message}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => ocrTocManager.handleOpenOcrTocEditor()}
          >
            校正目录
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            disabled={ocrTocManager.ocrTocBusy || session.rosettaImport.state === 'running'}
            onClick={() => void ocrTocManager.handleRecognizeToc()}
          >
            重新识别
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="shrink-0"
            aria-label="关闭提示"
            onClick={() => setOcrTocNotice(null)}
          >
            <X />
          </Button>
        </div>
      ) : null}

      {session.outlineSource === 'embedded' &&
      ocrTocManager.ocrTocAvailable &&
      !ocrTocManager.bookmarkSlimDismissed &&
      !ocrTocManager.showOcrBanner ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">正在使用 PDF 自带书签，可改为识别印刷目录（保存后以自建目录为准）</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            disabled={ocrTocManager.ocrTocBusy || session.rosettaImport.state === 'running'}
            onClick={() => ocrTocManager.setOcrTocEditorOpen(true)}
          >
            识别印刷目录
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="shrink-0"
            aria-label="关闭提示"
            onClick={() => ocrTocManager.setBookmarkSlimDismissed(true)}
          >
            <X />
          </Button>
        </div>
      ) : null}

      <ReaderToolbarShell
        ready={session.ready}
        tocDisabled={!session.hasChapterToc}
        cardCount={marks.length}
        readAloudDisabled={session.isScannedPdf}
        readAloudDisabledReason="当前文档为图片扫描件，暂不支持语音朗读"
        onTocToggle={() => {
          setMarksOpen(false)
          setTocOpen((value) => !value)
        }}
        onMarksToggle={() => {
          setTocOpen(false)
          setMarksOpen((value) => !value)
        }}
        onAddBookmark={() => void addPageBookmark()}
        center={
          <>
            <Button variant="ghost" size="icon-sm" disabled={session.pageNum <= 1} onClick={session.goPrev}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-24 text-center text-sm text-muted-foreground">
              {session.numPages > 0 ? `${session.pageNum} / ${session.numPages}` : '—'}
            </span>
            <Button variant="ghost" size="icon-sm" disabled={session.pageNum >= session.numPages} onClick={session.goNext}>
              <ChevronRight className="size-4" />
            </Button>
          </>
        }
        trailing={
          <>
            {session.rosettaExtraAction}
            {fileFingerprint ? (
              <PdfBookSearch
                fingerprint={fileFingerprint}
                indexed={Boolean(session.rosettaImport.info)}
                onJumpToPage={(page) => session.jumpToPage(page)}
              />
            ) : null}
            <PdfToolbarMoreMenu items={session.moreMenuItems} />
            {isLoading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : session.isScannedPdf ? (
              <span className="text-xs text-muted-foreground">
                {pdfPageOcr.currentPageOcrBusy
                  ? `识别中… · ${pdfPageOcr.ocrRecognizedCount}/${session.numPages}`
                  : pdfPageOcr.currentPageOcrReady
                    ? `已识别 ${pdfPageOcr.ocrRecognizedCount}/${session.numPages}`
                    : `本页未识别 · ${pdfPageOcr.ocrRecognizedCount}/${session.numPages}`}
              </span>
            ) : null}
          </>
        }
      />

      {/* 内框行：正文与 AI 侧栏 */}
      <div className="flex min-h-0 flex-1">
        <ReaderContentShell
          filePath={filePath}
          readingFraction={session.numPages > 1 ? (session.pageNum - 1) / (session.numPages - 1) : 0}
          footerNav={
            <ReaderFooterNav
              ready={session.ready}
              onPrevious={() => nav.previousIndex >= 0 && session.goToFlatIndex(nav.previousIndex)}
              onNext={() => nav.nextIndex >= 0 && session.goToFlatIndex(nav.nextIndex)}
            />
          }
          marksOpen={marksOpen}
          marks={marks}
          onSelectMark={handleSelectMark}
          onDeleteMark={(mark) => void handleDeleteMark(mark)}
          onCloseMarks={() => setMarksOpen(false)}
          onExportNotes={handleExportNotes}
          onExportAnkiCards={handleExportAnkiCards}
          marksToc={session.marksToc}
          marksCurrentChapterKey={session.currentPdfChapter.matchKey ?? session.currentPdfChapter.key}
          marksResolveChapter={resolvePdfChapter}
          tocOpen={tocOpen}
          units={session.outlineUnits}
          currentUnitId={currentUnitId ?? String(session.pageNum)}
          onCloseToc={() => setTocOpen(false)}
          onSelectUnit={(unit) => {
            session.goToUnit(unit)
            setTocOpen(false)
          }}
          onEditToc={session.outlineSource === 'ocr' ? ocrTocManager.handleOpenOcrTocEditor : undefined}
          outlineNotice={session.outlineSource === 'ocr' ? undefined : session.outlineNotice}
          tocAside={
            ocrTocManager.ocrTocEditMode && session.outlineSource === 'ocr' ? (
              <PdfOcrTocEditor
                entries={ocrTocManager.ocrTocEntries}
                pageOffset={ocrTocManager.tocPageOffset}
                saving={ocrTocManager.ocrTocSaving}
                busy={ocrTocManager.ocrTocBusy}
                onToggle={() => setTocOpen(false)}
                onSave={(entries) => void ocrTocManager.handleSaveOcrToc(entries)}
                onCancel={() => ocrTocManager.setOcrTocEditMode(false)}
                aiControl={
                  <TocAiPolishControl
                    getOcrText={ocrTocManager.getTocOcrText}
                    getPageImages={ocrTocManager.getTocPageImages}
                    fileFingerprint={fileFingerprint}
                    baselineEntries={ocrTocManager.ocrTocEntries}
                    pageCount={session.numPages}
                    pageOffset={ocrTocManager.tocPageOffset}
                    onApply={(entries) => ocrTocManager.setOcrTocEntries(entries)}
                  />
                }
              />
            ) : undefined
          }
        >
          <div
            ref={containerRef}
            className="h-full min-h-0 overflow-auto bg-[var(--color-bg-base)]"
            onMouseMove={handlePdfMarkHoverMove}
            onMouseLeave={handlePdfMarkHoverLeave}
          >
            <PaneErrorBoundary name="PDF 阅读" filePath={filePath}>
              {isLoading || !session.pdfDoc ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  正在加载 PDF…
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-full flex-col items-center gap-4 px-4 py-4">
                  {session.pageNumbers.map((page) => {
                    const active = shouldRenderPdfPage(page, session.pageNum, session.numPages)
                    return (
                      <div
                        key={page}
                        ref={(node) => {
                          if (node) pageAnchorRefs.current.set(page, node)
                          else pageAnchorRefs.current.delete(page)
                        }}
                        className="w-fit max-w-full"
                        style={{
                          minHeight: estimatedPageHeight,
                          minWidth: estimatedPageWidth,
                        }}
                        data-page={page}
                      >
                        {active ? (
                          <PdfPageView
                            pdf={session.pdfDoc!}
                            pageNumber={page}
                            scale={session.scale}
                            theme={theme}
                            marks={marks}
                            ocrPageCache={pdfPageOcr.ocrPageCaches[page] ?? null}
                            onWordLayerMissing={session.handleWordLayerMissing}
                            transientSelection={
                              selectionSnapshot?.page === page ? selectionSnapshot : null
                            }
                            onMouseUp={handlePageMouseUp}
                            onPointerOrigin={(x, y) => {
                              pointerOriginRef.current = { x, y }
                            }}
                          />
                        ) : (
                          <div
                            className="rounded-sm bg-white/80 shadow-md dark:bg-zinc-800/80"
                            style={{
                              width: estimatedPageWidth,
                              height: estimatedPageHeight,
                            }}
                            aria-hidden
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </PaneErrorBoundary>
          </div>
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
        filePath={filePath}
        fileFingerprint={fileFingerprint}
        aiAssist
        excerpt={editingNoteMark?.excerpt ?? selectionSnapshot?.text}
        initialNote={editingNoteMark?.note ?? ''}
        title={editingNoteMark ? '编辑批注' : '添加批注'}
        onOpenChange={(open) => {
          setNoteDialogOpen(open)
          if (!open) {
            setEditingNoteMark(null)
            if (!editingNoteMark) {
              const selection = window.getSelection()
              if (!selection || selection.isCollapsed || !selection.toString().trim()) {
                clearTextSelection()
              }
            }
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
              else toast.error(result.error.message || '更新批注失败')
            })
            return
          }
          void handleSaveAnnotation(note)
            .then(() => {
              setNoteDialogOpen(false)
            })
            .catch((cause) => {
              toast.error(cause instanceof Error ? cause.message : '保存批注失败')
            })
        }}
      />
      <BodyWatermarkPreviewDialog
        open={session.bodyWatermarkPreviewOpen}
        fingerprint={fileFingerprint}
        onOpenChange={session.setBodyWatermarkPreviewOpen}
      />
    </div>
  )
}
