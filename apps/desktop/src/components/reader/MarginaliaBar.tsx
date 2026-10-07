import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  Plus,
  PanelRightClose,
  FoldVertical,
  UnfoldVertical,
  ChevronDown,
  Sparkles,
  Brain,
  GraduationCap,
  History,
  Download,
  BookOpen,
  Layers,
  RotateCcw,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ReadingMark, ReadingMarkCategory } from '@montree/contracts'
import { resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { KnowledgeCardItem } from './KnowledgeCardItem'
import { BracketConnector } from './BracketConnector'
import { sortMarksByDocumentPosition } from '@/lib/reader/marks/mark-document-order'
import { subscribeRailFollow, subscribeRailFocus } from '@/lib/reader/rail-follow'

export interface MarginaliaBarProps {
  marks: ReadingMark[]
  activeAnchor?: string
  onMarkClick: (mark: ReadingMark) => void
  onDeleteMark?: (id: string) => void
  onOpenDiagram?: (diagramId: string) => void
  onHoverAnchor?: (anchor: string | undefined) => void
  onToggleCardCollapse: (id: string) => void
  onToggleAllCollapse: (collapse: boolean) => void
  onGenerateAiCard?: () => void
  onCloseRail?: () => void
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
  /** 待复习闪卡计数徽标 */
  dueFlashcardCount?: number
}

export const MarginaliaBar: React.FC<MarginaliaBarProps> = ({
  marks,
  activeAnchor,
  onMarkClick,
  onDeleteMark,
  onOpenDiagram,
  onHoverAnchor,
  onToggleCardCollapse,
  onToggleAllCollapse,
  onGenerateAiCard,
  onCloseRail,
  onPolishCard,
  chapterOfMark,
  currentChapterKey,
  chapterOrder,
  readingFraction,
  onOpenQuiz,
  onOpenQuizHistory,
  onReviewFlashcards,
  onExportAnkiCards,
  dueFlashcardCount,
  className = '',
}) => {
  const [activeTab, setActiveTab] = useState<'all' | ReadingMarkCategory>('all')
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
  const notes = scopeMarks.filter((m) => resolveCategory(m) === 'note')
  const concepts = scopeMarks.filter((m) => resolveCategory(m) === 'concept')
  const quotes = scopeMarks.filter((m) => resolveCategory(m) === 'quote')
  const methods = scopeMarks.filter((m) => resolveCategory(m) === 'method')
  const diagrams = scopeMarks.filter((m) => resolveCategory(m) === 'diagram')
  const questions = scopeMarks.filter((m) => resolveCategory(m) === 'question')

  const categoryPills = useMemo(
    () => [
      {
        id: 'note' as const,
        label: '批注',
        count: notes.length,
        bgVar: 'hsl(var(--primary) / 0.15)',
        textVar: 'hsl(var(--primary))',
        borderVar: 'hsl(var(--primary) / 0.4)',
      },
      {
        id: 'diagram' as const,
        label: '图谱',
        count: diagrams.length,
        bgVar: 'var(--card-diagram-bg)',
        textVar: 'var(--card-diagram-text)',
        borderVar: 'var(--card-diagram-text)',
      },
      {
        id: 'concept' as const,
        label: '概念',
        count: concepts.length,
        bgVar: 'var(--card-concept-bg)',
        textVar: 'var(--card-concept-text)',
        borderVar: 'var(--card-concept-text)',
      },
      {
        id: 'quote' as const,
        label: '引用',
        count: quotes.length,
        bgVar: 'var(--card-quote-bg)',
        textVar: 'var(--card-quote-text)',
        borderVar: 'var(--card-quote-text)',
      },
      {
        id: 'method' as const,
        label: '方法',
        count: methods.length,
        bgVar: 'var(--card-method-bg)',
        textVar: 'var(--card-method-text)',
        borderVar: 'var(--card-method-text)',
      },
      {
        id: 'question' as const,
        label: '思考',
        count: questions.length,
        bgVar: 'var(--card-question-bg)',
        textVar: 'var(--card-question-text)',
        borderVar: 'var(--card-question-text)',
      },
    ],
    [notes.length, diagrams.length, concepts.length, quotes.length, methods.length, questions.length],
  )

  // 智能药丸收纳（方案三：高频前置 + 更多下拉收纳）：
  // 1. 前排常驻「全部」+ 最多 3 个高频分类药丸，确保在 296px 宽度内绝不溢出；
  // 2. 当前被激活的 Tab 优先排在前排，其余分类按卡片数量降序排序；
  // 3. 超出 3 个的分类自动收纳进「更多 (N) ▾」下拉菜单中，选择即置换高亮。
  const MAX_VISIBLE_PILLS = 3

  const { visiblePills, overflowPills } = useMemo(() => {
    const hasAny = categoryPills.some((p) => p.count > 0)
    const candidates = hasAny
      ? categoryPills.filter((p) => p.count > 0 || p.id === activeTab)
      : categoryPills

    const sorted = [...candidates].sort((a, b) => {
      if (a.id === activeTab) return -1
      if (b.id === activeTab) return 1
      return b.count - a.count
    })

    if (sorted.length <= MAX_VISIBLE_PILLS) {
      return { visiblePills: sorted, overflowPills: [] }
    }

    return {
      visiblePills: sorted.slice(0, MAX_VISIBLE_PILLS),
      overflowPills: sorted.slice(MAX_VISIBLE_PILLS),
    }
  }, [categoryPills, activeTab])

  const filteredMarks = marks.filter((m) => {
    if (scope === 'chapter' && canScopeByChapter) {
      if (chapterKeyOf(m) !== currentChapterKey) return false
    }
    if (activeTab === 'all') return true
    return resolveCategory(m) === activeTab
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
      className={`w-80 shrink-0 space-y-3 pt-4 pb-20 select-none px-3 bg-background/50 backdrop-blur-sm transition-all duration-300 overflow-y-auto ${className}`}
    >
      {/* 头部：标题 + 计数 + 批处理控件 */}
      <div className="space-y-2.5 px-0.5">
        <div className="text-[11px] text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Bookmark className="w-3.5 h-3.5 text-primary" />
            <span>知识卡片</span>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">
              {scopeMarks.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* 全部折叠 / 展开 */}
            <button
              type="button"
              onClick={() => onToggleAllCollapse(!allCollapsed)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title={allCollapsed ? '展开全部卡片' : '折叠全部为单行'}
            >
              {allCollapsed ? (
                <UnfoldVertical className="w-3.5 h-3.5" />
              ) : (
                <FoldVertical className="w-3.5 h-3.5" />
              )}
            </button>

            {/* AI 智能制卡 */}
            {onGenerateAiCard && (
              <button
                type="button"
                onClick={onGenerateAiCard}
                className="p-1 rounded hover:bg-primary/10 text-primary transition-colors cursor-pointer flex items-center gap-0.5 text-[11px] font-medium"
                title="AI 智能制卡"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>制卡</span>
              </button>
            )}

            {/* 收起侧边卡轨 */}
            {onCloseRail && (
              <button
                type="button"
                onClick={onCloseRail}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer ml-0.5"
                title="收起卡片栏"
              >
                <PanelRightClose className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 作用域：本章（默认，随正文走）/ 全部（跨章回顾） */}
        {canScopeByChapter && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setScope('chapter')}
              className={`px-2 py-0.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                scope === 'chapter'
                  ? 'bg-primary/15 text-primary font-semibold border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              本章 ({chapterCount})
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`px-2 py-0.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                scope === 'all'
                  ? 'bg-muted text-foreground font-semibold border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              全书 ({marks.length})
            </button>
          </div>
        )}

        {/* 智考与闪卡微晶学习控制台 */}
        {(onOpenQuiz || onReviewFlashcards) && (
          <div className="flex items-center gap-1.5 py-1">
            {/* AI 智能测验 */}
            {onOpenQuiz && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-gradient-to-r from-primary/15 via-primary/10 to-primary/5 hover:from-primary/20 hover:to-primary/10 text-primary border border-primary/30 text-[11px] font-semibold transition-all shadow-xs cursor-pointer group"
                    title="启动 AI 考官出题测验"
                  >
                    <Sparkles className="size-3.5 text-primary group-hover:scale-110 transition-transform" />
                    <span>智能测验</span>
                    <ChevronDown className="size-3 opacity-60 ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 text-xs">
                  <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                    AI 考官沉浸出卷
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs gap-2 cursor-pointer"
                    onClick={() => onOpenQuiz(undefined, 'chapter')}
                  >
                    <BookOpen className="size-3.5 text-blue-500" />
                    <span>本章重点综合卷</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs gap-2 cursor-pointer"
                    onClick={() => onOpenQuiz(undefined, 'book')}
                  >
                    <GraduationCap className="size-3.5 text-purple-500" />
                    <span>全书跨章重点大考</span>
                  </DropdownMenuItem>
                  {onOpenQuizHistory && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-xs gap-2 cursor-pointer"
                        onClick={onOpenQuizHistory}
                      >
                        <History className="size-3.5 text-amber-500" />
                        <span>历史成绩与错题</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* 3D 闪卡复习 */}
            {onReviewFlashcards && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/5 hover:from-amber-500/20 hover:to-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[11px] font-semibold transition-all shadow-xs cursor-pointer group"
                    title="进入沉浸式 3D 闪卡复习"
                  >
                    <Brain className="size-3.5 text-amber-500 group-hover:scale-110 transition-transform" />
                    <span>闪卡复习</span>
                    {typeof dueFlashcardCount === 'number' && dueFlashcardCount > 0 && (
                      <span className="px-1 py-0.2 rounded-full text-[9px] bg-amber-500 text-white font-mono font-bold leading-none">
                        {dueFlashcardCount}
                      </span>
                    )}
                    <ChevronDown className="size-3 opacity-60 ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 text-xs">
                  <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                    FSRS 科学记忆复习
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs gap-2 cursor-pointer"
                    onClick={() => onReviewFlashcards('chapter')}
                  >
                    <Layers className="size-3.5 text-amber-500" />
                    <span>本章重点闪卡</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs gap-2 cursor-pointer"
                    onClick={() => onReviewFlashcards('book')}
                  >
                    <RotateCcw className="size-3.5 text-blue-500" />
                    <span>全书重点闪卡</span>
                  </DropdownMenuItem>
                  {onExportAnkiCards && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-xs gap-2 cursor-pointer"
                        onClick={() => onExportAnkiCards('book')}
                      >
                        <Download className="size-3.5 text-emerald-500" />
                        <span>导出 Anki 卡包 (TSV)</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        {/* 分类筛选药丸 */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-2 py-0.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
              activeTab === 'all'
                ? 'bg-muted text-foreground font-semibold border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            全部 ({scopeMarks.length})
          </button>
          {visiblePills.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setActiveTab(pill.id)}
              className={`px-2 py-0.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0 ${
                activeTab === pill.id
                  ? 'font-semibold border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={{
                backgroundColor: activeTab === pill.id ? pill.bgVar : undefined,
                color: activeTab === pill.id ? pill.textVar : undefined,
                borderColor: activeTab === pill.id ? pill.borderVar : undefined,
              }}
            >
              {pill.label} ({pill.count})
            </button>
          ))}
          {overflowPills.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="px-2 py-0.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted text-[11px] border border-transparent hover:border-border"
                  title="查看更多卡片分类"
                >
                  <span>更多 ({overflowPills.length})</span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36 text-xs p-1">
                {overflowPills.map((pill) => (
                  <DropdownMenuItem
                    key={pill.id}
                    onClick={() => setActiveTab(pill.id)}
                    className="flex items-center justify-between cursor-pointer py-1.5 px-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: pill.textVar }}
                      />
                      <span>{pill.label}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {pill.count}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
                  isActive={!!isHighlighted || focusedId === mark.id}
                  sourceLabel={chapter?.label}
                  onToggleCollapse={() => onToggleCardCollapse(mark.id)}
                  onPolish={onPolishCard ? () => onPolishCard(mark.id) : undefined}
                  onDelete={onDeleteMark ? () => onDeleteMark(mark.id) : undefined}
                  onOpenDiagram={onOpenDiagram}
                  onAnchorClick={() => onMarkClick(mark)}
                  onCardClick={() => onMarkClick(mark)}
                  onHover={(hovering) => onHoverAnchor?.(hovering ? mark.excerpt : undefined)}
                  onQuiz={onOpenQuiz ? () => onOpenQuiz(mark, 'mark') : undefined}
                  onReview={onReviewFlashcards ? () => onReviewFlashcards('book', mark.id) : undefined}
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
