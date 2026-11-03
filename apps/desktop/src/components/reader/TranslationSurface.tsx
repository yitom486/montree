import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { drag, type D3DragEvent } from 'd3-drag'
import { select } from 'd3-selection'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/** 阅读器业务浮窗：Dialog 管理关闭/焦点，D3 管理鼠标与触摸拖动。 */
export function TranslationSurface({ x, y, floatingPosition, onMove, children }: {
  x: number; y: number; floatingPosition?: { x: number; y: number }; onMove: (position: { x: number; y: number }) => void; children: ReactNode
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const current = useRef(floatingPosition ?? { x: Math.max(8, x - 190), y: Math.max(8, y - 180) })
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  useLayoutEffect(() => {
    if (!element) return
    let frame: number | undefined
    let bounds = { right: 8, bottom: 8 }
    const paint = () => {
      frame = undefined
      const { x, y } = current.current
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
    const move = (point: { x: number; y: number }) => {
      current.current = {
        x: Math.max(8, Math.min(point.x, bounds.right)),
        y: Math.max(8, Math.min(point.y, bounds.bottom)),
      }
      // 高频拖动只更新位移，每帧最多写一次，不触发布局测量或 React 渲染。
      frame ??= requestAnimationFrame(paint)
    }
    const header = element.querySelector<HTMLElement>('[data-translation-drag]')!
    const selection = select(header)
    selection.call(drag<HTMLElement, unknown>()
      .container(document.documentElement)
      .filter((event: MouseEvent) => !event.button && !event.ctrlKey && !(event.target as Element).closest('button'))
      .subject(() => ({ ...current.current }))
      .on('start', () => { element.style.willChange = 'transform' })
      .on('drag', (event: D3DragEvent<HTMLElement, unknown, { x: number; y: number }>) => move(event))
      .on('end', () => {
        if (frame !== undefined) cancelAnimationFrame(frame)
        paint()
        onMoveRef.current({ ...current.current })
        element.style.removeProperty('will-change')
      }))
    const keyboard = (event: KeyboardEvent) => {
      if (event.target !== header) return
      const moves: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }
      const delta = moves[event.key]
      if (delta) {
        event.preventDefault()
        move({ x: current.current.x + delta[0], y: current.current.y + delta[1] })
        onMoveRef.current({ ...current.current })
      }
    }
    header.addEventListener('keydown', keyboard)
    const resize = () => {
      if (document.visibilityState === 'hidden' || window.innerWidth < 16 || window.innerHeight < 16) return
      const { width, height } = element.getBoundingClientRect()
      bounds = { right: Math.max(8, window.innerWidth - width - 8), bottom: Math.max(8, window.innerHeight - height - 8) }
      move(current.current)
      onMoveRef.current({ ...current.current })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', resize)
    resize()
    if (frame !== undefined) cancelAnimationFrame(frame)
    paint()
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      selection.on('.drag', null)
      header.removeEventListener('keydown', keyboard)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', resize)
    }
  }, [element])
  return (
    <Dialog open modal={false}>
      <DialogContent ref={setElement} showCloseButton={false} aria-describedby={undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        style={{ left: 0, top: 0 }}
        className="flex max-h-[min(32rem,calc(100dvh-1rem))] w-[380px] max-w-[calc(100vw-1rem)] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground transition-none duration-0 data-[state=open]:animate-none sm:max-w-[380px]">
        <DialogTitle className="sr-only">划词翻译</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
