import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minimize2 } from 'lucide-react'
import type { PresentationDocument } from '@/lib/data/presentation-document'
import { Button } from '@/components/ui/button'
import { PresentationSlide } from './PresentationSlide'
import { animationGroups } from '@/lib/data/presentation-animation'

export function PresentationSlideshow({ doc, fullscreen, navigate, exit }: {
  doc: PresentationDocument
  fullscreen: boolean
  navigate: (slide: number) => void
  exit: () => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [progress, setProgress] = useState({ step: 0, total: 0, unsupported: false })
  const playback = useRef<{ next: () => boolean; clickEnabled: boolean } | null>(null)
  const count = doc.slidePaths.length
  const slide = doc.activeSlide
  const advance = useCallback((pointer = false) => {
    if (playback.current?.next()) return
    if (!pointer || playback.current?.clickEnabled !== false) navigate(Math.min(count, slide + 1))
  }, [count, slide, navigate])
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
    const host = stage.current
    if (!host) return
    const config = doc.animation(slide)
    const groups = animationGroups(config.unsupported.some((value) => value.startsWith('effects:')) ? [] : config.effects)
    const timers = new Set<number>(); const animations: Animation[] = []; let cursor = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const elements = Array.from(host.querySelectorAll<HTMLElement>('[data-element-id]'))
    const find = (id: string): HTMLElement | undefined => elements.find((node) => node.dataset.elementId === id)
    const originals = new Map(elements.map((node) => [node, node.style.visibility]))
    groups.flatMap((group) => group.effects).forEach((effect) => { const element = find(effect.elementId); if (element) { element.style.visibility = 'hidden'; element.dataset.animationState = 'pending' } })
    let pending: HTMLElement[] = []
    const later = (callback: () => void, delay: number): void => { const timer = window.setTimeout(() => { timers.delete(timer); callback() }, delay); timers.add(timer) }
    const runNext = (): boolean => {
      // A second click completes the running group before starting another one.
      if (pending.length && (timers.size || animations.some((animation) => animation.playState === 'running'))) {
        for (const timer of timers) window.clearTimeout(timer); timers.clear()
        for (const animation of animations) if (animation.playState === 'running') animation.finish()
        for (const element of pending) { element.style.visibility = 'visible'; element.dataset.animationState = 'shown' }
        pending = []; return true
      }
      const group = groups[cursor]
      if (!group) return false
      cursor++; pending = group.effects.flatMap((effect) => { const node = find(effect.elementId); return node ? [node] : [] })
      setProgress({ step: cursor, total: groups.length, unsupported: Boolean(config.unsupported.length) })
      for (const effect of group.effects) {
        const target = find(effect.elementId)
        if (!target) continue
        later(() => {
          target.style.visibility = 'visible'; target.dataset.animationState = 'playing'
          if (effect.effect === 'fade' && !reduced) { const animation = target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: effect.durationMs, fill: 'none' }); animations.push(animation); animation.onfinish = () => { target.dataset.animationState = 'shown' } }
          else target.dataset.animationState = 'shown'
        }, reduced ? 0 : effect.startMs)
      }
      return true
    }
    playback.current = { next: runNext, clickEnabled: config.transition.advanceOnClick }
    setProgress({ step: 0, total: groups.length, unsupported: Boolean(config.unsupported.length) })
    if (groups[0]?.automatic) runNext()
    const canvas = host.querySelector<HTMLElement>('[data-ppt-presentation-slide]')
    if (canvas && !reduced && !config.unsupported.some((value) => value.startsWith('transition:')) && config.transition.effect !== 'none') {
      const from = config.transition.effect === 'fade' ? { opacity: 0 } : { transform: ({ left: 'translateX(100%)', right: 'translateX(-100%)', up: 'translateY(100%)', down: 'translateY(-100%)' })[config.transition.direction ?? 'left'] }
      animations.push(canvas.animate([from, { opacity: 1, transform: 'translate(0)' }], { duration: config.transition.durationMs, fill: 'none' }))
    }
    // Automatic page advance is independent of effect-delay timers.
    const automatic = !config.unsupported.some((value) => value.startsWith('transition:')) && config.transition.advanceAfterMs !== undefined && slide < count ? window.setTimeout(() => navigate(slide + 1), config.transition.advanceAfterMs) : undefined
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      if (automatic !== undefined) window.clearTimeout(automatic)
      animations.forEach((animation) => animation.cancel())
      originals.forEach((visibility, element) => { element.style.visibility = visibility; delete element.dataset.animationState })
      playback.current = null
    }
    // Navigation callback is refreshed by the parent; effects reset only on page/revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, slide, doc.revision, count])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); exit(); return }
      if (event.altKey || event.ctrlKey || event.metaKey) return
      // Space/Enter on a focused control retain their native button behavior.
      if ((event.key === ' ' || event.key === 'Enter') && (event.target as HTMLElement).closest('button')) return
      let target: number | undefined
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key)) { event.preventDefault(); advance(); return }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) target = slide - 1
      else if (event.key === 'Home') target = 1
      else if (event.key === 'End') target = count
      if (target === undefined) return
      event.preventDefault(); navigate(Math.max(1, Math.min(count, target)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slide, count, navigate, advance, exit])
  return <div data-ppt-slideshow role="region" aria-label="幻灯片放映" className="relative flex min-h-0 flex-1 flex-col bg-black text-white">
    <div className="absolute right-3 top-3 z-10">
      <Button size="sm" variant="ghost" className="bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={exit}>
        <Minimize2 />{fullscreen ? '退出全屏' : '结束放映'}<span className="text-white/60">Esc</span>
      </Button>
    </div>
    <div className="flex min-h-0 flex-1 px-4 pb-16 pt-14">
      <div ref={stage} data-ppt-presentation-stage className="flex min-h-0 min-w-0 flex-1 select-none items-center justify-center outline-none" tabIndex={0}
        aria-label="点击幻灯片或按方向键翻页" onClick={(event) => { event.currentTarget.focus(); advance(true) }}
        onContextMenu={(event) => { event.preventDefault(); event.currentTarget.focus(); navigate(Math.max(1, slide - 1)) }}>
        <div data-ppt-presentation-slide data-slide={slide} style={{ width, maxWidth: '100%' }}>
          <PresentationSlide doc={doc} slide={slide} zoom={100} presenting />
        </div>
      </div>
    </div>
    <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-4 text-sm">
      <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/20 hover:text-white" aria-label="上一张幻灯片" disabled={slide <= 1} onClick={() => navigate(slide - 1)}><ChevronLeft /></Button>
      <span role="status" aria-live="polite" aria-atomic="true">{slide} / {count}</span>
      <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/20 hover:text-white" aria-label={progress.step < progress.total ? '播放下一组动画' : '下一张幻灯片'} disabled={slide >= count && progress.step >= progress.total} onClick={() => advance()}><ChevronRight /></Button>
      {progress.total > 0 && <span className="text-xs text-white/60">动画 {progress.step} / {progress.total}</span>}
      {progress.unsupported && <span className="text-xs text-amber-200">部分效果暂以静态内容显示</span>}
      <span className="hidden text-xs text-white/60 sm:inline">点击 / → 下一张 · ← 上一张 · Esc 退出</span>
    </div>
  </div>
}
