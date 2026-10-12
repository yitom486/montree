import { memo, useEffect, useRef, useState } from 'react'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { cn } from '@/lib/utils'

/**
 * 阅读器内停靠态 Agent 面板（含左侧拉伸分隔线）。
 *此前三端 viewer 各自写死 `w-[340px] shrink-0`，侧栏聊天框无法左右拉伸；
 * 此处统一为可拖拽宽度（280~640，持久化），三端共用。
 */
export const DockedAgentPane = memo(function DockedAgentPane({
  workspaceRoot,
}: {
  workspaceRoot?: string
}) {
  const width = useReaderHudUiStore((s) => s.dockedAgentWidth)
  const setWidth = useReaderHudUiStore((s) => s.setDockedAgentWidth)
  const [resizing, setResizing] = useState(false)
  const resizeRef = useRef<{ startX: number; width: number } | null>(null)

  useEffect(() => {
    if (!resizing) return

    const stopResizing = () => {
      setResizing(false)
      resizeRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    const handlePointerMove = (e: MouseEvent | PointerEvent) => {
      // 关键守护：如果鼠标已松开（buttons === 0），绝不响应移动，立即清理拖拽态
      if (e.isTrusted && e.buttons === 0) {
        stopResizing()
        return
      }
      if (!resizeRef.current) return
      // 左边缘手柄：往左拖变宽，往右拖变窄
      setWidth(resizeRef.current.width + (resizeRef.current.startX - e.clientX))
    }

    const handlePointerUp = () => {
      stopResizing()
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('mousemove', handlePointerMove, { passive: true })
    window.addEventListener('mouseup', handlePointerUp)
    window.addEventListener('blur', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      window.removeEventListener('blur', stopResizing)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [resizing, setWidth])

  const startResizing = (clientX: number) => {
    setResizing(true)
    resizeRef.current = { startX: clientX, width }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
  }

  return (
    <div
      className="flex h-full min-h-0 shrink-0 relative"
      style={{ width }}
      data-testid="docked-agent-pane"
    >
      {/* 拖拽中的全屏防穿透遮罩：确保鼠标甩入 iframe 时依然平滑响应且不丢失 mouseup */}
      {resizing ? (
        <div
          className="fixed inset-0 z-50 cursor-ew-resize select-none bg-transparent"
          data-testid="docked-agent-resize-overlay"
        />
      ) : null}

      <div
        data-testid="docked-agent-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整面板宽度"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          e.preventDefault()
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // happy-dom / 降级环境忽略
          }
          startResizing(e.clientX)
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          e.preventDefault()
          startResizing(e.clientX)
        }}
        className={cn(
          'w-1.5 shrink-0 cursor-ew-resize rounded transition-colors relative z-10',
          'hover:bg-primary/30 active:bg-primary/50',
          resizing && 'bg-primary/40',
        )}
      />
      <div className="h-full min-h-0 min-w-0 flex-1">
        <AgentPanel workspaceRoot={workspaceRoot} className="w-full" />
      </div>
    </div>
  )
})
