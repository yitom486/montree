import React, { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BookmarkCheck,
  Check,
  Copy,
  Download,
  FilePenLine,
  GitFork,
  GraduationCap,
  HelpCircle,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Quote,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react'
import type { ReadingMark, ReadingMarkCategory } from '@montree/contracts'
import { isOk } from '@montree/contracts'
import { queryKeys } from '@/api/query-keys'
import { readingMarksApi } from '@/api/reading-marks-api'
import { filterRedundantKeyPoints, resolveCardMeta } from '@/lib/reader/marks/resolve-card-meta'
import { parseDiagramFromMark } from '@/lib/reader/marks/diagram-mark-parser'
import { MarkdownContent } from '@/components/markdown/MarkdownContent'
import { renderAgentMarkdown } from '@/lib/agent/agent-markdown'
import '@/styles/markdown-preview.css'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

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
  onOpenQuiz?: (req?: { passage?: string; chapterTitle?: string; markId?: string }) => void
  onOpenDiagram?: (diagramId: string) => void
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
  onOpenQuiz,
  onOpenDiagram,
}) => {
  const [activeCategory, setActiveCategory] = useState<'all' | ReadingMarkCategory>('all')
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const [isWide, setIsWide] = useState(false)

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
      isWide={isWide}
      onToggleWide={() => setIsWide((w) => !w)}
      onClose={onClose}
      onDeleteMark={onDeleteMark}
      onScrollToAnchor={onScrollToAnchor}
      onOpenFlashcards={onOpenFlashcards}
      onOpenQuiz={onOpenQuiz}
      onOpenDiagram={onOpenDiagram}
    />
  )
}

