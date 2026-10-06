import React, { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BookmarkCheck,
  Check,
  Copy,
  Download,
  Layers,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { ReadingMark, ReadingMarkCategory } from '@montree/contracts'
import { isOk } from '@montree/contracts'
import { queryKeys } from '@/api/query-keys'
import { readingMarksApi } from '@/api/reading-marks-api'
import { resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { Button } from '@/components/ui/button'

export interface NotesDrawerProps {
  isOpen: boolean
  onClose: () => void
  marks: ReadingMark[]
  bookTitle?: string
  /** 本书路径：有则搜索框走 FTS（marks:search），缺省回落内存过滤 */
  filePath?: string
  onDeleteMark?: (id: string) => void
  onScrollToAnchor?: (excerpt: string) => void
  onOpenFlashcards?: () => void
}

export const NotesDrawer: React.FC<NotesDrawerProps> = ({
  isOpen,
  onClose,
  marks,
  bookTitle = '当前研读专卷',
  filePath,
  onDeleteMark,
  onScrollToAnchor,
  onOpenFlashcards,
}) => {
  const [activeCategory, setActiveCategory] = useState<'all' | ReadingMarkCategory>('all')
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  return (
    <NotesDrawerBody
      marks={marks}
      bookTitle={bookTitle}
      filePath={filePath}
      activeCategory={activeCategory}
      onActiveCategoryChange={setActiveCategory}
      search={search}
      onSearchChange={setSearch}
      copied={copied}
      onCopiedChange={setCopied}
      onClose={onClose}
      onDeleteMark={onDeleteMark}
      onScrollToAnchor={onScrollToAnchor}
      onOpenFlashcards={onOpenFlashcards}
    />
  )
}

/**
 * 抽屉主体（hooks 安全区：外层 early-return 后挂 hooks 会打乱顺序，故拆出）。
 * 搜索框优先走 FTS（marks:search，经 useDeferredValue 不挡输入）；
 * IPC 不可用/无 filePath/查询中/失败时回落内存 includes（今日行为）。
 */
function NotesDrawerBody({
  marks,
  bookTitle = '当前研读专卷',
  filePath,
  activeCategory,
  onActiveCategoryChange,
  search,
  onSearchChange,
  copied,
  onCopiedChange,
  onClose,
  onDeleteMark,
  onScrollToAnchor,
  onOpenFlashcards,
}: {
  marks: ReadingMark[]
  bookTitle?: string
  filePath?: string
  activeCategory: 'all' | ReadingMarkCategory
  onActiveCategoryChange: (value: 'all' | ReadingMarkCategory) => void
  search: string
  onSearchChange: (value: string) => void
  copied: boolean
  onCopiedChange: (value: boolean) => void
  onClose: () => void
  onDeleteMark?: (id: string) => void
  onScrollToAnchor?: (excerpt: string) => void
  onOpenFlashcards?: () => void
}) {
  const deferredSearch = useDeferredValue(search)
  const trimmedQuery = deferredSearch.trim()
  const ftsQuery = useQuery({
    queryKey: queryKeys.marksSearch(filePath ?? '', trimmedQuery),
    queryFn: async (): Promise<Set<string>> => {
      const result = await readingMarksApi.search({
        filePath: filePath ?? '',
        query: trimmedQuery,
      })
      if (!isOk(result)) throw result.error
      return new Set(result.value.map((mark) => mark.id))
    },
    enabled: Boolean(filePath) && trimmedQuery.length > 0,
    staleTime: 30_000,
  })
  const ftsIds = ftsQuery.data ?? null

  const resolveCategory = (m: ReadingMark): ReadingMarkCategory => {
    if (m.category) return m.category
    if (m.diagramId) return 'diagram'
    if (m.kind === 'note') return 'note'
    return 'quote'
  }

  const filteredMarks = marks.filter((m) => {
    if (activeCategory !== 'all' && resolveCategory(m) !== activeCategory) {
      return false
    }
    if (!trimmedQuery) return true
    // FTS 命中即收；查询中/失败/无 filePath 时回落内存 includes（今日行为）
    if (ftsIds) return ftsIds.has(m.id)
    const q = trimmedQuery.toLowerCase()
    return (
      (m.title && m.title.toLowerCase().includes(q)) ||
      (m.note && m.note.toLowerCase().includes(q)) ||
      (resolveCardMeta(m).displayNote?.toLowerCase().includes(q) ?? false) ||
      (m.excerpt && m.excerpt.toLowerCase().includes(q)) ||
      (m.label && m.label.toLowerCase().includes(q))
    )
  })

  const exportAsMarkdown = () => {
    const md = `# 《${bookTitle}》阅读笔记与知识卡片
导出时间: ${new Date().toLocaleString()}
总卡片数: ${marks.length} 篇

${marks
  .map((m) => {
    const meta = resolveCardMeta(m)
    return `### 【${m.category ? m.category.toUpperCase() : 'NOTE'}】${meta.title || m.label || '笔记'}
- **原文摘录**: > "${m.excerpt || '无'}"
- **研读心得**: ${meta.displayNote || '无'}
${m.aiSummary ? `- **AI 洞见**: ${m.aiSummary}` : ''}
- **记录时间**: ${m.createdAt ? new Date(m.createdAt).toLocaleString() : '未知'}
`
  })
  .join('\n---\n\n')}
`
    navigator.clipboard.writeText(md)
    onCopiedChange(true)
    setTimeout(() => onCopiedChange(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end select-none"
      role="dialog"
      aria-modal="true"
      aria-label="全书札记与知识卡片箱"
    >
      {/* 背景遮罩 */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-200"
      />

      {/* 侧滑抽屉 */}
      <div
        id="notes-cardbox-drawer"
        className="relative z-10 w-full sm:w-[480px] h-full flex flex-col shadow-2xl border-l border-border/70 bg-card/95 backdrop-blur-xl text-foreground transition-all duration-300 animate-in slide-in-from-right duration-200"
      >
        {/* 抽屉头部 */}
        <div className="p-4 border-b border-border/60 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded-lg bg-primary/10 text-primary">
              <BookmarkCheck className="size-4" />
            </span>
            <div>
              <h3 className="font-bold text-sm text-foreground">全书札记与知识箱</h3>
              <p className="text-[10px] text-muted-foreground truncate max-w-[240px]">
                {bookTitle} · {marks.length} 条记录
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onOpenFlashcards && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 px-2.5"
                onClick={onOpenFlashcards}
                title="开启沉浸式 3D 闪卡复习"
              >
                <Sparkles className="size-3 text-amber-500" />
                <span>闪卡复习</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 px-2.5"
              onClick={exportAsMarkdown}
              title="一键复制为标准 Markdown 笔记"
            >
              {copied ? <Check className="size-3 text-emerald-500" /> : <Download className="size-3" />}
              <span>{copied ? '已复制' : '导出 MD'}</span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg hover:text-foreground"
              onClick={onClose}
              title="关闭抽屉"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* 搜索与分类导航 */}
        <div className="p-3 border-b border-border/60 space-y-2 bg-muted/10">
          <div className="relative">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索卡片摘录、心得或 AI 洞见..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl text-xs bg-background text-foreground placeholder:text-muted-foreground border border-border/60 focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar text-xs">
            {(
              [
                { id: 'all', label: '全部' },
                { id: 'note', label: '批注' },
                { id: 'concept', label: '概念' },
                { id: 'quote', label: '引用' },
                { id: 'method', label: '方法' },
                { id: 'diagram', label: '图谱' },
                { id: 'question', label: '思考' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => onActiveCategoryChange(cat.id)}
                className={`px-2 py-0.5 rounded-lg transition-colors cursor-pointer shrink-0 text-[11px] ${
                  activeCategory === cat.id
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* 札记卡片流 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredMarks.map((mark) => (
            <div
              key={mark.id}
              onClick={() => {
                if (mark.excerpt) {
                  onScrollToAnchor?.(mark.excerpt)
                  onClose()
                }
              }}
              className="group p-3 rounded-xl border border-border/70 bg-card hover:border-primary/50 transition-all text-xs space-y-2 shadow-xs cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground text-[11px] truncate max-w-[260px]">
                  {mark.title || mark.label || '札记'}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {mark.createdAt ? new Date(mark.createdAt).toLocaleDateString() : ''}
                  </span>
                  {onDeleteMark && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteMark(mark.id)
                      }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all cursor-pointer"
                      title="删除札记"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              </div>

              {mark.excerpt && (
                <p className="text-muted-foreground italic line-clamp-2 border-l-2 border-primary/40 pl-2 text-[11px]">
                  "{mark.excerpt}"
                </p>
              )}

              {(() => {
                const displayNote = resolveCardMeta(mark).displayNote
                return displayNote ? (
                  <p className="text-foreground text-[11px] leading-relaxed">
                    {displayNote}
                  </p>
                ) : null
              })()}

              {mark.aiSummary && (
                <div className="p-2 rounded-lg bg-muted/40 border border-border/50 text-[10.5px] text-muted-foreground">
                  <span className="text-primary font-medium mr-1">AI 洞见:</span>
                  {mark.aiSummary}
                </div>
              )}
            </div>
          ))}

          {filteredMarks.length === 0 && (
            <div className="py-16 text-center text-xs text-muted-foreground/70">
              暂无匹配的札记或卡片
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
