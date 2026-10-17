import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  HIGHLIGHT_COLORS,
  type HighlightColorId,
  normalizeHighlightColor,
} from '@yitom/reader-core'
import { getReadingMarkStatusLabel } from '@yitom/reader-core'
import type { ReadingMark } from '@yitom/contracts'
import { cn } from '@/lib/utils'
import { AnchoredSurface } from '@/components/shared/AnchoredSurface'

interface ReadingMarkPopoverProps {
  mark: ReadingMark
  stack: ReadingMark[]
  x: number
  y: number
  onSelect: (mark: ReadingMark) => void
  onChangeColor: (color: HighlightColorId) => void
  onEditNote: () => void
  onDelete: () => void
  onDismiss: () => void
}

export function ReadingMarkPopover({
  mark,
  stack,
  x,
  y,
  onSelect,
  onChangeColor,
  onEditNote,
  onDelete,
  onDismiss,
}: ReadingMarkPopoverProps) {
  const currentColor = normalizeHighlightColor(mark.color)
  const hasNote = Boolean(mark.note?.trim())

  return (
    <AnchoredSurface x={x} y={y} label="标记操作" interactive onDismiss={onDismiss}>
      {stack.length > 1 ? (
        <div className="mb-1 flex flex-wrap gap-1 px-1">
          {stack.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px]',
                item.id === mark.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
              onClick={() => onSelect(item)}
            >
              {getReadingMarkStatusLabel(item)}
            </button>
          ))}
        </div>
      ) : null}

      {mark.excerpt?.trim() ? (
        <p className="mb-1 line-clamp-2 px-1 text-[11px] text-muted-foreground">{mark.excerpt.trim()}</p>
      ) : null}

      {hasNote ? (
        <p className="mb-1 line-clamp-3 px-1 text-xs text-foreground">{mark.note!.trim()}</p>
      ) : null}

      {mark.kind === 'highlight' ? (
        <div className="flex items-center gap-1 px-1 py-1">
          <span className="text-[10px] text-muted-foreground">颜色</span>
          {HIGHLIGHT_COLORS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                'size-6 rounded-full ring-1 ring-black/25 dark:ring-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                currentColor === item.id && 'ring-2 ring-foreground',
              )}
              style={{ backgroundColor: item.swatch }}
              title={item.label}
              aria-label={`颜色 ${item.label}`}
              aria-pressed={currentColor === item.id}
              onClick={() => onChangeColor(item.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 flex-1 px-2 text-xs"
          onClick={onEditNote}
        >
          {hasNote ? '编辑批注' : '添加批注'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
          删除
        </Button>
      </div>
    </AnchoredSurface>
  )
}