/** 规范化笔记 Markdown，确保标题、围栏与引用前具备合法换行，并严密保护代码块内部 */
function normalizeNoteMarkdown(text: string): string {
  if (!text) return ''

  // 1. 抽取并保护代码块，避免内部连接符号（如 `-->`）被外部正则误伤拆断
  const codeBlocks: string[] = []
  let safeText = text.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length
    codeBlocks.push(match)
    return `__MD_FENCE_BLOCK_${idx}__`
  })

  // 2. 仅对正文区域进行标点后标题规范与引用前空行规范（严格匹配行首/段落级引用，绝不误伤行内比较符）
  safeText = safeText
    .replace(/([。！？；])\s*(###?\s+)/g, '$1\n\n$2')
    .replace(/([^\n])\s*(>[ \t]+)/g, '$1\n\n$2')

  // 3. 还原代码块，并确保每个代码块前后有合法换行、内容保持纯净
  safeText = safeText.replace(/__MD_FENCE_BLOCK_(\d+)__/g, (_match, id) => {
    const rawBlock = codeBlocks[Number(id)] ?? ''
    const fenceMatch = rawBlock.match(/^```([a-z0-9_-]*)\s*([\s\S]*?)```$/i)
    if (fenceMatch) {
      const lang = fenceMatch[1] || ''
      const content = fenceMatch[2].trim()
      return `\n\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`
    }
    return `\n\n${rawBlock}\n\n`
  })

  // 4. 兜底未闭合代码围栏前换行
  safeText = safeText.replace(/([^\n])\s*(```(?:mermaid|[a-z]*))/g, '$1\n\n$2')

  return safeText.trim()
}

const CATEGORY_META: Record<
  'all' | ReadingMarkCategory,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string; border: string }
> = {
  all: { label: '全部', icon: Layers, color: 'text-foreground', bg: 'bg-muted/80', border: 'border-border' },
  concept: { label: '概念', icon: Sparkles, color: 'text-purple-400', bg: 'bg-purple-500/10 text-purple-400', border: 'border-purple-500/30' },
  note: { label: '批注', icon: FilePenLine, color: 'text-sky-400', bg: 'bg-sky-500/10 text-sky-400', border: 'border-sky-500/30' },
  quote: { label: '引用', icon: Quote, color: 'text-emerald-400', bg: 'bg-emerald-500/10 text-emerald-400', border: 'border-emerald-500/30' },
  method: { label: '方法', icon: Workflow, color: 'text-amber-400', bg: 'bg-amber-500/10 text-amber-400', border: 'border-amber-500/30' },
  diagram: { label: '图谱', icon: GitFork, color: 'text-indigo-400', bg: 'bg-indigo-500/10 text-indigo-400', border: 'border-indigo-500/30' },
  question: { label: '思考', icon: HelpCircle, color: 'text-rose-400', bg: 'bg-rose-500/10 text-rose-400', border: 'border-rose-500/30' },
}

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
  isWide,
  onToggleWide,
  onClose,
  onDeleteMark,
  onScrollToAnchor,
  onOpenFlashcards,
  onOpenQuiz,
  onOpenDiagram,
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
  isWide: boolean
  onToggleWide: () => void
  onClose: () => void
  onDeleteMark?: (id: string) => void
  onScrollToAnchor?: (excerpt: string) => void
  onOpenFlashcards?: () => void
  onOpenQuiz?: (req?: { passage?: string; chapterTitle?: string; markId?: string }) => void
  onOpenDiagram?: (diagramId: string) => void
}) {
  const globalOpenQuiz = useReaderHudUiStore((s) => s.openQuiz)
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

  interface NotesStats {
    total: number
    concept: number
    note: number
    quote: number
    method: number
    diagram: number
    question: number
  }

  // 知识资产统计
  const stats = useMemo<NotesStats>(() => {
    let concept = 0
    let note = 0
    let quote = 0
    let method = 0
    let diagram = 0
    let question = 0
    for (const m of marks) {
      const cat = resolveCategory(m)
      if (cat === 'concept') concept++
      else if (cat === 'note') note++
      else if (cat === 'quote') quote++
      else if (cat === 'method') method++
      else if (cat === 'diagram') diagram++
      else if (cat === 'question') question++
    }
    return {
      total: marks.length,
      concept,
      note,
      quote,
      method,
      diagram,
      question,
    }
  }, [marks])

  const filteredMarks = marks.filter((m) => {
    if (activeCategory !== 'all' && resolveCategory(m) !== activeCategory) {
      return false
    }
    if (!trimmedQuery) return true
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

  // 基于当前札记箱内容一键发起 AI 智考
  const handleLaunchQuiz = (targetMark?: ReadingMark) => {
    if (targetMark && targetMark.excerpt) {
      const payload = {
        passage: targetMark.excerpt,
        chapterTitle: targetMark.title || '重点札记考查',
        markId: targetMark.id,
      }
      if (onOpenQuiz) {
        onOpenQuiz(payload)
      } else {
        globalOpenQuiz(payload)
      }
      onClose()
      return
    }

    // 整箱或当前筛选类别出题
    const candidates = filteredMarks.filter((m) => (m.excerpt || '').trim().length > 0)
    if (candidates.length === 0) {
      toast.info('当前筛选分类下无带原文的知识卡片，无法生成考题')
      return
    }
    const passage = candidates
      .slice(0, 10)
      .map((m) => `【${CATEGORY_META[resolveCategory(m)].label}·${m.title || '札记'}】: ${m.excerpt}`)
      .join('\n\n')

    const categoryLabel = activeCategory === 'all' ? '全书知识卡片' : CATEGORY_META[activeCategory].label
    const payload = {
      passage,
      chapterTitle: `${categoryLabel} 专项综合测验`,
    }
    if (onOpenQuiz) {
      onOpenQuiz(payload)
    } else {
      globalOpenQuiz(payload)
    }
    onClose()
  }

  const exportAsMarkdown = () => {
    const md = `# 《${bookTitle}》阅读笔记与知识资产卡片箱
导出时间: ${new Date().toLocaleString()}
总卡片数: ${marks.length} 篇

${marks
  .map((m) => {
    const meta = resolveCardMeta(m)
    const cat = resolveCategory(m)
    return `### 【${CATEGORY_META[cat].label}】${meta.title || m.label || '知识札记'}
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
    toast.success('已复制全书札记 Markdown 到剪贴板')
    setTimeout(() => onCopiedChange(false), 2000)
  }

  const copySingleCard = (mark: ReadingMark) => {
    const meta = resolveCardMeta(mark)
    const text = `【${mark.title || '札记'}】\n原文：${mark.excerpt || ''}\n心得：${meta.displayNote || ''}${mark.aiSummary ? `\nAI 洞见：${mark.aiSummary}` : ''}`
    navigator.clipboard.writeText(text)
    toast.success('已复制单张卡片内容')
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

      {/* 侧滑抽屉（支持宽屏自适应、视口宽度限制与折叠切换） */}
      <div
        id="notes-cardbox-drawer"
        className={cn(
          'relative z-10 h-full max-w-[100vw] sm:max-w-[calc(100vw-2.5rem)] flex flex-col shadow-2xl border-l border-border/70 bg-card/95 backdrop-blur-2xl text-foreground transition-all duration-300 animate-in slide-in-from-right overflow-hidden',
          isWide ? 'w-full sm:w-[720px] md:w-[860px]' : 'w-full sm:w-[540px] md:w-[600px]',
        )}
      >
        {/* 抽屉头部（自适应弹性防溢出，右侧操作栏绝对保全） */}
        <div className="px-3 sm:px-4 py-3 border-b border-border/60 flex items-center justify-between gap-2 bg-muted/20 min-w-0">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <span className="p-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs shrink-0">
              <BookmarkCheck className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-bold text-sm text-foreground truncate">全书札记与知识卡片箱</h3>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-primary shrink-0">
                  {marks.length} 篇
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground truncate w-full" title={bookTitle}>
                {bookTitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* AI 智考出卷 */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 px-2 sm:px-2.5 border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 hover:text-amber-400 font-medium transition-all shrink-0"
              onClick={() => handleLaunchQuiz()}
              title="根据当前知识卡片箱一键生成 AI 智能测验"
            >
              <GraduationCap className="size-3.5 text-amber-500" />
              <span>考考我</span>
            </Button>

            {/* 3D 闪卡复习 */}
            {onOpenFlashcards && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 px-2 hover:bg-muted/80 shrink-0"
                onClick={onOpenFlashcards}
                title="开启沉浸式闪卡艾宾浩斯复习"
              >
                <Sparkles className="size-3 text-purple-400" />
                <span className="hidden sm:inline">闪卡复习</span>
              </Button>
            )}

            {/* 导出 Markdown */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 px-2 sm:px-2.5 hover:bg-muted/80 shrink-0"
              onClick={exportAsMarkdown}
              title="一键复制为标准 Markdown 结构化笔记"
            >
              {copied ? <Check className="size-3 text-emerald-500" /> : <Download className="size-3" />}
              <span className="hidden sm:inline">{copied ? '已复制' : '导出 MD'}</span>
            </Button>

            {/* 宽屏展开切换 */}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
              onClick={onToggleWide}
              title={isWide ? '收缩标准宽度' : '展开宽屏模式'}
            >
              {isWide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </Button>

            {/* 关闭抽屉 */}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 shrink-0 cursor-pointer"
              onClick={onClose}
              title="关闭抽屉"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* 知识资产数据看板 (Stat Pills) */}
        <div className="px-4 py-2.5 border-b border-border/50 bg-muted/15 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs">
          <span className="text-[10px] text-muted-foreground/70 font-medium shrink-0 mr-1">资产盘点:</span>
          {(
            [
              { id: 'all', label: '全部', count: stats.total, icon: Layers },
              { id: 'concept', label: '概念', count: stats.concept, icon: Sparkles },
              { id: 'note', label: '批注', count: stats.note, icon: FilePenLine },
              { id: 'diagram', label: '图谱', count: stats.diagram, icon: GitFork },
              { id: 'quote', label: '引用', count: stats.quote, icon: Quote },
              { id: 'method', label: '方法', count: stats.method, icon: Workflow },
              { id: 'question', label: '思考', count: stats.question, icon: HelpCircle },
            ] as const
          ).map((item) => {
            const Icon = item.icon
            const isSelected = activeCategory === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onActiveCategoryChange(item.id)}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-medium transition-all shrink-0 cursor-pointer select-none',
                  isSelected
                    ? 'border-primary/40 bg-primary/15 text-primary shadow-xs font-semibold'
                    : 'border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
              >
                <Icon className="size-3 opacity-80" />
                <span>{item.label}</span>
                <span className={cn('text-[10px] font-mono ml-0.5', isSelected ? 'text-primary' : 'text-muted-foreground/80')}>
                  {item.count}
                </span>
              </button>
            )
          })}
        </div>

        {/* 搜索栏 */}
        <div className="p-3 border-b border-border/60 bg-muted/10">
          <div className="relative">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索卡片摘录、研读心得或 AI 洞见..."
              className="w-full pl-9 pr-8 py-1.5 rounded-xl text-xs bg-background text-foreground placeholder:text-muted-foreground border border-border/60 focus:outline-none focus:border-primary/60 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        {/* 札记卡片流 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {filteredMarks.map((mark) => {
            const category = resolveCategory(mark)
            const metaInfo = CATEGORY_META[category]
            const CategoryIcon = metaInfo.icon
            const resolved = resolveCardMeta(mark)
            const displayNote = resolved.displayNote
            const excerpt = mark.excerpt
            const visibleKeyPoints = filterRedundantKeyPoints(resolved.keyPoints, excerpt)
            const diagramPayload = parseDiagramFromMark(mark)

            return (
              <div
                key={mark.id}
                className="group p-3.5 rounded-xl border border-border/70 bg-card/80 hover:border-primary/40 hover:shadow-md transition-all text-xs space-y-2.5 shadow-xs"
              >
                {/* 顶栏：分类徽标 + 标题 + 操作组 */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border shrink-0',
                        metaInfo.bg,
                        metaInfo.border,
                      )}
                    >
                      <CategoryIcon className="size-2.5" />
                      <span>{metaInfo.label}</span>
                    </span>
                    <span className="font-semibold text-foreground text-xs truncate">
                      {mark.title || resolved.title || mark.label || '知识札记'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-mono text-muted-foreground mr-1">
                      {mark.createdAt ? new Date(mark.createdAt).toLocaleDateString() : ''}
                    </span>

                    {/* 定位正文 */}
                    {excerpt && onScrollToAnchor && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md hover:bg-primary/10 hover:text-primary transition-all text-muted-foreground"
                        onClick={() => {
                          onScrollToAnchor(excerpt)
                          onClose()
                        }}
                        title="定位到正文对应段落"
                      >
                        <MapPin className="size-3" />
                      </Button>
                    )}

                    {/* 架构图谱检视 */}
                    {diagramPayload && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md hover:bg-purple-500/10 text-purple-600 dark:text-purple-400 transition-all"
                        onClick={() => {
                          if (onOpenDiagram) {
                            onOpenDiagram(diagramPayload.diagramId || mark.id)
                          } else {
                            useReaderHudUiStore.getState().setSelectedDiagram(diagramPayload)
                          }
                        }}
                        title="打开架构图谱全屏检视"
                      >
                        <GitFork className="size-3" />
                      </Button>
                    )}

                    {/* 针对本卡片单独发起 AI 智考 */}
                    {excerpt && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md hover:bg-amber-500/10 hover:text-amber-500 transition-all text-muted-foreground"
                        onClick={() => handleLaunchQuiz(mark)}
                        title="针对本张卡片生成深度思考测验"
                      >
                        <GraduationCap className="size-3" />
                      </Button>
                    )}

                    {/* 复制 */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-md hover:bg-muted/80 text-muted-foreground"
                      onClick={() => copySingleCard(mark)}
                      title="复制本卡片内容"
                    >
                      <Copy className="size-3" />
                    </Button>

                    {/* 删除 */}
                    {onDeleteMark && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md hover:bg-destructive/10 hover:text-destructive text-muted-foreground opacity-60 group-hover:opacity-100 transition-all"
                        onClick={() => onDeleteMark(mark.id)}
                        title="删除札记"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* 原文摘录 */}
                {excerpt && (
                  <div
                    onClick={() => {
                      if (onScrollToAnchor) {
                        onScrollToAnchor(excerpt)
                        onClose()
                      }
                    }}
                    className="p-2.5 rounded-lg bg-muted/40 border-l-2 border-primary/60 text-muted-foreground italic text-[11px] leading-relaxed cursor-pointer hover:bg-muted/60 transition-colors"
                    title="点击跳转至正文出处"
                  >
                    "{excerpt}"
                  </div>
                )}

                {/* 研读心得：富文本 Markdown 与 Mermaid 图表 */}
                {displayNote && (
                  <div className="rounded-xl bg-background/50 border border-border/60 p-3 shadow-2xs">
                    <MarkdownContent
                      html={renderAgentMarkdown(normalizeNoteMarkdown(displayNote))}
                      deferMermaid={false}
                      className={cn(
                        'markdown-preview agent-md text-xs leading-relaxed text-foreground min-w-0 max-w-full break-words [overflow-wrap:anywhere]',
                        '[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
                        '[&_h1]:text-sm [&_h1]:font-bold [&_h1]:my-2',
                        '[&_h2]:text-xs [&_h2]:font-bold [&_h2]:my-1.5',
                        '[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:my-1',
                        '[&_blockquote]:my-2 [&_blockquote]:py-1.5 [&_blockquote]:px-3 [&_blockquote]:text-[11px] [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:bg-primary/5 [&_blockquote]:rounded-r-lg',
                        '[&_ul]:my-1.5 [&_ul]:pl-4 [&_ol]:my-1.5 [&_ol]:pl-4 [&_li]:my-0.5',
                        '[&_code]:text-[10px] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:bg-muted/80 [&_code]:rounded',
                        '[&_pre]:my-2 [&_pre]:p-2.5 [&_pre]:text-[10.5px] [&_pre]:rounded-lg [&_pre]:bg-muted/60',
                        '[&_.mermaid]:my-2.5 [&_.mermaid]:overflow-x-auto [&_.mermaid]:rounded-xl [&_.mermaid]:border [&_.mermaid]:border-border/60 [&_.mermaid]:bg-card/90 [&_.mermaid]:p-3 [&_.mermaid]:shadow-xs',
                      )}
                    />
                  </div>
                )}

                {/* 核心概念与要点 Pill */}
                {visibleKeyPoints.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {visibleKeyPoints.map((kp, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bg-primary/10 text-primary border border-primary/20 font-medium"
                      >
                        <Sparkles className="size-2.5 opacity-70" />
                        <span>{kp}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* 架构图谱预览条（若为 diagram 或含独立时序图谱数据） */}
                {diagramPayload && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      if (onOpenDiagram) {
                        onOpenDiagram(diagramPayload.diagramId || mark.id)
                      } else {
                        useReaderHudUiStore.getState().setSelectedDiagram(diagramPayload)
                      }
                    }}
                    className="p-2.5 rounded-lg border border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 transition-colors cursor-pointer flex items-center justify-between gap-2"
                    title="点击全屏沉浸检视架构图谱"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="size-6 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                        <GitFork className="size-3" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold text-foreground truncate block">
                          {diagramPayload.title || '架构交互图谱'}
                        </span>
                        <span className="text-[9.5px] text-muted-foreground font-mono truncate block">
                          {diagramPayload.diagramType} · 点击全屏放大检视
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20"
                    >
                      <Maximize2 className="size-3" />
                    </Button>
                  </div>
                )}

                {/* AI 洞见：富文本 Markdown 渲染 */}
                {(mark.aiSummary || resolved.aiSummary) && (
                  <div className="p-2.5 rounded-lg bg-gradient-to-r from-primary/8 via-primary/4 to-transparent border border-primary/20 text-[11px] text-foreground space-y-1.5">
                    <div className="flex items-center gap-1.5 text-primary font-semibold text-[10.5px]">
                      <Sparkles className="size-3" />
                      <span>AI 精深洞见</span>
                    </div>
                    <MarkdownContent
                      html={renderAgentMarkdown(mark.aiSummary || resolved.aiSummary || '')}
                      className="markdown-preview agent-md text-muted-foreground leading-relaxed text-[10.5px] [&_p]:my-0"
                    />
                  </div>
                )}
              </div>
            )
          })}

          {filteredMarks.length === 0 && (
            <div className="py-20 text-center space-y-2">
              <p className="text-xs text-muted-foreground/70">
                暂无匹配的札记或卡片
              </p>
              <p className="text-[11px] text-muted-foreground/50">
                在阅读中划词选中文本，即可随时添加新卡片
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

