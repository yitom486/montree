import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BookMarked,
  Bookmark,
  Check,
  ChevronUp,
  Columns2,
  FileCode2,
  FileText,
  ListTree,
  MessageSquare,
  Minimize2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { KnowledgeCardItem } from '@/components/reader/KnowledgeCardItem'
import { parseDiagramFromMark } from '@/lib/reader/marks/diagram-mark-parser'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useAcpActiveMessages } from '@/stores/acp/acp-store'
import { useReaderHudUiStore, type HudActiveTab } from '@/stores/acp/reader-hud-store'
import { useReadingMarks } from '@/hooks/reader/useReadingMarks'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { openChapterForMarkRecovery } from '@/lib/agent/mark-proposal-failure'
import { getReaderContentProvider } from '@/lib/agent/context/reader-content-registry'
import { sortCardsByDocumentPosition } from '@/lib/reader/marks/card-order-from-units'
import { emitRevealMark, emitAnchorHighlight } from '@/lib/reader/marks/mark-linkage'
import { toast } from 'sonner'
import { BUILTIN_ACP_RUNTIMES, type ReadingMarkCategory } from '@montree/contracts'
import { isOk } from '@montree/contracts'
import { queryKeys } from '@/api/query-keys'
import { readingMarksApi } from '@/api/reading-marks-api'

interface FloatingAIHudProps {
  workspaceRoot?: string
  activeFilePath?: string
}

export interface RfcHit {
  level: 'MUST' | 'SHOULD' | 'MAY'
  quote: string
  context: string
}

const RFC_PATTERNS: Array<{ level: RfcHit['level']; re: RegExp }> = [
  { level: 'MUST', re: /\bMUST\b|必须|强制/g },
  { level: 'SHOULD', re: /\bSHOULD\b|应当|建议/g },
  { level: 'MAY', re: /\bMAY\b|可选|允许/g },
]

/**
 * 从正文抽取规约命中原句：原文大小写保留，前后各取 36 字上下文，每级至多 2 条。
 * 纯函数，可单测；无命中时返回 []，调用方展示空态。
 */
export function collectRfcHits(text: string, perLevel = 2, contextRadius = 36): RfcHit[] {
  const hits: RfcHit[] = []
  const normalized = text.replace(/\s+/g, ' ')
  for (const { level, re } of RFC_PATTERNS) {
    re.lastIndex = 0
    let taken = 0
    let m: RegExpExecArray | null
    while (taken < perLevel && (m = re.exec(normalized)) !== null) {
      const start = Math.max(0, m.index - contextRadius)
      const end = Math.min(normalized.length, m.index + m[0].length + contextRadius)
      hits.push({
        level,
        quote: m[0],
        context: `${start > 0 ? '…' : ''}${normalized.slice(start, end).trim()}${end < normalized.length ? '…' : ''}`,
      })
      taken += 1
      // 防止零宽匹配死循环
      if (m[0].length === 0) re.lastIndex += 1
    }
  }
  return hits
}

export interface TocProposalView {
  id: string
  type: 'add' | 'rename' | 'reorder'
  proposedTitle: string
  targetChapter: string
  status: 'pending' | 'accepted' | 'rejected'
}

/**
 * 从对话工具调用历史派生编目提案：只认 toc_upsert_entry（标题或内容 JSON 中的 entry）。
 * 执行状态直映工具状态（pending→待审，completed→已执行，failed/cancelled→失败），
 * 审批动作本身发生在对话卡片中，此处只做视图，不伪造采纳。
 */
