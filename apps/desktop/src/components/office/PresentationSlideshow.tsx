import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minimize2 } from 'lucide-react'
import type { PresentationDocument } from '@/lib/data/presentation-document'
import { Button } from '@/components/ui/button'
import { PresentationSlide } from './PresentationSlide'

export function PresentationSlideshow({ doc, fullscreen, navigate, exit }: {
  doc: PresentationDocument
  fullscreen: boolean
  navigate: (slide: number) => void
  exit: () => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const count = doc.slidePaths.length
  const slide = doc.activeSlide
  useEffect(() => {
    const host = stage.current
    if (!host) return
    const resize = new ResizeObserver(() => {
      // Fit both dimensions while leaving room for the exit and navigation controls.
      setWidth(Math.max(0, Math.min(host.clientWidth, host.clientHeight * doc.width / doc.height)))
    })
    resize.observe(host)
    host.focus()
    return () => resize.disconnect()
  }, [doc])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); exit(); return }
      if (event.altKey || event.ctrlKey || event.metaKey) return
      // Space/Enter on a focused control retain their native button behavior.
      if ((event.key === ' ' || event.key === 'Enter') && (event.target as HTMLElement).closest('button')) return
      let target: number | undefined
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key)) target = slide + 1
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) target = slide - 1
      else if (event.key === 'Home') target = 1
      else if (event.key === 'End') target = count
      if (target === undefined) return
      event.preventDefault(); navigate(Math.max(1, Math.min(count, target)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slide, count, navigate, exit])
  return <div data-ppt-slideshow role="region" aria-label="幻灯片放映" className="relative flex min-h-0 flex-1 flex-col bg-black text-white">
    <div className="absolute right-3 top-3 z-10">
      <Button size="sm" variant="ghost" className="bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={exit}>
        <Minimize2 />{fullscreen ? '退出全屏' : '结束放映'}<span className="text-white/60">Esc</span>
      </Button>
    </div>
    <div className="flex min-h-0 flex-1 px-4 pb-16 pt-14">
      <div ref={stage} data-ppt-presentation-stage className="flex min-h-0 min-w-0 flex-1 select-none items-center justify-center outline-none" tabIndex={0}
        aria-label="点击幻灯片或按方向键翻页" onClick={(event) => { event.currentTarget.focus(); navigate(Math.min(count, slide + 1)) }}
        onContextMenu={(event) => { event.preventDefault(); event.currentTarget.focus(); navigate(Math.max(1, slide - 1)) }}>
        <div data-ppt-presentation-slide data-slide={slide} style={{ width, maxWidth: '100%' }}>
          <PresentationSlide doc={doc} slide={slide} zoom={100} presenting />
        </div>
      </div>
    </div>
    <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-4 text-sm">
      <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/20 hover:text-white" aria-label="上一张幻灯片" disabled={slide <= 1} onClick={() => navigate(slide - 1)}><ChevronLeft /></Button>
      <span role="status" aria-live="polite" aria-atomic="true">{slide} / {count}</span>
      <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/20 hover:text-white" aria-label="下一张幻灯片" disabled={slide >= count} onClick={() => navigate(slide + 1)}><ChevronRight /></Button>
      <span className="hidden text-xs text-white/60 sm:inline">点击 / → 下一张 · ← 上一张 · Esc 退出</span>
    </div>
  </div>
}
