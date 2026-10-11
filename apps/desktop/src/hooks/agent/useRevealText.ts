import { useEffect, useRef, useState } from 'react'

/**
 * 流式打字机揭示（无依赖）：chunk 到达只进缓冲，rAF 按帧匀速吐字，
 * backlog 大时加速追赶；追上后直出，不再调度。
 *
 * 只做文本切片，不碰解析与渲染：下游保持单个 Streamdown 实例，
 * 消毒/URL 策略/脚注隔离/货币配对等语义不受影响。
 * `prefers-reduced-motion` 或非流式时直接返回原文。
 */
export function useRevealText(source: string, streaming: boolean): string {
  const [revealed, setRevealed] = useState(source)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const revealedRef = useRef(source)
  const reduceMotionRef = useRef(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (!streaming || reduceMotionRef.current) {
      revealedRef.current = sourceRef.current
      setRevealed(sourceRef.current)
      return
    }
    let raf = 0
    const tick = () => {
      const target = sourceRef.current
      const shown = revealedRef.current
      // 追上或原文被改写（非追加）：前者停调度，后者直接对齐
      if (target === shown) return
      const next = !target.startsWith(shown)
        ? target
        : target.slice(0, shown.length + (target.length - shown.length > 2000 ? 600 : 120))
      revealedRef.current = next
      setRevealed(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [source, streaming])

  return revealed
}
