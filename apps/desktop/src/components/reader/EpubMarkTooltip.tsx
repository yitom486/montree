import { useEffect, useRef, useState } from 'react'
import type { ReadingMark } from '@yitom/contracts'
import { AnchoredSurface } from '@/components/shared/AnchoredSurface'

interface EpubMarkTooltipProps { mark: ReadingMark | null; x: number; y: number; disabled?: boolean }

export function EpubMarkTooltip({ mark, x, y, disabled = false }: EpubMarkTooltipProps) {
  const [preview, setPreview] = useState<{ mark: ReadingMark; x: number; y: number } | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const held = useRef(false)
  const source = useRef(mark)
  source.current = mark
  const clearTimers = () => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current) }
  const dismiss = () => { clearTimers(); held.current = false; setPreview(null) }
  useEffect(() => {
    clearTimers()
    if (disabled) { held.current = false; setPreview(null); return }
    if (mark) {
      if (preview?.mark.id === mark.id) return
      held.current = false
      setPreview(null)
      openTimer.current = setTimeout(() => setPreview({ mark, x, y }), 180)
    } else if (!held.current) {
      closeTimer.current = setTimeout(() => setPreview(null), 160)
    }
    return clearTimers
    // Anchor stays fixed while moving across the same mark, preventing hover jitter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark?.id, disabled])
  useEffect(() => () => clearTimers(), [])
  if (!preview) return null
  const hasNote = Boolean(preview.mark.note?.trim())
  return (
    <AnchoredSurface x={preview.x} y={preview.y} label={hasNote ? '批注预览' : '重点预览'} onDismiss={dismiss}
      onPointerEnter={() => { held.current = true; clearTimeout(closeTimer.current) }}
      onPointerLeave={() => { held.current = false; if (!source.current) closeTimer.current = setTimeout(dismiss, 160) }}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{hasNote ? '批注' : '重点'}</p>
      {hasNote ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{preview.mark.note!.trim()}</p> : null}
      {preview.mark.excerpt?.trim() ? <p className={hasNote ? 'mt-3 border-t border-border/60 pt-2 text-xs leading-relaxed text-muted-foreground' : 'text-sm leading-relaxed'}>{preview.mark.excerpt.trim()}</p> : null}
    </AnchoredSurface>
  )
}
