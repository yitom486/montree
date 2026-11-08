import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { ReadingMark, TextSelection } from '@yitom/contracts'
import { toChapterKey } from '@yitom/contracts'
import type { ReadingNotesChapterRef } from '@yitom/reader-core'
import { SelectionToolbar } from '@/components/reader/SelectionToolbar'
import { AnnotationNoteDialog } from '@/components/reader/AnnotationNoteDialog'
import { DeepAnswerDialog } from '@/components/reader/DeepAnswerDialog'
import { ReaderContentShell } from '@/components/reader/ReaderContentShell'
import { useMarkdownPreviewMarks } from '@/hooks/reader/useMarkdownPreviewMarks'
import { useReaderExportMenu } from '@/hooks/reader/useReaderExportMenu'
import type { MarkdownHeading } from '@/lib/editor/markdown-headings'
import type { AppTheme } from '@/stores/editor-ui-store'
import { useTtsStore } from '@/stores/tts-store'
import { toast } from 'sonner'

interface Props {
  filePath: string
  source: string
  html: string
  visible: boolean
  surfaceKey: string
  theme: AppTheme
  headings: MarkdownHeading[]
  activeHeadingId?: string
  getRoot: () => HTMLElement | null
  openPreview: () => void
  getSourceSelection: () => TextSelection | null
  onHeadingChange: (id: string | undefined) => void
}

export function MarkdownPreviewTools(props: Props) {
  const state = useMarkdownPreviewMarks(props)
  const toc = useMemo<ReadingNotesChapterRef[]>(() => [
    { key: 'document', matchKey: 'document', label: '正文', level: 1 },
    ...props.headings.map((heading) => ({ key: heading.id, matchKey: heading.id, label: heading.text, level: heading.level })),
  ], [props.headings])
  const resolveChapter = (mark: ReadingMark): ReadingNotesChapterRef => {
    const key = mark.chapter?.key || (mark.anchor.format === 'web' ? mark.anchor.headingId : undefined) || 'document'
    return toc.find((chapter) => chapter.key === key) ?? { key, matchKey: key, label: mark.chapter?.label || '原章节', level: 1 }
  }
  const exports = useReaderExportMenu({ marks: state.marks, filePath: props.filePath,
    getToc: () => toc, getCurrentChapter: () => toc.find((chapter) => chapter.key === props.activeHeadingId) ?? toc[0], resolveChapter })
  const notice = (mark: ReadingMark) => state.statuses[mark.id] === 'missing' ? '原文已变化，引用待重新关联'
    : state.statuses[mark.id] === 'ambiguous' ? '原文存在多处匹配，引用待确认' : undefined

  return <>
    <ReaderContentShell companionOnly filePath={props.filePath} marks={state.marks}
      onSelectMark={(mark) => void state.revealMark(mark)} onDeleteMark={(mark) => void state.deleteMark(mark.id)}
      onExportNotes={exports.handleExportNotes} onExportAnkiCards={exports.handleExportAnkiCards}
      marksToc={toc} marksCurrentChapterKey={toChapterKey(props.activeHeadingId || 'document')} marksResolveChapter={resolveChapter}
      markReferenceNotice={notice} tocOpen={false} units={[]} onCloseToc={() => undefined} onSelectUnit={() => undefined}>
      {null}
    </ReaderContentShell>
    {state.toolbar && state.snapshot && createPortal(<SelectionToolbar x={state.toolbar.x} y={state.toolbar.y}
      onCopy={state.actions.handleCopy} hasSelectionForCopy onAnnotate={state.actions.handleAnnotate}
      onHighlight={state.actions.handleHighlight} onAskAgent={state.actions.handleAskAgent}
      onAskDeepAnswer={state.actions.askDeepAnswer} deepAnswerPending={state.actions.deepAnswerPending}
      onGenerateCardPreset={state.actions.generateAiCard} cardPresetPending={state.actions.aiCardPending}
      onReadAloud={() => { void useTtsStore.getState().playText('Markdown 选段', state.snapshot!.text); state.actions.handleDismiss() }}
      onDismiss={state.actions.handleDismiss} />, document.body)}
    <AnnotationNoteDialog open={state.noteOpen} filePath={props.filePath} fileFingerprint={state.fingerprint}
      excerpt={state.snapshot?.text} onOpenChange={state.setNoteOpen} onSave={(note) => {
        void state.saveAnnotation(note).then(() => state.setNoteOpen(false)).catch((error) => toast.error(error.message))
      }} />
    <DeepAnswerDialog data={state.actions.deepAnswer} pending={state.actions.deepAnswerPending}
      onClose={state.actions.dismissDeepAnswer} onRetry={() => void state.actions.retryDeepAnswer()}
      onSaveAsNote={() => void state.actions.saveDeepAnswerAsNote()} />
  </>
}
