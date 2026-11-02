import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Plus, ChevronDown, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ReadingMark, ReadingMarkCategory } from '@yitom/contracts'
import { resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { KnowledgeCardItem } from './KnowledgeCardItem'
import { BracketConnector } from './BracketConnector'
import { sortMarksByDocumentPosition } from '@/lib/reader/marks/mark-document-order'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import type { ReadingNotesContentKind, ReadingNotesScope } from '@yitom/reader-core'
import { subscribeRailFollow, subscribeRailFocus } from '@/lib/reader/rail-follow'

export interface MarginaliaBarProps {
  marks: ReadingMark[]
  markReferenceNotice?: (mark: ReadingMark) => string | undefined
  activeAnchor?: string
  onMarkClick: (mark: ReadingMark) => void
  onDeleteMark?: (id: string) => void
  onOpenDiagram?: (diagramId: string) => void
  onHoverAnchor?: (anchor: string | undefined) => void
  onToggleCardCollapse: (id: string) => void
  onToggleAllCollapse: (collapse: boolean) => void
  onGenerateAiCard?: () => void
  onPolishCard?: (id: string) => void
  className?: string
  /** 章节归属解析（阅读器按目录提供）；缺省时卡片不显示出处、不做本章致灰 */
  chapterOfMark?: (mark: ReadingMark) => { key: string; label: string } | null
  /** 当前阅读章节键：命中卡片正常显示，其余致灰 */
  currentChapterKey?: string
  /** 目录键序：卡片按文档位置排序（纵序对齐正文，同滚联动的前提） */
  chapterOrder?: string[]
  /**
   * 正文阅读进度 0~1（书级分数）：轨按等比跟随滚动，与正文同进退。
   * 缺省时不同滚（保留手动滚动）。手动滚动 3 秒内暂停跟随，不打架。
   */
  readingFraction?: number
  /** AI 智能出题测验回调 */
  onOpenQuiz?: (mark?: ReadingMark, scope?: 'mark' | 'chapter' | 'book') => void
  /** 历史卷库与成绩回调 */
  onOpenQuizHistory?: () => void
  /** 沉浸式 3D 闪卡复习回调 */
  onReviewFlashcards?: (scope: 'chapter' | 'book', markId?: string) => void
  /** 导出 Anki 记忆卡片回调 */
  onExportAnkiCards?: (scope: 'chapter' | 'book') => void
  onExportNotes?: (kind: ReadingNotesContentKind, scope: ReadingNotesScope) => void
  /** 待复习闪卡计数徽标 */
  dueFlashcardCount?: number
}

export const MarginaliaBar: React.FC<MarginaliaBarProps> = ({
  marks,
  markReferenceNotice,
  activeAnchor,
  onMarkClick,
  onDeleteMark,
  onOpenDiagram,
  onHoverAnchor,
  onToggleCardCollapse,
  onToggleAllCollapse,
  onGenerateAiCard,
  onPolishCard,
  chapterOfMark,
  currentChapterKey,
  chapterOrder,
  readingFraction,
  onOpenQuiz,
  onOpenQuizHistory,
  onReviewFlashcards,
  onExportAnkiCards,
  onExportNotes,
  dueFlashcardCount,
  className = '',
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'bookmarks' | ReadingMarkCategory>('all')
  // 作用域：默认只看本章（与右侧正文绑定，跳章即换）；全部用于跨章回顾
  const canScopeByChapter = !!chapterOfMark && !!currentChapterKey
  const [scope, setScope] = useState<'chapter' | 'all'>(() =>
    chapterOfMark && currentChapterKey ? 'chapter' : 'all',
  )
  const railRef = useRef<HTMLElement>(null)

  const resolveCategory = (m: ReadingMark): ReadingMarkCategory => {
    return resolveCardMeta(m).category
  }

  // 章节键解析（普通函数，过滤与排序共用；内部自带 try 保护）
  const chapterKeyOf = (m: ReadingMark): string | null => {
    try {
      return chapterOfMark?.(m)?.key ?? null
    } catch {
      return null
    }
  }

  // 作用域内集合：本章模式下分类计数与列表都只算本章（计数组跟随作用域）；
  // 全书模式回落全量。头部总数同样跟随，避免"本章(0)+概念(1)"精神分裂。
  const scopeMarks = useMemo(() => {
    if (scope !== 'chapter' || !canScopeByChapter) return marks
    return marks.filter((m) => chapterKeyOf(m) === currentChapterKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, scope, canScopeByChapter, currentChapterKey])
  const categoryFilters: Array<{ id: ReadingMarkCategory; label: string }> = [
    { id: 'note', label: '批注' }, { id: 'quote', label: '引用' },
    { id: 'concept', label: '概念' }, { id: 'diagram', label: '图谱' },
    { id: 'method', label: '方法' }, { id: 'question', label: '思考' },
  ]
  const filters = [
    { id: 'all', label: '全部类型', count: scopeMarks.length },
    { id: 'bookmarks', label: '书签', count: scopeMarks.filter((m) => m.kind === 'bookmark').length },
    ...categoryFilters.map((filter) => ({
      ...filter,
      count: scopeMarks.filter((m) => m.kind !== 'bookmark' && resolveCategory(m) === filter.id).length,
    })),
  ]
  const activeFilter = filters.find((filter) => filter.id === activeTab)!

  const filteredMarks = marks.filter((m) => {
    if (scope === 'chapter' && canScopeByChapter) {
      if (chapterKeyOf(m) !== currentChapterKey) return false
    }
    if (activeTab === 'all') return true
    if (activeTab === 'bookmarks') return m.kind === 'bookmark'
    return m.kind !== 'bookmark' && resolveCategory(m) === activeTab
  })
  const chapterCount = useMemo(() => {
    if (!canScopeByChapter) return 0
    return marks.filter((m) => chapterKeyOf(m) === currentChapterKey).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, canScopeByChapter, currentChapterKey])

  const allCollapsed = marks.length > 0 && marks.every((m) => m.collapsed)

  // 卡片按文档位置排序：纵序对齐正文（章序优先，同章保序，无归属沉底）
  const positionedMarks = useMemo(
    () => sortMarksByDocumentPosition(filteredMarks, chapterOrder ?? [], chapterKeyOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredMarks, chapterOrder],
  )

  // 同滚联动：正文进度等比映射到轨滚动；手动滚动 3 秒内暂停跟随
  const lastManualScrollRef = useRef(0)
  const programmaticScrollRef = useRef(0)
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const onScroll = () => {
      if (Date.now() - programmaticScrollRef.current < 150) return
      lastManualScrollRef.current = Date.now()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  // 把书级分数映射为轨滚动（瞬间完成，无动画；手动滚动 3 秒内不抢）
  const applyRailFraction = useCallback((fraction: number) => {
    if (!Number.isFinite(fraction)) return
    if (Date.now() - lastManualScrollRef.current < 3000) return
    const el = railRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 0) return
    const f = Math.min(1, Math.max(0, fraction))
    programmaticScrollRef.current = Date.now()
    el.scrollTop = f * max
  }, [])
  useEffect(() => {
    if (readingFraction === undefined) return
    applyRailFraction(readingFraction)
  }, [readingFraction, applyRailFraction])
  // 逐帧跟随通道：Foliate 文档滚动直驱（统一通道，无 React 重渲染），
  // 与上面的分数 prop 同一入口，手动暂停规则一致
  useEffect(() => {
    return subscribeRailFollow((f) => applyRailFraction(f))
  }, [applyRailFraction])
  // 反向联动：正文标记被点击 → 滚动到对应卡并闪现 2.5s
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return subscribeRailFocus((markId) => {
      const el = railRef.current?.querySelector(`[data-card-id="${markId}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFocusedId(markId)
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
      focusTimerRef.current = window.setTimeout(() => {
        setFocusedId((cur) => (cur === markId ? null : cur))
      }, 2500)
    })
  }, [])
  useEffect(() => {
    return () => {
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
    }
  }, [])

  return (
    <aside
      id="marginalia-notes-stream"
      ref={railRef}
      aria-label="页边知识卡片流"
      className={cn('w-80 min-w-0 shrink-0 space-y-3 px-3 pt-4 pb-8 select-none bg-background overflow-y-auto', className)}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
            <Bookmark className="size-3.5 text-primary" aria-hidden="true" />
            <span>知识卡片</span>
            <span className="text-muted-foreground">{scopeMarks.length}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onGenerateAiCard && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onGenerateAiCard}>
                <Plus className="size-3.5" aria-hidden="true" />制卡
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-7" aria-label="更多卡片操作" title="更多卡片操作">
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {onOpenQuiz && <>
                  <DropdownMenuLabel>测验与复习</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => onOpenQuiz(undefined, 'chapter')}>本章测验</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onOpenQuiz(undefined, 'book')}>全书测验</DropdownMenuItem>
                </>}
                {onReviewFlashcards && <>
                  <DropdownMenuItem onSelect={() => onReviewFlashcards('chapter')}>复习本章闪卡</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onReviewFlashcards('book')}>复习全书闪卡</DropdownMenuItem>
                </>}
                {onOpenQuizHistory && <DropdownMenuItem onSelect={onOpenQuizHistory}>历史成绩与错题</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onToggleAllCollapse(!allCollapsed)}>
                  {allCollapsed ? '展开全部卡片' : '折叠全部卡片'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => useReaderHudUiStore.getState().setIsNotesDrawerOpen(true)}>
                  打开全书札记
                </DropdownMenuItem>
                {onExportNotes && <DropdownMenuSub>
                  <DropdownMenuSubTrigger>导出笔记为 Markdown</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(['chapter', 'book'] as const).map((noteScope) => <DropdownMenuSub key={noteScope}>
                      <DropdownMenuSubTrigger>{noteScope === 'chapter' ? '本章' : '全书'}</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {([['combined', '综合'], ['notes', '批注'], ['highlights', '重点']] as const).map(([kind, label]) => (
                          <DropdownMenuItem key={kind} onSelect={() => onExportNotes(kind, noteScope)}>{label}</DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>)}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>}
                {onExportAnkiCards && <DropdownMenuSub>
                  <DropdownMenuSubTrigger>导出 Anki 卡包</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => onExportAnkiCards('chapter')}>本章</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onExportAnkiCards('book')}>全书</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {canScopeByChapter && <div className="flex items-center gap-1">
            <Button variant={scope === 'chapter' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" aria-pressed={scope === 'chapter'} onClick={() => setScope('chapter')}>本章 ({chapterCount})</Button>
            <Button variant={scope === 'all' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>全书 ({marks.length})</Button>
          </div>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" aria-label="筛选卡片类型">
                {activeFilter.label} ({activeFilter.count})<ChevronDown className="size-3" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
                {filters.map((filter) => <DropdownMenuRadioItem key={filter.id} value={filter.id}>
                  {filter.label} ({filter.count})
                </DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 卡片流（已按文档位置排序，纵序对齐正文） */}
      <div className="space-y-2.5">
        {positionedMarks.map((mark, idx) => {
          const isHighlighted =
            activeAnchor &&
            ((mark.excerpt && mark.excerpt.includes(activeAnchor)) ||
              activeAnchor.includes(mark.excerpt || ''))

          // 章节归属：卡片主人的目录位置；命中当前章正常显示，否则致灰
          let chapter: { key: string; label: string } | null = null
          try {
            chapter = chapterOfMark?.(mark) ?? null
          } catch {
            chapter = null
          }
          const inCurrentChapter =
            !currentChapterKey || !chapter || chapter.key === currentChapterKey
          // 章首分隔：同章卡片成组，组前标出章节名（卡片归属可视化）
          let prevChapterKey: string | null = null
          try {
            prevChapterKey = idx > 0 ? (chapterKeyOf(positionedMarks[idx - 1]!) ?? null) : null
          } catch {
            prevChapterKey = null
          }
          const showChapterDivider =
            !!chapter && (idx === 0 || prevChapterKey !== chapter.key)

          return (
            <div key={mark.id}>
              {showChapterDivider && chapter && (
                <div className="flex items-center gap-2 pb-1.5 pt-2 text-[10px] text-muted-foreground">
                  <span className="h-px flex-1 bg-border/60" />
                  <span className="max-w-[180px] truncate font-medium">{chapter.label}</span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
              )}
            <div
              className={`flex items-start gap-1 transition-opacity ${inCurrentChapter ? '' : 'opacity-55'}`}
            >
              <BracketConnector
                isCollapsed={!!mark.collapsed}
                isActive={!!isHighlighted}
                className="mt-0.5 shrink-0"
                onActivate={() => onMarkClick(mark)}
                onHover={(hovering) => onHoverAnchor?.(hovering ? mark.excerpt : undefined)}
              />
              <div className="min-w-0 flex-1">
                <KnowledgeCardItem
                  mark={mark}
                  referenceNotice={markReferenceNotice?.(mark)}
                  isActive={!!isHighlighted || focusedId === mark.id}
                  sourceLabel={chapter?.label}
                  onToggleCollapse={() => onToggleCardCollapse(mark.id)}
                  onPolish={onPolishCard ? () => onPolishCard(mark.id) : undefined}
                  onDelete={onDeleteMark ? () => onDeleteMark(mark.id) : undefined}
                  onOpenDiagram={onOpenDiagram}
                  onAnchorClick={() => onMarkClick(mark)}
                  onCardClick={() => onMarkClick(mark)}
                  onHover={(hovering) => onHoverAnchor?.(hovering ? mark.excerpt : undefined)}
                  onQuiz={mark.kind !== 'bookmark' && onOpenQuiz ? () => onOpenQuiz(mark, 'mark') : undefined}
                  onReview={mark.kind !== 'bookmark' && onReviewFlashcards ? () => onReviewFlashcards('book', mark.id) : undefined}
                />
              </div>
            </div>
            </div>
          )
        })}

        {filteredMarks.length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground/70">
            {scope === 'chapter' && canScopeByChapter
              ? '本章暂无卡片，划选正文即可制卡'
              : '暂无该分类的知识卡片'}
          </div>
        )}
      </div>
    </aside>
  )
}
