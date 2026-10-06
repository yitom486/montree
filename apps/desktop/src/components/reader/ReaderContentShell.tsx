import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ReadingMarkPanel } from '@/components/reader/ReadingMarkPanel'
import { ReaderUnitOutline } from '@/components/reader/ReaderUnitOutline'
import { MarginaliaBar } from '@/components/reader/MarginaliaBar'
import { FlashcardReviewDialog } from '@/components/reader/FlashcardReviewDialog'
import { AiQuizDialog } from '@/components/quiz/AiQuizDialog'
import { QuizHistoryDialog } from '@/components/quiz/QuizHistoryDialog'
import { buildAnkiCardsExport } from '@/lib/reader/marks/export-anki-cards'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { preserveScrollAnchor } from '@/lib/reader/scroll-anchor'
import type { Flashcard } from '@montree/annotations'
import type { FlashcardReviewRating } from '@montree/annotations'
import { flashcardsApi } from '@/api/flashcards-api'
import { sortCardsByDueOrder } from '@/lib/reader/marks/review-order'
import type { ReaderUnit } from '@montree/reader-core'
import {
  findCurrentChapterRef,
  normalizeLoadKey,
  type ReadingNotesChapterRef,
  type ReadingNotesContentKind,
  type ReadingNotesScope,
} from '@montree/reader-core'
import { passageExcerpt } from '@montree/reader-core'
import type { ReadingMark } from '@montree/contracts'
import { isOk, toChapterKey } from '@montree/contracts'
import { readingMarksApi } from '@/api/reading-marks-api'
import { narrowChapterScopeMarks } from '@/lib/reader/marks/chapter-scope'
import { parseDiagramFromMark } from '@/lib/reader/marks/diagram-mark-parser'
import type { DiagramVisualStep } from '@/components/agent/tools/DiagramViewerCard'
import { toast } from 'sonner'

interface ReaderContentShellProps {
  filePath?: string
  bookTitle?: string
  marksOpen: boolean
  marks: ReadingMark[]
  onSelectMark: (mark: ReadingMark) => void
  onDeleteMark: (mark: ReadingMark) => void
  onCloseMarks: () => void
  onExportNotes?: (contentKind: ReadingNotesContentKind, scope: ReadingNotesScope) => void
  onExportAnkiCards?: (scope: ReadingNotesScope) => void
  marksToc?: ReadingNotesChapterRef[]
  marksCurrentChapterKey?: string
  marksResolveChapter?: (
    mark: ReadingMark,
    toc: ReadingNotesChapterRef[],
  ) => ReadingNotesChapterRef
  tocOpen: boolean
  units: ReaderUnit[]
  currentUnitId?: string
  onCloseToc: () => void
  onSelectUnit: (unit: ReaderUnit) => void
  onEditToc?: () => void
  outlineNotice?: string
  tocAside?: ReactNode
  children: ReactNode
  /** 卡片悬停时透出原文 excerpt（EPUB 用 CSS 高亮 API 照亮正文，PDF 画布暂不支持） */
  onHoverExcerpt?: (excerpt: string | undefined) => void
  /** 正文书级阅读进度 0~1：卡片轨等比跟随滚动；缺省不同滚 */
  readingFraction?: number
  /** 底栏翻页：收进正文列（正文下方），不横跨卡片轨；缺省无底栏 */
  footerNav?: ReactNode
}

