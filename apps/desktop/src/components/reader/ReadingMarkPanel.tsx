import { useEffect, useMemo, useState } from 'react'
import { Bookmark, BookOpen, ChevronDown, ChevronRight, Download, Highlighter, History, MessageSquare, RotateCcw, Sparkles, Target, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resetQuizSession } from '@/lib/quiz/quiz-acp-session'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ReadingMark } from '@montree/contracts'
import {
  groupMarksByChapter,
  type ReadingNotesChapterRef,
  type ReadingNotesContentKind,
  type ReadingNotesScope,
} from '@montree/reader-core'
import { isHighlightPassage, passageExcerpt } from '@montree/reader-core'
import { getReadingMarkDisplayKind, getReadingMarkLabel, getReadingMarkStatusLabel } from '@montree/reader-core'
import { highlightSwatch } from '@montree/reader-core'
import { useReadingMarkKindFilters } from '@/stores/reading-mark-panel-store'
import { markMatchesKindFilters } from '@montree/reader-core'
import { cn } from '@/lib/utils'

function MarkKindIcon({ kind }: { kind: ReadingMark['kind'] }) {
  switch (kind) {
    case 'bookmark':
      return <Bookmark className="size-3.5 shrink-0" />
    case 'highlight':
      return <Highlighter className="size-3.5 shrink-0" />
    case 'note':
      return <MessageSquare className="size-3.5 shrink-0" />
  }
}

const FILTER_ITEMS = [
  { key: 'highlights' as const, label: '重点' },
  { key: 'notes' as const, label: '批注' },
  { key: 'bookmarks' as const, label: '书签' },
]

function KindFilterChip({
  label,
  pressed,
  onPressedChange,
}: {
  label: string
  pressed: boolean
  onPressedChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[10px]',
        pressed ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
      )}
      onClick={() => onPressedChange(!pressed)}
    >
      {label}
    </button>
  )
}

const CONTENT_KIND_ITEMS: Array<{ kind: ReadingNotesContentKind; label: string }> = [
  { kind: 'notes', label: '批注' },
  { kind: 'highlights', label: '重点' },
  { kind: 'combined', label: '综合' },
]

const SCOPE_ITEMS: Array<{ scope: ReadingNotesScope; label: string }> = [
  { scope: 'chapter', label: '本章' },
  { scope: 'book', label: '全书' },
]

