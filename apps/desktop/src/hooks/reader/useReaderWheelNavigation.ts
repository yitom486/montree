import { useEffect, useRef, type RefObject } from 'react'
import { resolveWheelPageTurn } from '@montree/reader-core'

interface UseReaderWheelNavigationOptions {
  onPrev: () => void
  onNext: () => void
  enabled?: boolean
  cooldownMs?: number
}

export function useReaderWheelNavigation(
  containerRef: RefObject<HTMLElement | null>,
  { onPrev, onNext, enabled = true, cooldownMs = 320 }: UseReaderWheelNavigationOptions,
): void {
  const cooldownRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) return

    const onWheel = (event: WheelEvent) => {
      const turn = resolveWheelPageTurn(event.deltaY, {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      })
      if (!turn) return

      event.preventDefault()

      if (cooldownRef.current) return
      cooldownRef.current = true
      window.setTimeout(() => {
        cooldownRef.current = false
      }, cooldownMs)

      if (turn === 'next') onNext()
      else onPrev()
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [containerRef, cooldownMs, enabled, onNext, onPrev])
}
