import { useCallback, useEffect, useState } from 'react'
import type { ReadingMark } from '@montree/contracts'
import { rankVisualMarks, uniqueMarksById } from '@montree/reader-core'

export function useReadingMarkInspector(marks: ReadingMark[]) {
  const [active, setActive] = useState<ReadingMark | null>(null)
  const [stack, setStack] = useState<ReadingMark[]>([])
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const close = useCallback(() => {
    setActive(null)
    setStack([])
    setPos(null)
  }, [])

  const openAt = useCallback((hits: ReadingMark[], x: number, y: number) => {
    const ranked = rankVisualMarks(uniqueMarksById(hits))
    if (ranked.length === 0) {
      close()
      return
    }
    setStack(ranked)
    setActive(ranked[0] ?? null)
    setPos({ x, y })
  }, [close])

  useEffect(() => {
    if (!active) return
    const next = marks.find((mark) => mark.id === active.id)
    if (!next) {
      close()
      return
    }
    if (next === active) return
    setActive(next)
    setStack((prev) => prev.map((item) => (item.id === next.id ? next : item)))
  }, [active, close, marks])

  return { active, stack, pos, openAt, close, select: setActive }
}