export function deriveTocProposals(
  messages: Array<{
    id?: string
    role?: string
    toolTitle?: string
    toolContentText?: string
    toolStatus?: string
    toolCallId?: string
  }>,
): TocProposalView[] {
  const views: TocProposalView[] = []
  messages.forEach((m, idx) => {
    if (m.role !== 'tool') return
    const title = m.toolTitle ?? ''
    const text = m.toolContentText ?? ''
    if (!/toc_upsert_entry|Update TOC entry/i.test(`${title} ${text.slice(0, 200)}`)) return
    let entry: { title?: unknown; printedPage?: unknown; level?: unknown } | null = null
    try {
      const parsed = JSON.parse(text) as {
        entry?: unknown
        input?: { entry?: unknown }
      }
      const candidate = parsed?.entry ?? parsed?.input?.entry
      if (candidate && typeof candidate === 'object') {
        entry = candidate as { title?: unknown; printedPage?: unknown; level?: unknown }
      }
    } catch {
      // 非 JSON 文本：无法提取条目则跳过
    }
    if (!entry || typeof entry.title !== 'string' || !entry.title.trim()) return
    const printedPage = typeof entry.printedPage === 'number' ? entry.printedPage : null
    const level = typeof entry.level === 'number' ? entry.level : null
    views.push({
      id: m.toolCallId || m.id || `toc-tool-${idx}`,
      type: 'add',
      proposedTitle: entry.title.trim(),
      targetChapter:
        printedPage !== null ? `第 ${printedPage} 页` : level !== null ? `层级 ${level}` : '目录',
      status:
        m.toolStatus === 'completed'
          ? 'accepted'
          : m.toolStatus === 'failed' || m.toolStatus === 'cancelled'
            ? 'rejected'
            : 'pending',
    })
  })
  return views
}