export function ReaderContentShell({
  filePath,
  bookTitle,
  marksOpen,
  marks,
  onSelectMark,
  onDeleteMark,
  onCloseMarks,
  onExportNotes,
  onExportAnkiCards,
  marksToc,
  marksCurrentChapterKey,
  marksResolveChapter,
  tocOpen,
  units,
  currentUnitId,
  onCloseToc,
  onSelectUnit,
  onEditToc,
  outlineNotice,
  tocAside,
  children,
  onHoverExcerpt,
  readingFraction,
  /** 底栏翻页：收进正文列（正文下方），不横跨卡片轨；缺省无底栏 */
  footerNav,
}: ReaderContentShellProps) {
  // 知识卡轨与伴读联动状态
  const isCardRailOpen = useReaderHudUiStore((s) => s.isCardRailOpen)
  const setIsCardRailOpen = useReaderHudUiStore((s) => s.setIsCardRailOpen)
  const hudDisplayMode = useAcpUiStore((s) => s.hudDisplayMode)
  const panelOpen = useAcpUiStore((s) => s.panelOpen)
  const zenMode = useReaderHudUiStore((s) => s.zenMode)
  const setSelectedDiagram = useReaderHudUiStore((s) => s.setSelectedDiagram)
  const openPanelAndFocusComposer = useAcpUiStore((s) => s.openPanelAndFocusComposer)

  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({})

  const handleToggleCardCollapse = (id: string) => {
    setCollapsedMap((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleToggleAllCollapse = (collapse: boolean) => {
    const next: Record<string, boolean> = {}
    for (const m of marks) {
      next[m.id] = collapse
    }
    setCollapsedMap(next)
  }

  const enhancedMarks = marks.map((m) => ({
    ...m,
    collapsed: collapsedMap[m.id] ?? m.collapsed,
  }))

  // 目录键序：卡片按文档位置排序用（纵序对齐正文）。
  // 必须与 chapterOfMark 返回值同 key 空间（固化 key 恒为 matchKey 形态），
  // 取 toc.key（带 index 前缀）会导致分组恒 miss——见 sortMarksByDocumentPosition 约定。
  const chapterOrder = useMemo(
    () => marksToc?.map((t) => toChapterKey(normalizeLoadKey(t.matchKey || t.key))) ?? [],
    [marksToc],
  )

  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewCards, setReviewCards] = useState<Flashcard[]>([])

  const [quizOpen, setQuizOpen] = useState(false)
  const [quizHistoryOpen, setQuizHistoryOpen] = useState(false)
  const [quizPassage, setQuizPassage] = useState('')
  const [quizChapterTitle, setQuizChapterTitle] = useState<string | undefined>()
  const [quizMarkId, setQuizMarkId] = useState<string | undefined>()

  const displayTitle =
    bookTitle ||
    (filePath ? filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') : undefined) ||
    '当前书籍'

  const handleReviewFlashcards = async (scope: ReadingNotesScope) => {
    const toc = marksToc ?? []
    const currentChapter = findCurrentChapterRef(toc, marksCurrentChapterKey)
    const resolveChapter =
      marksResolveChapter ??
      ((mark: ReadingMark): ReadingNotesChapterRef => ({
        key: mark.id,
        matchKey: mark.id,
        label: '书本划线',
        level: 1,
      }))

    // 本章 scope 走 chapter_key 索引（[3]）；窄化规则见 chapter-scope，
    // IPC 失败回落内存过滤（今日行为）。已窄化后按全书走，避免二次过滤。
    let scopedMarks = marks
    let preNarrowed = false
    if (scope === 'chapter' && currentChapter && filePath) {
      const chapterKeys = [currentChapter.key, currentChapter.matchKey].filter(Boolean)
      try {
        const result = await readingMarksApi.listByChapter({ filePath, chapterKeys })
        if (isOk(result)) {
          scopedMarks = narrowChapterScopeMarks({
            candidates: result.value,
            chapterKeys,
            toc,
            current: currentChapter,
            resolveChapter,
          })
          preNarrowed = true
        }
      } catch {
        // 回落内存过滤
      }
    }

    const exportResult = buildAnkiCardsExport({
      marks: scopedMarks,
      bookTitle: displayTitle,
      scope: preNarrowed ? 'book' : scope,
      currentChapter: preNarrowed ? null : scope === 'chapter' ? currentChapter : null,
      toc,
      resolveChapter,
    })

    if (!exportResult || exportResult.cards.length === 0) {
      toast.info(
        scope === 'chapter'
          ? '当前章节暂无重点划线或批注卡片'
          : '当前选定范围内暂无重点划线或批注卡片',
      )
      return
    }

    // 待复习排序（UI批）：due id 顺序 ∩ 派生卡；不在 due 中的新卡缀尾（不静默丢失）；
    // IPC 失败回落派生顺序（今日行为）。
    setReviewCards(sortCardsByDueOrder(exportResult.cards, await fetchDueOrder()))
    setReviewOpen(true)
  }

  /** 拉本书待复习顺序；失败返回 null（调用方回落派生顺序） */
  const fetchDueOrder = async (): Promise<string[] | null> => {
    if (!filePath) return null
    try {
      const result = await flashcardsApi.listDue({ filePath, limit: 200 })
      if (!isOk(result)) return null
      return result.value.map((card) => card.id)
    } catch {
      return null
    }
  }

  /** 评分落盘（UI批）：失败 toast 但不打断复习流（Dialog 本地态照常推进） */
  const handlePersistRating = useCallback(
    (cardId: string, rating: FlashcardReviewRating) => {
      if (!filePath) return
      void (async () => {
        try {
          const result = await flashcardsApi.appendReview({ filePath, cardId, rating })
          if (!isOk(result)) {
            toast.error('评分未能存入本地，复习进度可能丢失')
          }
        } catch {
          toast.error('评分未能存入本地，复习进度可能丢失')
        }
      })()
    },
    [filePath],
  )

  const handleNavigateToMark = (markId: string) => {
    const mark = marks.find((m) => m.id === markId)
    if (mark) {
      onSelectMark(mark)
    }
  }

  const handleOpenQuiz = async (mark?: ReadingMark, scope?: 'mark' | 'chapter' | 'book') => {
    if (scope === 'chapter') {
      let chapterLabel = '当前章节'
      // 本章 scope 走 chapter_key 索引（[3]）；失败回落内存过滤（今日行为）
      let candidates = marks
      const toc = marksToc ?? []
      const currentChapter = findCurrentChapterRef(toc, marksCurrentChapterKey)
      if (currentChapter && filePath && marksResolveChapter) {
        const chapterKeys = [currentChapter.key, currentChapter.matchKey].filter(Boolean)
        try {
          const result = await readingMarksApi.listByChapter({ filePath, chapterKeys })
          if (isOk(result)) {
            candidates = narrowChapterScopeMarks({
              candidates: result.value,
              chapterKeys,
              toc,
              current: currentChapter,
              resolveChapter: marksResolveChapter,
            })
          } else {
            candidates = marks
          }
        } catch {
          candidates = marks
        }
      }
      const inChapterScope =
        candidates !== marks
          ? () => true
          : (m: ReadingMark) => {
              if (marksToc && marksResolveChapter && marksCurrentChapterKey) {
                const ch = marksResolveChapter(m, marksToc)
                return ch.key === marksCurrentChapterKey || ch.matchKey === marksCurrentChapterKey
              }
              return true
            }
      const targetMarks = candidates.filter((m) => {
        if (passageExcerpt(m).trim().length === 0) return false
        return inChapterScope(m)
      })
      const combinedExcerpt = targetMarks.map((m) => passageExcerpt(m).trim()).join('\n\n')
      if (!combinedExcerpt) {
        toast.info('当前章节暂无重点划线')
        return
      }
      if (marksToc && marksResolveChapter && targetMarks[0]) {
        chapterLabel = marksResolveChapter(targetMarks[0], marksToc).label
      }
      setQuizPassage(combinedExcerpt)
      setQuizChapterTitle(`${chapterLabel} · 本章重点综合测`)
      setQuizMarkId(undefined)
      setQuizOpen(true)
      return
    }

    const targetMark = mark ?? marks.find((m) => passageExcerpt(m).trim().length > 0)
    const excerpt = targetMark ? passageExcerpt(targetMark).trim() : ''
    if (!targetMark || !excerpt) {
      toast.info('请先在书籍中划选重点，再让 AI 针对该段出题')
      return
    }

    let chapterLabel = '当前章节'
    if (marksToc && marksResolveChapter) {
      chapterLabel = marksResolveChapter(targetMark, marksToc).label
    }

    setQuizPassage(excerpt)
    setQuizChapterTitle(chapterLabel)
    setQuizMarkId(targetMark.id)
    setQuizOpen(true)
  }

  const handleRetryQuestion = (passage: string, chapterTitle?: string, markId?: string) => {
    setQuizPassage(passage)
    setQuizChapterTitle(chapterTitle)
    setQuizMarkId(markId)
    setQuizOpen(true)
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {marksOpen ? (
        <ReadingMarkPanel
          marks={marks}
          onSelect={onSelectMark}
          onDelete={onDeleteMark}
          onClose={onCloseMarks}
          onExportNotes={onExportNotes}
          onExportAnkiCards={onExportAnkiCards}
          onReviewFlashcards={handleReviewFlashcards}
          onOpenQuiz={handleOpenQuiz}
          onOpenQuizHistory={() => setQuizHistoryOpen(true)}
          onQuizMark={handleOpenQuiz}
          marksToc={marksToc}
          currentChapterKey={marksCurrentChapterKey}
          resolveChapter={marksResolveChapter}
        />
      ) : null}
      {tocOpen && tocAside ? tocAside : null}
      {tocOpen && !tocAside && units.length > 0 ? (
        <aside className="flex w-[min(28%,320px)] min-w-[180px] shrink-0 flex-col border-r border-border/60">
          <ReaderUnitOutline
            units={units}
            currentUnitId={currentUnitId}
            onToggle={onCloseToc}
            onSelectUnit={onSelectUnit}
            onEditToc={onEditToc}
            outlineNotice={outlineNotice}
          />
        </aside>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        {footerNav}
      </div>

      {isCardRailOpen ? (
        <MarginaliaBar
          marks={enhancedMarks}
          onMarkClick={onSelectMark}
          onHoverAnchor={onHoverExcerpt}
          chapterOfMark={(m) => {
            // 优先读写入时固化的章节归属；老数据缺字段时回落运行时解析。
            // 回落 key 同样归一化到固化 key 空间（与 currentChapterKey/排序同构）。
            if (m.chapter) return { key: m.chapter.key, label: m.chapter.label }
            if (!(marksToc && marksResolveChapter)) return null
            try {
              const ref = marksResolveChapter(m, marksToc)
              return { key: toChapterKey(normalizeLoadKey(ref.matchKey)), label: ref.label }
            } catch {
              return null
            }
          }}
          currentChapterKey={marksCurrentChapterKey}
          chapterOrder={chapterOrder}
          readingFraction={readingFraction}
          onDeleteMark={(id) => {
            const m = marks.find((item) => item.id === id)
            if (m) onDeleteMark(m)
          }}
          onOpenDiagram={(diagramId) => {
            const m = marks.find(
              (item) => item.diagramId === diagramId || item.id === diagramId,
            )
            if (m) {
              const parsed = parseDiagramFromMark(m)
              if (parsed) {
                setSelectedDiagram(parsed)
                return
              }
            }

            const fallbackSteps: DiagramVisualStep[] =
              m?.keyPoints && m.keyPoints.length > 0
                ? m.keyPoints.map((kp, idx) => ({
                    from: `阶段 ${idx + 1}`,
                    to: `推演 ${idx + 2}`,
                    action: kp,
                    desc: kp,
                  }))
                : [
                    {
                      from: '概念源起',
                      to: '核心脉络',
                      action: '提炼核心概念',
                      desc: m?.excerpt ?? '概念正文解构',
                    },
                    {
                      from: '核心脉络',
                      to: '认知图景',
                      action: '多维穿透解析',
                      desc: m?.aiSummary ?? '时序流转分析',
                    },
                  ]

            setSelectedDiagram({
              diagramId,
              diagramType: 'sequence',
              title: m?.title ?? '时序流转交互图谱',
              mermaidCode: 'sequenceDiagram\n  autonumber\n  Reader->>AI: 提出概念追问\n  AI-->>Reader: 返回分步交互图解',
              summary: m?.aiSummary ?? m?.excerpt,
              visualSteps: fallbackSteps,
            })
          }}
          onToggleCardCollapse={handleToggleCardCollapse}
          onToggleAllCollapse={handleToggleAllCollapse}
          onCloseRail={() => preserveScrollAnchor(() => setIsCardRailOpen(false))}
          onGenerateAiCard={() => openPanelAndFocusComposer()}
          className="h-full"
        />
      ) : null}

      <FlashcardReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        cards={reviewCards}
        bookTitle={displayTitle}
        onNavigateToMark={handleNavigateToMark}
        onRate={handlePersistRating}
      />

      <AiQuizDialog
        open={quizOpen}
        onOpenChange={setQuizOpen}
        passage={quizPassage}
        bookTitle={displayTitle}
        filePath={filePath || ''}
        chapterTitle={quizChapterTitle}
        markId={quizMarkId}
        onNavigateToMark={handleNavigateToMark}
        onOpenHistory={() => setQuizHistoryOpen(true)}
      />

      <QuizHistoryDialog
        open={quizHistoryOpen}
        onOpenChange={setQuizHistoryOpen}
        bookTitle={displayTitle}
        filePath={filePath || ''}
        onNavigateToMark={handleNavigateToMark}
        onRetryQuestion={handleRetryQuestion}
      />
    </div>
  )
}