function MarkListItem({
  mark,
  onSelect,
  onDelete,
  onQuiz,
}: {
  mark: ReadingMark
  onSelect: (mark: ReadingMark) => void
  onDelete: (mark: ReadingMark) => void
  onQuiz?: (mark: ReadingMark) => void
}) {
  const displayKind = getReadingMarkDisplayKind(mark)
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/40"
        onClick={() => onSelect(mark)}
      >
        <MarkKindIcon kind={displayKind} />
        {displayKind !== 'bookmark' ? (
          <span
            className="mt-0.5 size-2 shrink-0 rounded-full ring-1 ring-black/20 dark:ring-white/30"
            style={{ backgroundColor: highlightSwatch(mark.color) }}
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{getReadingMarkLabel(mark)}</span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            {getReadingMarkStatusLabel(mark)}
          </span>
          {mark.note?.trim() ? (
            <span className={cn('mt-1 block line-clamp-2 text-[11px] text-muted-foreground')}>
              {mark.note.trim()}
            </span>
          ) : null}
        </span>
        {onQuiz && passageExcerpt(mark).trim().length > 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
            title="让 AI 针对该重点考考我"
            aria-label="考考我"
            onClick={(event) => {
              event.stopPropagation()
              onQuiz(mark)
            }}
          >
            <Target className="size-3.5" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label="删除"
          onClick={(event) => {
            event.stopPropagation()
            onDelete(mark)
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </button>
    </li>
  )
}

interface ReadingMarkPanelProps {
  marks: ReadingMark[]
  onSelect: (mark: ReadingMark) => void
  onDelete: (mark: ReadingMark) => void
  onClose: () => void
  onExportNotes?: (contentKind: ReadingNotesContentKind, scope: ReadingNotesScope) => void
  onExportAnkiCards?: (scope: ReadingNotesScope) => void
  onReviewFlashcards?: (scope: ReadingNotesScope) => void
  onOpenQuiz?: (mark?: ReadingMark, scope?: 'mark' | 'chapter' | 'book') => void
  onOpenQuizHistory?: () => void
  onQuizMark?: (mark: ReadingMark) => void
  /** 按目录分组；不传则扁平列表 */
  marksToc?: ReadingNotesChapterRef[]
  currentChapterKey?: string
  resolveChapter?: (mark: ReadingMark, toc: ReadingNotesChapterRef[]) => ReadingNotesChapterRef
}

export function ReadingMarkPanel({
  marks,
  onSelect,
  onDelete,
  onClose,
  onExportNotes,
  onExportAnkiCards,
  onReviewFlashcards,
  onOpenQuiz,
  onOpenQuizHistory,
  onQuizMark,
  marksToc,
  currentChapterKey,
  resolveChapter,
}: ReadingMarkPanelProps) {
  const filters = useReadingMarkKindFilters()
  const visibleMarks = useMemo(
    () => marks.filter((mark) => markMatchesKindFilters(mark, filters)),
    [filters, marks],
  )

  const chapters = useMemo(() => {
    if (!marksToc || !resolveChapter || visibleMarks.length === 0) return null
    return groupMarksByChapter({
      marks: visibleMarks,
      toc: marksToc,
      resolveChapter,
      includeAncestorHeadings: true,
    })
  }, [marksToc, resolveChapter, visibleMarks])

  const [openKeys, setOpenKeys] = useState<Set<string>>(() =>
    currentChapterKey ? new Set([currentChapterKey]) : new Set(),
  )

  useEffect(() => {
    if (!currentChapterKey || !chapters?.length) return
    const keys = chapters
      .filter((chapter) => chapter.key === currentChapterKey || chapter.matchKey === currentChapterKey)
      .map((chapter) => chapter.key)
    if (keys.length === 0) return
    setOpenKeys(new Set(keys))
  }, [chapters, currentChapterKey])

  useEffect(() => {
    if (currentChapterKey) return
    const first = chapters?.[0]?.key
    if (!first) return
    setOpenKeys((prev) => (prev.size === 0 ? new Set([first]) : prev))
  }, [chapters, currentChapterKey])

  const flashcardPassages = useMemo(
    () => marks.filter(isHighlightPassage),
    [marks],
  )

  const chapterFlashcardCount = useMemo(() => {
    if (!currentChapterKey || !marksToc || !resolveChapter) return 0
    return flashcardPassages.filter((mark) => {
      const chap = resolveChapter(mark, marksToc)
      return chap.key === currentChapterKey || chap.matchKey === currentChapterKey
    }).length
  }, [currentChapterKey, flashcardPassages, marksToc, resolveChapter])

  const bookFlashcardCount = flashcardPassages.length

  const toggleChapter = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <aside className="flex w-[min(28%,320px)] min-w-[180px] shrink-0 flex-col border-r border-border/60">
      <div className="flex items-center justify-between gap-1 border-b border-border/60 px-3 py-2">
        <span className="text-xs font-medium text-foreground">书签与批注</span>
        <div className="flex items-center gap-0.5">
          {onOpenQuiz && marks.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                  title="AI 伴读出题与答题判卷"
                >
                  <Target className="size-3.5" />
                  考考我
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-38">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                  AI 智能考官
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs gap-1.5"
                  onClick={() => onOpenQuiz?.(undefined, 'mark')}
                >
                  <Sparkles className="size-3.5 text-amber-500" />
                  针对重点出卷 (3题)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs gap-1.5"
                  onClick={() => onOpenQuiz?.(undefined, 'chapter')}
                >
                  <BookOpen className="size-3.5 text-blue-500" />
                  本章重点综合卷 (3题)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs gap-1.5"
                  onClick={async () => {
                    await resetQuizSession()
                    toast.success('已强制重置考官记忆，下次答题将建立全新会话')
                  }}
                >
                  <RotateCcw className="size-3.5 text-muted-foreground" />
                  强制开启新会话
                </DropdownMenuItem>
                {onOpenQuizHistory ? (
                  <DropdownMenuItem
                    className="text-xs gap-1.5"
                    onClick={() => onOpenQuizHistory()}
                  >
                    <History className="size-3.5 text-primary" />
                    历史成绩回放
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {onReviewFlashcards && marks.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs border-primary/40 text-primary hover:bg-primary/10"
                  title="进入沉浸式闪卡抽认复习"
                >
                  <Sparkles className="size-3.5" />
                  复习
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                  闪卡复习模式
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs"
                  onClick={() => onReviewFlashcards('chapter')}
                >
                  本章闪卡 ({chapterFlashcardCount})
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs"
                  onClick={() => onReviewFlashcards('book')}
                >
                  全书闪卡 ({bookFlashcardCount})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {onExportNotes || onExportAnkiCards ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                  <Download className="size-3.5" />
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {onExportNotes ? (
                  <>
                    <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                      导出笔记为 Markdown
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {SCOPE_ITEMS.map((scopeItem) => (
                      <DropdownMenuSub key={scopeItem.scope}>
                        <DropdownMenuSubTrigger className="text-xs">{scopeItem.label}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-36">
                          {CONTENT_KIND_ITEMS.map((contentItem) => (
                            <DropdownMenuItem
                              key={contentItem.kind}
                              className="text-xs"
                              onClick={() => onExportNotes(contentItem.kind, scopeItem.scope)}
                            >
                              {contentItem.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ))}
                  </>
                ) : null}

                {onExportAnkiCards ? (
                  <>
                    {onExportNotes ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                      导出为 Anki 记忆卡片
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-xs"
                      onClick={() => onExportAnkiCards('chapter')}
                    >
                      当前章 (.txt)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs"
                      onClick={() => onExportAnkiCards('book')}
                    >
                      全书 (.txt)
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-border/50 px-3 py-1.5">
        {FILTER_ITEMS.map((item) => (
          <KindFilterChip
            key={item.key}
            label={item.label}
            pressed={filters[item.key]}
            onPressedChange={
              item.key === 'highlights'
                ? filters.setHighlights
                : item.key === 'notes'
                  ? filters.setNotes
                  : filters.setBookmarks
            }
          />
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {marks.length === 0 ? (
          <p className="px-3 py-6 text-xs text-muted-foreground">暂无书签或批注</p>
        ) : visibleMarks.length === 0 ? (
          <p className="px-3 py-6 text-xs text-muted-foreground">当前筛选下没有条目</p>
        ) : chapters && chapters.length > 0 ? (
          <div className="py-1">
            {chapters.map((chapter) => {
              const open = openKeys.has(chapter.key)
              const isCurrent = Boolean(
                currentChapterKey &&
                  (chapter.key === currentChapterKey || chapter.matchKey === currentChapterKey),
              )
              const indent = Math.min(chapter.level, 4) * 10
              const hasItems = chapter.marks.length > 0
              return (
                <div key={chapter.key} className="border-b border-border/40 last:border-b-0">
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-1 py-1.5 pr-2 text-left hover:bg-accent/30',
                      isCurrent && 'bg-accent/20',
                    )}
                    style={{ paddingLeft: 8 + indent }}
                    onClick={() => {
                      if (hasItems) toggleChapter(chapter.key)
                    }}
                    aria-expanded={hasItems ? open : undefined}
                  >
                    {hasItems ? (
                      open ? (
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      )
                    ) : (
                      <span className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                      {chapter.label}
                    </span>
                    {hasItems ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">{chapter.marks.length}</span>
                    ) : null}
                  </button>
                  {open && hasItems ? (
                    <ul className="divide-y divide-border/40 border-t border-border/30">
                      {chapter.marks.map((mark) => (
                        <MarkListItem
                          key={mark.id}
                          mark={mark}
                          onSelect={onSelect}
                          onDelete={onDelete}
                          onQuiz={onQuizMark}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {visibleMarks.map((mark) => (
              <MarkListItem
                key={mark.id}
                mark={mark}
                onSelect={onSelect}
                onDelete={onDelete}
                onQuiz={onQuizMark}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </aside>
  )
}