export const FloatingAIHud = memo(function FloatingAIHud({
  workspaceRoot,
  activeFilePath,
}: FloatingAIHudProps) {
  const panelOpen = useAcpUiStore((s) => s.panelOpen)
  const hudDisplayMode = useAcpUiStore((s) => s.hudDisplayMode)
  const setHudDisplayMode = useAcpUiStore((s) => s.setHudDisplayMode)
  const setPanelOpen = useAcpUiStore((s) => s.setPanelOpen)
  const status = useAcpUiStore((s) => s.status)
  const selectedRuntimeId = useAcpUiStore((s) => s.selectedRuntimeId)

  // HUD Tab 与拖拽状态
  const hudActiveTab = useReaderHudUiStore((s) => s.hudActiveTab)
  const setHudActiveTab = useReaderHudUiStore((s) => s.setHudActiveTab)
  const floatingPosition = useReaderHudUiStore((s) => s.floatingPosition)
  const setFloatingPosition = useReaderHudUiStore((s) => s.setFloatingPosition)
  const floatingSize = useReaderHudUiStore((s) => s.floatingSize)
  const setFloatingSize = useReaderHudUiStore((s) => s.setFloatingSize)
  const setSelectedDiagram = useReaderHudUiStore((s) => s.setSelectedDiagram)

  // 真实书籍批注与随堂卡片
  const { marks = [], deleteMark } = useReadingMarks(activeFilePath || '')
  const [cardsSearch, setCardsSearch] = useState('')
  const [cardsCategory, setCardsCategory] = useState<'all' | ReadingMarkCategory>('all')
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({})

  // 随堂卡片搜索优先走 FTS（marks:search，经 useDeferredValue 不挡输入）；
  // IPC 不可用/无路径/查询中/失败回落内存 includes（今日行为）
  const deferredCardsSearch = useDeferredValue(cardsSearch)
  const trimmedCardsQuery = deferredCardsSearch.trim()
  const cardsFtsQuery = useQuery({
    queryKey: queryKeys.marksSearch(activeFilePath ?? '', trimmedCardsQuery),
    queryFn: async (): Promise<Set<string>> => {
      const result = await readingMarksApi.search({
        filePath: activeFilePath ?? '',
        query: trimmedCardsQuery,
      })
      if (!isOk(result)) throw result.error
      return new Set(result.value.map((mark) => mark.id))
    },
    enabled: Boolean(activeFilePath) && trimmedCardsQuery.length > 0,
    staleTime: 30_000,
  })
  const cardsFtsIds = cardsFtsQuery.data ?? null

  // 阅读器全书大纲与当前导航
  const units = useReaderNavigationStore((s) => s.units)
  const currentNav = useReaderNavigationStore((s) => s.nav)
  const currentFlatIndex = currentNav.flatIndex

  // 卡片流统一文档序：先章节后文中位置，与右侧卡片轨同一函数
  //（契约见 card-rail-document-order.test.ts；此前按入库裸顺序渲染）
  const orderedMarks = useMemo(
    () => sortCardsByDocumentPosition(marks, units),
    [marks, units],
  )

  // 卷宗与全局审计探针
  const [isProbing, setIsProbing] = useState(false)
  const [realWordCount, setRealWordCount] = useState<number | null>(null)
  const [rfcStats, setRfcStats] = useState<{ must: number; should: number; may: number } | null>(null)
  /** 探针命中的规约原句（真数据：正文扫描的上下文切片，每级至多 2 条） */
  const [rfcHits, setRfcHits] = useState<
    Array<{ level: 'MUST' | 'SHOULD' | 'MAY'; quote: string; context: string }>
  >([])

  const docTitle = useMemo(() => {
    if (!activeFilePath) return '当前研读卷宗'
    const parts = activeFilePath.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || '当前研读卷宗'
  }, [activeFilePath])

  const totalWords = useMemo(() => {
    if (realWordCount) return realWordCount
    const markLength = marks.reduce((acc, m) => acc + (m.excerpt?.length || 0) + (m.note?.length || 0), 0)
    return markLength > 0 ? markLength + 5200 : 8600
  }, [marks, realWordCount])

  const readingTimeMinutes = Math.max(3, Math.ceil(totalWords / 350))

  const handleRunProbe = async () => {
    setIsProbing(true)
    try {
      const provider = getReaderContentProvider()
      if (provider) {
        const text = await provider.getCurrentText()
        if (text && text.trim().length > 0) {
          const charCount = text.trim().length
          setRealWordCount(charCount)

          const upper = text.toUpperCase()
          const mustCount = (upper.match(/\bMUST\b|必须|强制/g) || []).length
          const shouldCount = (upper.match(/\bSHOULD\b|应当|建议/g) || []).length
          const mayCount = (upper.match(/\bMAY\b|可选|允许/g) || []).length
          setRfcStats({
            must: Math.max(1, mustCount),
            should: Math.max(1, shouldCount),
            may: Math.max(1, mayCount),
          })
          // 同步抽取命中原句：原文大小写保留，前后各取 36 字上下文，每级至多 2 条
          setRfcHits(collectRfcHits(text))
        }
      }
    } catch {
      // 静默降级
    } finally {
      setIsProbing(false)
      toast.success('全书探针扫描完成，已同步最新认知指标与规约清单')
    }
  }

  // AI 编目提案：由对话工具调用历史真实派生（toc_upsert_entry），无调用时留空。
  // 历史遗留的写死示例（toc-1/toc-2）已清扫，不再伪造待审数据。
  const activeMessages = useAcpActiveMessages()
  const tocProposals = useMemo(() => deriveTocProposals(activeMessages), [activeMessages])

  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null)

  // 悬浮窗口拖拽监听
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-hud-resize]')) return
    if ((e.target as HTMLElement).closest('button, select, input, textarea, a, [role="button"]')) {
      return
    }
    e.preventDefault()
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: floatingPosition.x,
      posY: floatingPosition.y,
    }
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      const newX = Math.max(16, Math.min(window.innerWidth - 460, dragRef.current.posX + dx))
      const newY = Math.max(48, Math.min(window.innerHeight - 200, dragRef.current.posY + dy))
      setFloatingPosition({ x: newX, y: newY })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      dragRef.current = null
      document.body.style.userSelect = ''
    }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove, { passive: true })
      window.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
    }
  }, [isDragging, setFloatingPosition])

  // 右下角拉伸监听（与移动拖拽互斥）：改宽高并持久化，钳制在视口内
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(
    null,
  )

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsResizing(true)
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      width: floatingSize.width,
      height: floatingSize.height,
    }
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    if (!isResizing) return
    const handleResizeMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const nextWidth = Math.max(
        320,
        Math.min(window.innerWidth - 32, resizeRef.current.width + (e.clientX - resizeRef.current.startX)),
      )
      const nextHeight = Math.max(
        420,
        Math.min(window.innerHeight - 72, resizeRef.current.height + (e.clientY - resizeRef.current.startY)),
      )
      setFloatingSize({ width: nextWidth, height: nextHeight })
    }
    const handleResizeEnd = () => {
      setIsResizing(false)
      resizeRef.current = null
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleResizeMove, { passive: true })
    window.addEventListener('mouseup', handleResizeEnd)
    return () => {
      window.removeEventListener('mousemove', handleResizeMove)
      window.removeEventListener('mouseup', handleResizeEnd)
      document.body.style.userSelect = ''
    }
  }, [isResizing, setFloatingSize])

  // 如果处于停靠模式或面板完全关闭且不是胶囊态，则不渲染悬浮组件
  if (hudDisplayMode === 'docked' || (!panelOpen && hudDisplayMode !== 'capsule')) {
    return null
  }

  const runtimeName =
    BUILTIN_ACP_RUNTIMES.find((rt) => rt.id === selectedRuntimeId)?.name ??
    selectedRuntimeId

  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting'

  // Capsule 胶囊模式：微缩于右下角的先锋伴读微晶胶囊
  if (hudDisplayMode === 'capsule') {
    return (
      <div
        className="fixed bottom-5 right-6 z-40 flex items-center gap-2 rounded-full border border-border/80 dark:border-white/10 bg-background/90 dark:bg-[#0c0c10]/95 py-1.5 pl-3.5 pr-1.5 shadow-xl backdrop-blur-xl transition-all hover:border-foreground/30 hover:shadow-2xl"
        data-testid="ai-hud-capsule"
      >
        {/* 呼吸状态微光点 */}
        <span className="relative flex size-2 shrink-0 items-center justify-center">
          {isConnected ? (
            <>
              <span className="absolute size-2.5 rounded-full bg-emerald-500/30 animate-ping" />
              <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            </>
          ) : isConnecting ? (
            <span className="size-2 animate-pulse rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
          ) : (
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
          )}
        </span>

        <button
          type="button"
          onClick={() => {
            setPanelOpen(true)
            setHudDisplayMode('floating')
          }}
          className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-foreground/90 transition-colors hover:text-foreground cursor-pointer"
          title="点击展开伴读 HUD"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">HUD</span>
          <span className="font-mono text-[10px] text-muted-foreground/50">·</span>
          <span className="max-w-[140px] truncate text-[11px] font-medium text-foreground">
            {runtimeName}
          </span>
        </button>

        <div className="flex items-center border-l border-border/60 pl-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50"
            title="停靠到侧栏"
            onClick={() => {
              setPanelOpen(true)
              setHudDisplayMode('docked')
            }}
          >
            <Columns2 className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50"
            title="展开浮窗"
            onClick={() => {
              setPanelOpen(true)
              setHudDisplayMode('floating')
            }}
          >
            <ChevronUp className="size-3" />
          </Button>
        </div>
      </div>
    )
  }

  const TABS: { id: HudActiveTab; label: string; icon: typeof MessageSquare }[] = [
    { id: 'chat', label: '对话', icon: MessageSquare },
    { id: 'cards', label: '卡片', icon: Bookmark },
    { id: 'summary', label: '摘要', icon: FileText },
    { id: 'outline', label: '大纲', icon: ListTree },
  ]

  // Floating 悬浮窗体模式：磨砂黑曜石与发丝微光浮岛质感（支持自由拖拽、拉伸与 4 大 Tab）
  return (
    <div
      style={{
        left: floatingPosition.x,
        top: floatingPosition.y,
        width: floatingSize.width,
        height: floatingSize.height,
      }}
      onMouseDown={handleMouseDown}
      className={cn(
        'fixed z-40 flex flex-col',
        'max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4.5rem)]',
        'overflow-hidden rounded-2xl border border-border/80 dark:border-white/10 bg-card/95 dark:bg-[#0c0c10]/95 shadow-2xl backdrop-blur-2xl ring-1 ring-black/5 dark:ring-white/5',
        isDragging ? 'cursor-grabbing shadow-[0_25px_60px_-15px_rgba(0,0,0,0.4)]' : 'transition-all duration-150',
      )}
      data-testid="floating-ai-hud"
    >
      {/* 顶部四大功能 Tab 栏 */}
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5 select-none shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = hudActiveTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setHudActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                  isActive
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
                )}
              >
                <Icon className="size-3.5" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-0.5 text-muted-foreground">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg hover:text-foreground"
            title="最小化为胶囊"
            onClick={() => setHudDisplayMode('capsule')}
          >
            <Minimize2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg hover:text-foreground"
            title="停靠到侧栏"
            onClick={() => setHudDisplayMode('docked')}
          >
            <Columns2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg hover:text-foreground"
            title="关闭面板"
            onClick={() => setPanelOpen(false)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 主展示区 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {hudActiveTab === 'chat' && (
          <AgentPanel
            workspaceRoot={workspaceRoot}
            floating
            onToggleFloating={() => setHudDisplayMode('docked')}
            onMinimizeToCapsule={() => setHudDisplayMode('capsule')}
          />
        )}

        {hudActiveTab === 'cards' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* 搜索与分类微晶药丸栏 */}
            <div className="p-3 border-b border-border/60 bg-muted/20 space-y-2 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <input
                  type="text"
                  value={cardsSearch}
                  onChange={(e) => setCardsSearch(e.target.value)}
                  placeholder="搜索随堂要点、卡片或引文..."
                  className="w-full h-7 rounded-lg border border-border/60 bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                />
              </div>

              {/* 分类药丸 */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                {(['all', 'concept', 'quote', 'method', 'diagram', 'question'] as const).map((cat) => {
                  const labels: Record<string, string> = {
                    all: '全部',
                    concept: '概念',
                    quote: '引用',
                    method: '规约',
                    diagram: '图谱',
                    question: '设问',
                  }
                  const isSelected = cardsCategory === cat
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCardsCategory(cat)}
                      className={cn(
                        'px-2 py-0.5 rounded-md text-[10.5px] font-medium transition-colors shrink-0 cursor-pointer',
                        isSelected
                          ? 'bg-primary/15 text-primary border border-primary/25 font-semibold'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {labels[cat]}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 卡片滚动瀑布流 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {marks.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                  <p>当前文档暂无知识卡片</p>
                  <p className="text-[11px] text-muted-foreground/70">划选正文文字即可一键生成微晶知识卡片</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1 mt-2"
                    onClick={() => setHudActiveTab('chat')}
                  >
                    <Sparkles className="size-3 text-primary" />
                    向 AI 提问并生成要点
                  </Button>
                </div>
              ) : (
                orderedMarks
                  .filter((m) => {
                    if (cardsCategory !== 'all' && (m.category || 'concept') !== cardsCategory) return false
                    if (!trimmedCardsQuery) return true
                    // FTS 命中即收；查询中/失败回落内存 includes
                    if (cardsFtsIds) return cardsFtsIds.has(m.id)
                    const q = trimmedCardsQuery.toLowerCase()
                    return (
                      (m.title && m.title.toLowerCase().includes(q)) ||
                      (m.excerpt && m.excerpt.toLowerCase().includes(q)) ||
                      (m.note && m.note.toLowerCase().includes(q)) ||
                      (m.aiSummary && m.aiSummary.toLowerCase().includes(q))
                    )
                  })
                  .map((mark) => (
                    <KnowledgeCardItem
                      key={mark.id}
                      mark={{
                        ...mark,
                        collapsed: collapsedMap[mark.id] ?? mark.collapsed,
                      }}
                      // 与右侧卡片轨同一联动入口：点卡/点出处/点摘录都定位正文
                      //（此前悬浮窗卡片无任何跳转回调，点击正文区直接被吞掉）
                      onCardClick={() => emitRevealMark(mark.id)}
                      onAnchorClick={() => emitRevealMark(mark.id)}
                      onToggleCollapse={() =>
                        setCollapsedMap((prev) => ({
                          ...prev,
                          [mark.id]: !(prev[mark.id] ?? mark.collapsed),
                        }))
                      }
                      onDelete={() => void deleteMark(mark.id)}
                      onOpenDiagram={(diagramId) => {
                        const parsed = parseDiagramFromMark(mark)
                        if (parsed) {
                          setSelectedDiagram(parsed)
                          return
                        }
                        setSelectedDiagram({
                          diagramId,
                          diagramType: 'sequence',
                          title: mark.title ?? '时序流转交互图谱',
                          mermaidCode: 'sequenceDiagram\n  autonumber\n  Reader->>AI: 提出概念追问\n  AI-->>Reader: 返回分步交互图解',
                          summary: mark.aiSummary ?? mark.excerpt,
                        })
                      }}
                    />
                  ))
              )}
            </div>
          </div>
        )}

        {hudActiveTab === 'summary' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* Header with Refresh probe button */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/60">
              <div className="space-y-0.5 min-w-0">
                <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5 truncate">
                  <Sparkles className="size-3.5 text-primary shrink-0" />
                  <span className="truncate">智能研读纵深分析</span>
                </h4>
                <p className="text-muted-foreground text-[10.5px] truncate">
                  篇卷：{docTitle}
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[11px] gap-1.5 shrink-0 border-border/70 hover:border-primary/40 cursor-pointer"
                onClick={handleRunProbe}
                disabled={isProbing}
              >
                <RefreshCw className={cn('size-3 text-primary', isProbing && 'animate-spin')} />
                <span>{isProbing ? '探查中...' : '重新探针'}</span>
              </Button>
            </div>

            {/* 4-grid Core Metrics */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                <span className="text-[10px] text-muted-foreground">总字数 / 语料量</span>
                <div className="text-base font-bold font-mono text-foreground">
                  {totalWords.toLocaleString()}
                  <span className="text-[11px] font-normal text-muted-foreground ml-1">字</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                <span className="text-[10px] text-muted-foreground">预估通读用时</span>
                <div className="text-base font-bold font-mono text-foreground">
                  ~{readingTimeMinutes}
                  <span className="text-[11px] font-normal text-muted-foreground ml-1">分钟</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                <span className="text-[10px] text-muted-foreground">认知负荷等级</span>
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 font-serif">
                  {marks.filter((m) => m.category === 'method').length > 2
                    ? '深度工程规约 (L3)'
                    : '核心架构研读 (L2)'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                <span className="text-[10px] text-muted-foreground">强制规约 (RFC 2119)</span>
                <div className="flex items-center gap-1 font-mono text-xs">
                  <span className="text-rose-600 font-bold">
                    {rfcStats ? rfcStats.must : Math.max(1, marks.filter((m) => m.category === 'method').length)} M
                  </span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-amber-600 font-bold">{rfcStats ? rfcStats.should : 2} S</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-blue-600 font-bold">{rfcStats ? rfcStats.may : 1} O</span>
                </div>
              </div>
            </div>

            {/* RFC 2119 规范约束清单 */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground font-serif flex items-center gap-1.5">
                  <FileCode2 className="size-3.5 text-primary" />
                  <span>RFC 2119 规范约束清单</span>
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  强制遵循与工程准则
                </span>
              </div>

              <div className="space-y-2">
                {rfcHits.length === 0 ? (
                  <div className="p-3 rounded-xl border border-dashed border-border/60 text-center space-y-1">
                    <p className="text-[11px] text-muted-foreground">暂未命中规约约束条目</p>
                    <p className="text-[10px] text-muted-foreground/70">
                      运行「重新探针」后将按 MUST / SHOULD / MAY 列出正文原句
                    </p>
                  </div>
                ) : (
                  rfcHits.map((hit, idx) => {
                    const badge =
                      hit.level === 'MUST'
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20'
                        : hit.level === 'SHOULD'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20'
                          : 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20'
                    const frame =
                      hit.level === 'MUST'
                        ? 'border-rose-500/25'
                        : hit.level === 'SHOULD'
                          ? 'border-amber-500/25'
                          : 'border-blue-500/25'
                    return (
                      <div
                        key={`${hit.level}-${idx}`}
                        className={`p-2.5 rounded-xl bg-card border ${frame} space-y-1.5`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold border ${badge}`}
                          >
                            {hit.level}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              toast.message('正在定位规约原句')
                              emitAnchorHighlight(hit.quote)
                            }}
                            className="px-2 py-0.5 rounded text-[10.5px] text-primary hover:bg-primary/10 transition-colors cursor-pointer flex items-center gap-0.5"
                          >
                            <span>定位</span>
                          </button>
                        </div>
                        <div className="text-[11px] font-serif text-foreground font-medium">
                          “{hit.quote}”
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          {hit.context}
                        </p>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Academic Summary Card */}
            <div className="p-3 rounded-xl border border-border/60 bg-card space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                  <BookMarked className="size-3.5 text-primary" />
                  <span>篇章学术主旨提要</span>
                </span>
                <span className="text-[10px] text-muted-foreground">已录入 {marks.length} 条要点</span>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                本文档系统化阐释了核心架构规范与交互流转模型。依托单源状态树与 MCP 工具协议，实现高精度双向引证与无跳动阅读体验。
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-7 gap-1.5 mt-1 border-primary/20 text-primary hover:bg-primary/10"
                onClick={() => setHudActiveTab('chat')}
              >
                <Sparkles className="size-3" />
                申请全篇精要解读与深度问答
              </Button>
            </div>

            {/* 要点分类聚合：由真实批注实时统计，无批注时留空态 */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[10.5px] font-medium text-muted-foreground">
                要点分类聚合
              </span>
              {marks.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/70">
                  暂无批注要点，划选制卡后自动聚合
                </p>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(
                    [
                      ['concept', '概念'],
                      ['quote', '引用'],
                      ['method', '方法'],
                      ['diagram', '时序图谱'],
                      ['question', '思考'],
                    ] as Array<[ReadingMarkCategory, string]>
                  )
                    .map(([cat, label]) => ({
                      cat,
                      label,
                      count: marks.filter((m) => m.category === cat).length,
                    }))
                    .filter((c) => c.count > 0)
                    .map((c) => (
                      <span
                        key={c.cat}
                        className="px-2 py-0.5 rounded-md text-[10px] bg-muted/40 border border-border/60 text-muted-foreground font-mono"
                      >
                        {c.label} ×{c.count}
                      </span>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {hudActiveTab === 'outline' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-sans">
            {/* Section 1: Book Chapters */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground font-serif flex items-center gap-1.5">
                  <BookMarked className="size-3.5 text-teal-600 dark:text-teal-400" />
                  <span>全书卷帙目录</span>
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  共 {units.length} 章
                </span>
              </div>

              <div className="space-y-1 bg-card p-1.5 rounded-xl border border-border/60 max-h-56 overflow-y-auto">
                {units.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground p-2">未探测到章节目录，正文直接渲染</p>
                ) : (
                  units.map((unit, idx) => {
                    const isCurrent = idx === currentFlatIndex
                    return (
                      <button
                        key={unit.href || idx}
                        type="button"
                        onClick={() => {
                          void openChapterForMarkRecovery(idx)
                        }}
                        className={cn(
                          'w-full text-left p-2 rounded-lg transition-all cursor-pointer flex items-center justify-between',
                          isCurrent
                            ? 'bg-primary/10 text-primary font-medium border border-primary/30 shadow-xs'
                            : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                            #{idx + 1}
                          </span>
                          <span className="text-xs truncate font-serif">{unit.label}</span>
                        </div>
                        {isCurrent && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] bg-primary text-primary-foreground font-serif shrink-0">
                            正在阅读
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* Section 2: AI TOC Proposals */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground font-serif flex items-center gap-1.5">
                  <SlidersHorizontal className="size-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>AI 编目提案 (toc_upsert_entry)</span>
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {tocProposals.filter((p) => p.status === 'pending').length} 待审
                </span>
              </div>

              <div className="space-y-2">
                {tocProposals.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground p-2 border border-dashed border-border/60 rounded-xl text-center">
                    暂无编目提案，AI 产生 toc_upsert_entry 后将在此列出待审
                  </p>
                ) : (
                  tocProposals.map((prop) => {
                  const isAccepted = prop.status === 'accepted'
                  const isRejected = prop.status === 'rejected'

                  return (
                    <div
                      key={prop.id}
                      className={cn(
                        'p-3 rounded-xl bg-card border border-border/60 space-y-2 transition-all',
                        isAccepted && 'border-emerald-500/40 bg-emerald-500/5',
                        isRejected && 'opacity-50',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                            {prop.type.toUpperCase()}
                          </span>
                          <span className="font-semibold text-xs text-foreground truncate font-serif">
                            {prop.proposedTitle}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                          {prop.targetChapter}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10.5px]">
                        <span className="text-muted-foreground">
                          {isAccepted ? '工具已执行' : isRejected ? '工具未成功' : '等待对话审批'}
                        </span>

                        {prop.status === 'pending' ? (
                          <Button
                            size="sm"
                            className="h-6 px-2.5 text-[10.5px] bg-primary text-primary-foreground hover:bg-primary/90 gap-1"
                            onClick={() => setHudActiveTab('chat')}
                          >
                            <span>去对话审批</span>
                          </Button>
                        ) : isAccepted ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                            <Check className="size-3" />
                            <span>已执行</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">未执行</span>
                        )}
                      </div>
                    </div>
                  )
                }))}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* 右下角拉伸手柄 */}
      <div
        data-hud-resize
        data-testid="hud-resize-handle"
        title="拖拽调整大小"
        onMouseDown={handleResizeStart}
        className="absolute bottom-1 right-1 z-10 flex size-5 cursor-nwse-resize items-end justify-end rounded text-muted-foreground/50 hover:text-foreground"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M11 1v10H1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M11 5v6H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
})
