import { Columns2, Eye, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EditorViewMode } from '@/stores/editor-ui-store'

interface ViewModeToggleProps {
  mode: EditorViewMode
  onChange: (mode: EditorViewMode) => void
}

const VIEW_MODES: {
  value: EditorViewMode
  label: string
  icon: typeof PenLine
}[] = [
  { value: 'editor', label: '单栏编辑', icon: PenLine },
  { value: 'split', label: '双栏分屏', icon: Columns2 },
  { value: 'preview', label: '独立预览', icon: Eye },
]

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5"
      role="group"
      aria-label="视图模式"
    >
      {VIEW_MODES.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="icon-xs"
          title={`${label} (Ctrl+${value === 'editor' ? '1' : value === 'split' ? '2' : '3'})`}
          aria-label={label}
          aria-pressed={mode === value}
          className={cn(
            'text-muted-foreground hover:text-foreground',
            mode === value && 'bg-accent text-foreground shadow-sm',
          )}
          onClick={() => onChange(value)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  )
}
