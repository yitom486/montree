import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  GripHorizontal,
  Headphones,
  ListMusic,
  Loader2,
  LocateFixed,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTtsStore } from '@/stores/tts-store'
import { emitTtsHighlight, emitTtsClearHighlight } from '@/lib/reader/marks/mark-linkage'
import { cn } from '@/lib/utils'

interface FloatingTtsPlayerProps {
  onOpenSettings?: () => void
}

export function FloatingTtsPlayer({ onOpenSettings }: FloatingTtsPlayerProps = {}) {
  const {
    isPlayerVisible,
    isPlayerCollapsed,
    playerPosition,
    setIsPlayerCollapsed,
    setPlayerPosition,
    isSpeaking,
    isPaused,
    isLoading,
    currentTitle,
    sentences,
    currentSentenceIndex,
    currentTime,
    duration,
    isFromCache,
    keyUsed,
    rate,
    setRate,
    togglePlayPause,
    seekSentence,
    nextSentence,
    prevSentence,
    syncToViewport,
    closePlayer,
  } = useTtsStore(
    useShallow((s) => ({
      isPlayerVisible: s.isPlayerVisible,
      isPlayerCollapsed: s.isPlayerCollapsed,
      playerPosition: s.playerPosition,
      setIsPlayerCollapsed: s.setIsPlayerCollapsed,
      setPlayerPosition: s.setPlayerPosition,
      isSpeaking: s.isSpeaking,
      isPaused: s.isPaused,
      isLoading: s.isLoading,
      currentTitle: s.currentTitle,
      sentences: s.sentences,
      currentSentenceIndex: s.currentSentenceIndex,
      currentTime: s.currentTime,
      duration: s.duration,
      isFromCache: s.isFromCache,
      keyUsed: s.keyUsed,
      rate: s.rate,
      setRate: s.setRate,
      togglePlayPause: s.togglePlayPause,
      seekSentence: s.seekSentence,
      nextSentence: s.nextSentence,
      prevSentence: s.prevSentence,
      syncToViewport: s.syncToViewport,
      closePlayer: s.closePlayer,
    })),
  )

  const [expandedSentenceList, setExpandedSentenceList] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const currentSentenceRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)

  // 同步持久化坐标：每次启动或更新时自动读取
  useEffect(() => {
    if (playerPosition) {
      setDragPos(playerPosition)
    }
  }, [playerPosition])

  // 监听句子切换高亮正文
  useEffect(() => {
    if (!isPlayerVisible || sentences.length === 0) {
      emitTtsClearHighlight()
      return
    }
    const current = sentences[currentSentenceIndex]
    if (!current?.text) return

    // 1. 列表内部滚到当前句
    if (expandedSentenceList && currentSentenceRef.current) {
      currentSentenceRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }

    // 2. 广播临时高亮事件给专业阅读器（Foliate / PDF / WebDoc）
    emitTtsHighlight(current.text)

    // 3. 通用 DOM 兜底（Markdown 等视图）
    const snippet = current.text.slice(0, 15).trim()
    if (!snippet) return

    const highlightInDoc = (doc: Document) => {
      doc.querySelectorAll('.montree-tts-highlight').forEach((el) => {
        el.classList.remove('montree-tts-highlight')
      })

      const treeWalker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = treeWalker.nextNode())) {
        if (node.textContent && node.textContent.includes(snippet)) {
          const parent = node.parentElement
          if (parent && !parent.classList.contains('montree-tts-highlight')) {
            parent.classList.add('montree-tts-highlight')
            parent.scrollIntoView({ behavior: 'smooth', block: 'center' })
            break
          }
        }
      }
    }

    try {
      highlightInDoc(document)
    } catch {}
  }, [currentSentenceIndex, isPlayerVisible, sentences, expandedSentenceList])

  // 卸载时清除正文标记
  useEffect(() => {
    return () => {
      emitTtsClearHighlight()
    }
  }, [])

  // 原生级 Pointer 拖拽处理：整球响应、边界防飞、松手记忆最新位置
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 展开卡片模式下仅顶部控制手柄允许拖动，按钮点击不启动拖动
    if (!isPlayerCollapsed) {
      const target = e.target as HTMLElement
      if (target.closest('button') || target.closest('input')) {
        return
      }
    }

    const currentElem = containerRef.current
    if (!currentElem) return

    e.preventDefault()
    e.stopPropagation()

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}

    const startX = e.clientX
    const startY = e.clientY

    const currentRect = currentElem.getBoundingClientRect()
    const initialLeft = currentRect.left
    const initialTop = currentRect.top

    let hasMoved = false

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (Math.hypot(dx, dy) > 4) {
        hasMoved = true
        isDraggingRef.current = true
      }

      if (!hasMoved) return

      const width = currentElem.offsetWidth || (isPlayerCollapsed ? 48 : 420)
      const height = currentElem.offsetHeight || (isPlayerCollapsed ? 48 : 180)

      const maxLeft = Math.max(8, window.innerWidth - width - 8)
      const maxTop = Math.max(40, window.innerHeight - height - 8)

      const nextX = Math.max(8, Math.min(maxLeft, initialLeft + dx))
      const nextY = Math.max(40, Math.min(maxTop, initialTop + dy))

      setDragPos({ x: nextX, y: nextY })
    }

    const onPointerUp = (ev: PointerEvent) => {
      try {
        e.currentTarget.releasePointerCapture(ev.pointerId)
      } catch {}

      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)

      if (hasMoved) {
        // 保存并持久化最新位置
        setDragPos((cur) => {
          if (cur) {
            setPlayerPosition(cur)
          }
          return cur
        })
      } else if (isPlayerCollapsed) {
        // 位移极小，判定为点击，展开控制卡片
        setIsPlayerCollapsed(false)
      }

      setTimeout(() => {
        isDraggingRef.current = false
      }, 60)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  if (!isPlayerVisible) return null

  const currentSentence = sentences[currentSentenceIndex]
  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  // 坐标计算：优先使用拖拽或持久化的位置，默认停靠在右上角（top: 76px, right: 28px）
  const positionStyle: React.CSSProperties = dragPos
    ? {
        position: 'fixed',
        left: `${dragPos.x}px`,
        top: `${dragPos.y}px`,
        bottom: 'auto',
        right: 'auto',
      }
    : {
        position: 'fixed',
        top: '76px',
        right: '28px',
        bottom: 'auto',
        left: 'auto',
      }

  // ==================== 1. 悬浮球模式 (Circular Floating Orb) ====================
  if (isPlayerCollapsed) {
    return (
      <div
        ref={containerRef}
        role="region"
        aria-label="语音朗读悬浮小球"
        style={positionStyle}
        onPointerDown={handlePointerDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="z-50 flex items-center select-none cursor-grab active:cursor-grabbing touch-none"
      >
        {/* 悬停微型胶囊指示条（从圆球左侧平滑滑出，带播放/暂停微型按钮与书名） */}
        {isHovered && (
          <div
            className="mr-2 flex items-center gap-2 rounded-full border border-primary/30 bg-background/95 px-3 py-1 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-right-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-full text-foreground hover:text-primary transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                togglePlayPause()
              }}
              title={isSpeaking ? '暂停' : '播放'}
            >
              {isSpeaking ? <Pause className="size-3" /> : <Play className="size-3 ml-0.5" />}
            </button>
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                void syncToViewport()
              }}
              title="对齐到当前屏幕"
            >
              <LocateFixed className="size-3" />
            </button>
            <span className="truncate text-[11px] font-semibold text-foreground max-w-[120px]">
              {currentTitle || '听书中'}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              ({sentences.length > 0 ? `${currentSentenceIndex + 1}/${sentences.length}` : '…'})
            </span>
          </div>
        )}

        {/* 核心圆形小球（48x48 像素，带 SVG 环形进度圈与 Magic UI 呼吸光效） */}
        <div
          className={cn(
            'relative flex size-12 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-background/90 shadow-2xl backdrop-blur-xl transition-transform duration-200 hover:scale-105 active:scale-95',
            isSpeaking && 'ring-2 ring-primary/20',
          )}
          title="点击展开控制面板，按住可任意拖动位置"
        >
          {/* Magic UI 风格：播放时外圈声波脉冲光晕 */}
          {isSpeaking && !isPaused && (
            <span className="absolute -inset-1 rounded-full bg-primary/25 animate-ping opacity-60 pointer-events-none -z-10" />
          )}

          {/* SVG 环形进度条（沿着圆球边缘环绕，周长 132） */}
          <svg className="absolute inset-0 size-full -rotate-90 pointer-events-none" viewBox="0 0 48 48">
            <circle
              cx="24"
              cy="24"
              r="21"
              fill="none"
              className="stroke-muted/30"
              strokeWidth="2.5"
            />
            <circle
              cx="24"
              cy="24"
              r="21"
              fill="none"
              className="stroke-primary transition-all duration-300 ease-out"
              strokeWidth="2.5"
              strokeDasharray="132"
              strokeDashoffset={132 - (progressPercent / 100) * 132}
              strokeLinecap="round"
            />
          </svg>

          {/* 球心状态：加载态 / 动态音波条 / 静态耳机图标（全部 pointer-events-none，拖拽绝不拦截） */}
          <div className="pointer-events-none flex items-center justify-center">
            {isLoading ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : isSpeaking && !isPaused ? (
              /* 3 根跳动的律动音频微柱 */
              <div className="flex items-center justify-center gap-0.5 h-3.5">
                <span className="w-0.5 rounded-full bg-primary animate-pulse h-2" />
                <span className="w-0.5 rounded-full bg-primary animate-pulse h-3.5 delay-75" />
                <span className="w-0.5 rounded-full bg-primary animate-pulse h-2.5 delay-150" />
              </div>
            ) : (
              <Headphones className="size-4 text-primary/80" />
            )}
          </div>
        </div>
      </div>
    )
  }

  // ==================== 2. 展开控制面板卡片 (Expanded Card) ====================
  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="语音朗读播放器"
      style={positionStyle}
      className="z-50 flex w-[430px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border/80 bg-background/95 shadow-2xl backdrop-blur-xl transition-all animate-in fade-in zoom-in-95 duration-200"
    >
      {/* 顶部标题与拖拽栏 */}
      <div
        onPointerDown={handlePointerDown}
        className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3.5 py-2 select-none cursor-grab active:cursor-grabbing touch-none"
        title="按住手柄自由拖拽移动播放器"
      >
        <div className="flex min-w-0 items-center gap-2">
          {/* 拖动手柄 */}
          <GripHorizontal className="size-4 shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />

          <div
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full transition-colors',
              isSpeaking
                ? 'bg-primary/20 text-primary animate-pulse'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <Headphones className="size-3.5" />
          </div>

          <div className="min-w-0">
            <h4 className="truncate text-xs font-semibold text-foreground max-w-[170px]">
              {currentTitle || '语音朗读'}
            </h4>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {isLoading ? (
                <span className="flex items-center gap-1 text-primary">
                  <Loader2 className="size-2.5 animate-spin" />
                  合成中…
                </span>
              ) : isFromCache ? (
                <span className="flex items-center gap-0.5 text-emerald-500 font-medium">
                  <Zap className="size-2.5 fill-emerald-500" />
                  本地磁盘秒开缓存
                </span>
              ) : keyUsed === 'secondary' ? (
                <span className="flex items-center gap-0.5 text-amber-500 font-medium">
                  <Sparkles className="size-2.5" />
                  备用 Key 接管容灾
                </span>
              ) : keyUsed === 'primary' ? (
                <span className="flex items-center gap-0.5 text-primary font-medium">
                  <Sparkles className="size-2.5" />
                  智能云端 TTS
                </span>
              ) : (
                <span>系统原生离线语音</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {onOpenSettings && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={onOpenSettings}
              title="语音设置（Google / 微软 Azure / 本地 OpenAI / 容灾）"
            >
              <Settings className="size-3.5" />
            </Button>
          )}

          {/* 一键同步对齐当前屏幕可见文本 */}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            onClick={() => void syncToViewport()}
            title="将朗读进度立即对齐到当前屏幕可见正文（跟随当前页面）"
          >
            <LocateFixed className="size-3.5" />
          </Button>

          {/* 全句列表抽屉切换 */}
          <Button
            variant={expandedSentenceList ? 'secondary' : 'ghost'}
            size="icon"
            className={cn(
              'size-6 cursor-pointer transition-colors',
              expandedSentenceList
                ? 'bg-primary/15 text-primary hover:bg-primary/20'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setExpandedSentenceList(!expandedSentenceList)}
            title={expandedSentenceList ? '收起句子列表' : '自由选择需要读取的位置（全句列表）'}
          >
            <ListMusic className="size-3.5" />
          </Button>

          {/* 收起为圆形悬浮球 */}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => setIsPlayerCollapsed(true)}
            title="收起为圆形小球（不遮挡正文）"
          >
            <Minimize2 className="size-3.5" />
          </Button>

          {/* 关闭朗读 */}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-destructive cursor-pointer"
            onClick={closePlayer}
            title="关闭朗读"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 当前句子高亮视窗 */}
      <div className="relative border-b border-border/50 bg-gradient-to-b from-transparent to-muted/20 px-4 py-3">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground/80">
              当前句 ({sentences.length > 0 ? currentSentenceIndex + 1 : 0} / {sentences.length})
            </span>
            <span className="text-muted-foreground/60">•</span>
            <span>从当前页面顶部自适应起读</span>
          </div>
          <span className="font-mono text-[10px]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <p className="min-h-12 text-sm font-medium leading-relaxed text-foreground select-text transition-all duration-200">
          {isLoading ? (
            <span className="text-muted-foreground italic flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              正在通过智能音频引擎合成章节语音…
            </span>
          ) : currentSentence ? (
            <span className="rounded bg-primary/10 px-1 py-0.5 text-primary font-semibold decoration-primary/30">
              {currentSentence.text}
            </span>
          ) : (
            <span className="text-muted-foreground">暂无正文</span>
          )}
        </p>

        {/* 细进度条 */}
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-150"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 自由选择需要读取的位置：展开的全句列表抽屉 */}
      {expandedSentenceList && (
        <div className="max-h-56 overflow-y-auto border-b border-border/50 p-2 text-xs divide-y divide-border/30 bg-muted/15">
          <div className="px-2 py-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>点击任意句子直接跳转朗读：</span>
            <button
              type="button"
              className="text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
              onClick={() => void syncToViewport()}
              title="根据当前阅读屏幕位置定位"
            >
              <LocateFixed className="size-3" />
              定位到当前屏幕
            </button>
          </div>
          {sentences.map((s, idx) => (
            <div
              key={s.id}
              ref={idx === currentSentenceIndex ? currentSentenceRef : null}
              onClick={() => seekSentence(idx)}
              className={cn(
                'flex items-start gap-2 p-1.5 rounded-lg cursor-pointer transition-colors',
                idx === currentSentenceIndex
                  ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <span className="shrink-0 text-[10px] opacity-70 w-6 text-right mt-0.5 font-mono">
                {idx + 1}.
              </span>
              <span className="flex-1 leading-snug line-clamp-2">{s.text}</span>
              {idx === currentSentenceIndex && (
                <Volume2 className="size-3.5 shrink-0 text-primary animate-pulse mt-0.5" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* 底部播放控制操作台 */}
      <div className="flex items-center justify-between bg-background px-4 py-2.5">
        {/* 语速调节快捷按钮 */}
        <div className="flex items-center gap-1">
          {[0.8, 1.0, 1.25, 1.5].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer',
                rate === r
                  ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {r}x
            </button>
          ))}
        </div>

        {/* 核心三键（上一句、播放/暂停、下一句） */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            disabled={currentSentenceIndex <= 0 || isLoading}
            onClick={prevSentence}
            className="size-8 rounded-full cursor-pointer hover:bg-muted"
            title="上一句"
          >
            <SkipBack className="size-4" />
          </Button>

          <Button
            variant="default"
            size="icon"
            disabled={isLoading || sentences.length === 0}
            onClick={togglePlayPause}
            className="size-9 rounded-full shadow-md cursor-pointer"
            title={isSpeaking ? '暂停' : '播放'}
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isSpeaking ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4 ml-0.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            disabled={currentSentenceIndex >= sentences.length - 1 || isLoading}
            onClick={nextSentence}
            className="size-8 rounded-full cursor-pointer hover:bg-muted"
            title="下一句"
          >
            <SkipForward className="size-4" />
          </Button>
        </div>

        {/* 重播本句 */}
        <Button
          variant="ghost"
          size="icon"
          disabled={isLoading || sentences.length === 0}
          onClick={() => seekSentence(currentSentenceIndex)}
          className="size-7 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
          title="重播当前句"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
