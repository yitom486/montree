import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { drag, type D3DragEvent } from 'd3-drag'
import { select } from 'd3-selection'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/** 阅读器业务浮窗：Dialog 管理关闭/焦点，D3 管理鼠标与触摸拖动。 */
export function TranslationSurface({ x, y, onClose, children }: {
  x: number; y: number; onClose: () => void; children: ReactNode
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x: Math.max(8, x - 190), y: Math.max(8, y - 180) })
  const current = useRef(position)
  useLayoutEffect(() => {
    if (!element) return
    const clamp = (point: { x: number; y: number }) => {
      const rect = element.getBoundingClientRect()
      const next = {
        x: Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8)),
      }
      current.current = next
      setPosition((old) => old.x === next.x && old.y === next.y ? old : next)
    }
    const header = element.querySelector<HTMLElement>('[data-translation-drag]')!
    const selection = select(header)
    selection.call(drag<HTMLElement, unknown>()
      .container(document.documentElement)
      .filter((event: MouseEvent) => !event.button && !event.ctrlKey && !(event.target as Element).closest('button'))
      .subject(() => ({ ...current.current }))
      .on('drag', (event: D3DragEvent<HTMLElement, unknown, { x: number; y: number }>) => clamp(event)))
    const keyboard = (event: KeyboardEvent) => {
      if (event.target !== header) return
      const moves: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }
      const move = moves[event.key]
      if (move) { event.preventDefault(); clamp({ x: current.current.x + move[0], y: current.current.y + move[1] }) }
    }
    header.addEventListener('keydown', keyboard)
    const resize = () => clamp(current.current)
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    window.addEventListener('resize', resize)
    resize()
    return () => {
      selection.on('.drag', null)
      header.removeEventListener('keydown', keyboard)
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [element])
  return (
    <Dialog open modal={false} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent ref={setElement} showCloseButton={false} aria-describedby={undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        style={{ left: position.x, top: position.y }}
        className="flex max-h-[min(32rem,calc(100dvh-1rem))] w-[380px] max-w-[calc(100vw-1rem)] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground data-[state=open]:animate-none sm:max-w-[380px]">
        <DialogTitle className="sr-only">划词翻译</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
