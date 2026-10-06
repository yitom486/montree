import type { ReadingMark } from '@montree/contracts'

interface EpubMarkTooltipProps {
  mark: ReadingMark | null
  x: number
  y: number
}

export function EpubMarkTooltip({ mark, x, y }: EpubMarkTooltipProps) {
  if (!mark?.note?.trim()) return null

  return (
    <div
      className="pointer-events-none fixed z-[60] max-w-sm rounded-md border border-border/80 bg-popover px-3 py-2 text-sm shadow-lg"
      style={{ left: x, top: y - 8, transform: 'translate(-50%, -100%)' }}
      role="tooltip"
    >
      <p className="mb-1 text-xs font-medium text-muted-foreground">批注</p>
      <p className="whitespace-pre-wrap text-foreground">{mark.note.trim()}</p>
      {mark.excerpt?.trim() ? (
        <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground line-clamp-3">
          {mark.excerpt.trim()}
        </p>
      ) : null}
    </div>
  )
}
