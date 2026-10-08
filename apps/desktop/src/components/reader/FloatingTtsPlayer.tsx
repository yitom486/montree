import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  GripHorizontal,
  Headphones,
  Loader2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTtsStore } from '@/stores/tts-store'
import { emitTtsClearHighlight } from '@/lib/reader/marks/mark-linkage'
import { cn } from '@/lib/utils'
import { getTtsPlaybackProgress } from '@/lib/reader/tts/playback-progress'

interface FloatingTtsPlayerProps {
  onOpenSettings?: () => void
}

const BALL_SIZE = 48
const PANEL_WIDTH = 380
const DOCK_GAP = 8

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
    isReceiving,
    isBuffering,
    receivedDuration,
    receptionProgress,
    receptionError,
    receptionRetryAt,
    currentTitle,
    currentTime,
    duration,
    isFromCache,
    keyUsed,
    provider,
    rate,
    setRate,
    togglePlayPause,
    seekTime,
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
      isReceiving: s.isReceiving,
      isBuffering: s.isBuffering,
      receivedDuration: s.receivedDuration,
      receptionProgress: s.receptionProgress,
      receptionError: s.receptionError,
      receptionRetryAt: s.receptionRetryAt,
      currentTitle: s.currentTitle,
      currentTime: s.currentTime,
      duration: s.duration,
      isFromCache: s.isFromCache,
      keyUsed: s.keyUsed,
      provider: s.provider,
      rate: s.rate,
      setRate: s.setRate,
      togglePlayPause: s.togglePlayPause,
      seekTime: s.seekTime,
      closePlayer: s.closePlayer,
    })),
  )

  const [isHovered, setIsHovered] = useState(false)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  })

  // 展开停靠方位（打开时锁定，拖动过程中不动态翻转，防止跳变）
  const [dockSide, setDockSide] = useState<'left' | 'right'>('left')
  const [dockVertical, setDockVertical] = useState<'up' | 'down'>('down')

  // 音频进度条拖拽/拉取状态
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubTime, setScrubTime] = useState(0)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number>(0)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)

  // 窗口大小监听
  useEffect(() => {
    const onResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 同步持久化坐标
  useEffect(() => {
    if (playerPosition) {
      setDragPos(playerPosition)
    }
  }, [playerPosition])

  // 保证正文完全干净，绝不添加干扰标记
  useEffect(() => {
    emitTtsClearHighlight()
    return () => {
      emitTtsClearHighlight()
    }
  }, [])

  // 格式化时间为 mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }
  const segmentStatus = receptionProgress
    ? `${receptionProgress.completedSegments}/${receptionProgress.totalSegments} 段`
    : ''
  const receptionStatus = receptionError
    ? receptionRetryAt > Date.now() ? '额度受限 · 可播放已缓存部分' : '接收中断 · 可播放已缓存部分'
    : isReceiving
      ? receptionProgress?.stage === 'queued'
        ? `排队等待 · 已完成 ${segmentStatus}`
        : receptionProgress?.stage === 'receiving'
          ? `接收 ${receptionProgress.segmentIndex}/${receptionProgress.totalSegments} 段 · 已就绪 ${formatTime(receivedDuration)}`
          : isBuffering
            ? `等待后续音频 · ${segmentStatus}`
            : `已完成 ${segmentStatus} · 已就绪 ${formatTime(receivedDuration)}`
      : receptionProgress?.stage === 'complete' || isFromCache
        ? `已接收完成 · ${formatTime(duration)}`
        : formatTime(duration)

  // 默认位置：右上角
  const defaultPos = {
    x: Math.max(8, windowSize.width - BALL_SIZE - 28),
    y: 76,
  }
  const currentPos = dragPos || defaultPos

  // 展开/收起切换
  const handleToggleExpandCollapse = () => {
    if (isPlayerCollapsed) {
      const shouldDockLeft =
        currentPos.x > windowSize.width - PANEL_WIDTH - 20 || currentPos.x > windowSize.width / 2
      const shouldDockUp =
        currentPos.y > windowSize.height - 200 || currentPos.y > windowSize.height / 2
      setDockSide(shouldDockLeft ? 'left' : 'right')
      setDockVertical(shouldDockUp ? 'up' : 'down')
      setIsPlayerCollapsed(false)
    } else {
      setIsPlayerCollapsed(true)
    }
  }

  // 计算安全拖拽边界范围（紧凑型卡片高度仅约 120px）
  const computeBounds = (isCollapsed: boolean, side: 'left' | 'right', vert: 'up' | 'down') => {
    let minX = 12
    let maxX = Math.max(12, windowSize.width - BALL_SIZE - 12)
    let minY = 38
    let maxY = Math.max(38, windowSize.height - BALL_SIZE - 12)

    if (!isCollapsed) {
      if (side === 'left') {
        minX = Math.max(12, PANEL_WIDTH + DOCK_GAP + 12)
        maxX = Math.max(minX, windowSize.width - BALL_SIZE - 12)
      } else {
        minX = 12
        maxX = Math.max(12, windowSize.width - BALL_SIZE - DOCK_GAP - PANEL_WIDTH - 12)
      }

      if (vert === 'up') {
        minY = Math.max(38, 140)
        maxY = Math.max(minY, windowSize.height - BALL_SIZE - 12)
      } else {
        minY = 38
        maxY = Math.max(38, windowSize.height - BALL_SIZE - 140)
      }
    }

    return { minX, maxX, minY, maxY }
  }

  // 统一平滑拖拽处理
  const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>, isFromBall: boolean) => {
    const target = e.target as HTMLElement
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('[role="slider"]') ||
      target.closest('.interactive-control')
    ) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const initialX = currentPos.x
    const initialY = currentPos.y
    let hasMoved = false

    const bounds = computeBounds(isPlayerCollapsed, dockSide, dockVertical)

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (Math.hypot(dx, dy) > 4) {
        hasMoved = true
        isDraggingRef.current = true
      }
      if (!hasMoved) return

      const nextX = Math.max(bounds.minX, Math.min(bounds.maxX, initialX + dx))
      const nextY = Math.max(bounds.minY, Math.min(bounds.maxY, initialY + dy))

      setDragPos({ x: nextX, y: nextY })
    }

    const onPointerUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)

      if (hasMoved) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        const finalX = Math.max(bounds.minX, Math.min(bounds.maxX, initialX + dx))
        const finalY = Math.max(bounds.minY, Math.min(bounds.maxY, initialY + dy))
        const finalPos = { x: finalX, y: finalY }

        setDragPos(finalPos)
        setPlayerPosition(finalPos)
      } else if (isFromBall) {
        handleToggleExpandCollapse()
      }

      setTimeout(() => {
        isDraggingRef.current = false
      }, 60)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const effectiveTime = isScrubbing ? scrubTime : currentTime
  const incomplete = isReceiving || Boolean(receptionError)
  const { duration: progressDuration, percent: progressPercent } = getTtsPlaybackProgress(
    effectiveTime,
    duration,
    receivedDuration,
    incomplete,
  )

  // 进度条拉取 / 点击 Seek（支持在流式已就绪音频内自由拖动与跳转）
  const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (progressDuration <= 0 || isLoading) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    setIsScrubbing(true)
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const target = ratio * progressDuration
    setScrubTime(target)
  }

  const handleScrubPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (progressDuration <= 0 || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const target = ratio * progressDuration
    setHoverTime(target)
    setHoverX(Math.max(0, Math.min(rect.width, e.clientX - rect.left)))

    if (isScrubbing) {
      setScrubTime(target)
    }
  }

  const handleScrubPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
    setIsScrubbing(false)
    seekTime(Math.max(0, Math.min(progressDuration, scrubTime)))
  }

  const handleScrubPointerLeave = () => {
    if (!isScrubbing) {
      setHoverTime(null)
    }
  }

  if (!isPlayerVisible) return null

  return (
    // 根定位容器：统一管理 (currentPos.x, currentPos.y)，小球与面板共享唯一锚点
    <div
      role="region"
      aria-label="语音朗读播放器"
      style={{
        position: 'fixed',
        left: `${currentPos.x}px`,
        top: `${currentPos.y}px`,
        zIndex: 50,
      }}
      className="select-none"
    >
      {/* ==================== 1. 主体悬浮球（固定锚点，永不位移） ==================== */}
      <div
        role="button"
        tabIndex={0}
        aria-label="语音朗读悬浮小球"
        onPointerDown={(e) => handleDragPointerDown(e, true)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative flex items-center cursor-grab active:cursor-grabbing touch-none"
      >
        {/* 收起态悬停胶囊（显示书名与当前时间） */}
        {isPlayerCollapsed && isHovered && (
          <div
            className={cn(
              'absolute top-1/2 -translate-y-1/2 flex items-center gap-2 rounded-full border border-primary/30 bg-background/95 px-3 py-1 shadow-xl backdrop-blur-md animate-in fade-in duration-150 whitespace-nowrap',
              currentPos.x > windowSize.width / 2
                ? 'right-[54px] slide-in-from-right-2'
                : 'left-[54px] slide-in-from-left-2',
            )}
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
            <span className="truncate text-[11px] font-semibold text-foreground max-w-[120px]">
              {currentTitle || '听书中'}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {formatTime(effectiveTime)} / {isReceiving ? '生成中' : formatTime(duration)}
            </span>
          </div>
        )}

        {/* 核心圆形小球（48x48，SVG 环形进度圈，点击开合，长按拖动） */}
        <div
          className={cn(
            'relative flex size-12 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-background/90 shadow-2xl backdrop-blur-xl transition-all duration-200 hover:scale-105 active:scale-95',
            !isPlayerCollapsed && 'ring-2 ring-primary border-primary bg-primary/10 shadow-primary/20',
            isSpeaking && !isPlayerCollapsed && 'ring-2 ring-primary/40',
          )}
          title={isPlayerCollapsed ? '点击展开播放控制面板，按住可任意拖动位置' : '点击收起面板，按住可任意拖动位置'}
        >
          {/* 播放中声波脉冲光晕 */}
          {isSpeaking && !isPaused && (
            <span className="absolute -inset-1 rounded-full bg-primary/25 animate-ping opacity-60 pointer-events-none -z-10" />
          )}

          {/* SVG 环形进度条（周长 132） */}
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

          {/* 球心状态：加载 / 动态音柱 / 耳机图标 */}
          <div className="pointer-events-none flex items-center justify-center">
            {isLoading ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : isSpeaking && !isPaused ? (
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

      {/* ==================== 2. 极简卡片式音频播放器（无冗余文字，专注沉浸收听） ==================== */}
      {!isPlayerCollapsed && (
        <div
          role="region"
          aria-label="语音朗读播放控制面板"
          style={{
            position: 'absolute',
            ...(dockSide === 'left' ? { right: `${BALL_SIZE + DOCK_GAP}px` } : { left: `${BALL_SIZE + DOCK_GAP}px` }),
            ...(dockVertical === 'up' ? { bottom: '0px' } : { top: '0px' }),
            width: `${PANEL_WIDTH}px`,
          }}
          className={cn(
            'flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-background/95 shadow-2xl backdrop-blur-xl transition-all duration-200 animate-in fade-in zoom-in-95',
            dockSide === 'left' ? 'origin-right' : 'origin-left',
          )}
        >
          {/* 顶栏：拖拽手柄、标题与功能按钮 */}
          <div
            onPointerDown={(e) => handleDragPointerDown(e, false)}
            className="flex items-center justify-between border-b border-border/50 bg-muted/40 px-3 py-2 select-none cursor-grab active:cursor-grabbing touch-none"
            title="按住手柄自由拖拽移动播放器"
          >
            <div className="flex min-w-0 items-center gap-2">
              <GripHorizontal className="size-4 shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />

              <div
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full transition-colors',
                  isSpeaking
                    ? 'bg-primary/20 text-primary animate-pulse'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <Headphones className="size-3" />
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <h4 className="truncate text-xs font-semibold text-foreground max-w-[160px]">
                  {currentTitle || '语音朗读'}
                </h4>
                <div className="flex items-center text-[10px] text-muted-foreground">
                  {isLoading ? (
                    <span className="flex items-center gap-1 text-primary font-medium">
                      <Loader2 className="size-2.5 animate-spin" />
                      合成中…
                    </span>
                  ) : isFromCache ? (
                    <span className="flex items-center gap-0.5 text-emerald-500 font-medium">
                      <Zap className="size-2.5 fill-emerald-500" />
                      本地秒开缓存
                    </span>
                  ) : provider === 'azure' ? (
                    <span className="flex items-center gap-0.5 text-blue-500 font-medium">
                      <Sparkles className="size-2.5 text-blue-500" />
                      微软 Azure 语音
                    </span>
                  ) : provider === 'local' ? (
                    <span className="flex items-center gap-0.5 text-emerald-500 font-medium">
                      <Sparkles className="size-2.5 text-emerald-500" />
                      本地模型语音
                    </span>
                  ) : keyUsed === 'secondary' ? (
                    <span className="flex items-center gap-0.5 text-amber-500 font-medium">
                      <Sparkles className="size-2.5" />
                      备用 Key
                    </span>
                  ) : keyUsed === 'primary' ? (
                    <span className="flex items-center gap-0.5 text-primary font-medium">
                      <Sparkles className="size-2.5" />
                      Gemini 智能云端
                    </span>
                  ) : (
                    <span>原生语音</span>
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
                  title="语音设置"
                >
                  <Settings className="size-3.5" />
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={handleToggleExpandCollapse}
                title="收起为悬浮球"
              >
                <Minimize2 className="size-3.5" />
              </Button>

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

          {/* 中间区：平滑拉取进度条与时间指示（无不准的文字遮挡） */}
          <div className="px-3.5 pt-2 pb-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mb-1">
              <span className="font-semibold text-foreground/90">
                {formatTime(effectiveTime)}
                {incomplete && progressDuration > 0 && <span className="font-normal text-muted-foreground"> / {formatTime(progressDuration)} 可播放</span>}
              </span>
              <span aria-live="polite" title={receptionError ?? undefined}>
                {receptionStatus}
              </span>
            </div>

            {/* 可自由点击、拉取的音频进度条 */}
            <div className="relative pt-1 pb-1 interactive-control">
              <div
                ref={trackRef}
                role="slider"
                tabIndex={0}
                aria-label={incomplete ? '已就绪音频的播放进度' : '整章音频播放进度'}
                aria-valuemin={0}
                aria-valuemax={progressDuration}
                aria-valuenow={effectiveTime}
                aria-disabled={isLoading || progressDuration <= 0}
                onPointerDown={handleScrubPointerDown}
                onPointerMove={handleScrubPointerMove}
                onPointerUp={handleScrubPointerUp}
                onPointerLeave={handleScrubPointerLeave}
                onKeyDown={(e) => {
                  if (progressDuration <= 0 || isLoading) return
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault()
                    seekTime(Math.max(0, currentTime - 5))
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    seekTime(Math.min(progressDuration, currentTime + 5))
                  }
                }}
                className={cn(
                  'group relative h-2 w-full rounded-full bg-muted/80 cursor-pointer touch-none select-none transition-all duration-150',
                  (isScrubbing || hoverTime !== null) && 'h-2.5',
                )}
                title={incomplete ? '点击或拖拽跳转当前已就绪音频进度（整章后台持续接收中）' : '点击或拖拽快速跳转音频进度'}
              >
                {/* 悬停时间气泡 */}
                {hoverTime !== null && (
                  <div
                    className="absolute -top-7 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-mono font-semibold text-background shadow-lg pointer-events-none transition-transform z-10"
                    style={{ left: `${hoverX}px` }}
                  >
                    {formatTime(hoverTime)}
                  </div>
                )}

                {/* 已播进度条 */}
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-75 relative"
                  style={{ width: `${progressPercent}%` }}
                >
                  {/* 可拖动手柄圆点 */}
                  <div
                    className={cn(
                      'absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 size-3.5 rounded-full border-2 border-background bg-primary shadow-md transition-transform',
                      isScrubbing ? 'scale-125 ring-2 ring-primary/40' : 'group-hover:scale-110',
                    )}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 底栏：语速档位 + 快退15秒 / 播放暂停 / 快进15秒 + 从头重播 */}
          <div className="flex items-center justify-between border-t border-border/40 bg-background/80 px-3.5 py-2 interactive-control">
            {/* 语速调节 */}
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

            {/* 核心播放三键 */}
            <div className="flex items-center gap-2">
              {/* 快退 15 秒 */}
              <button
                type="button"
                disabled={isLoading || progressDuration <= 0}
                onClick={() => seekTime(Math.max(0, currentTime - 15))}
                className="flex items-center gap-0.5 px-1.5 py-1 rounded text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-40"
                title="快退 15 秒"
              >
                <RotateCcw className="size-3" />
                <span>15s</span>
              </button>

              {/* 核心播放/暂停键 */}
              <Button
                variant="default"
                size="icon"
                disabled={isLoading}
                onClick={togglePlayPause}
                className="size-8 rounded-full shadow-md cursor-pointer"
                title={isSpeaking ? '暂停' : '播放'}
              >
                {isLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : isSpeaking ? (
                  <Pause className="size-3.5" />
                ) : (
                  <Play className="size-3.5 ml-0.5" />
                )}
              </Button>

              {/* 快进 15 秒 */}
              <button
                type="button"
                disabled={isLoading || progressDuration <= 0}
                onClick={() => seekTime(Math.min(progressDuration, currentTime + 15))}
                className="flex items-center gap-0.5 px-1.5 py-1 rounded text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-40"
                title="快进 15 秒"
              >
                <span>15s</span>
                <RotateCw className="size-3" />
              </button>
            </div>

            {/* 从头重播（回到本章 0:00） */}
            <Button
              variant="ghost"
              size="icon"
              disabled={isLoading || progressDuration <= 0}
              onClick={() => seekTime(0)}
              className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
              title="回到本章开头从头播放"
            >
              <RotateCcw className="size-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
