import { Code, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MarkdownEditorMode } from '@/stores/app-settings-store'

interface EditorModeToggleProps {
  mode: MarkdownEditorMode
  onChange: (mode: MarkdownEditorMode) => void
}

export function EditorModeToggle({ mode, onChange }: EditorModeToggleProps) {
  const isLive = mode === 'live-preview'
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      title={isLive ? '当前为所见即所得，编辑原始 Markdown (Ctrl+/)' : '当前为源码编辑，返回所见即所得 (Ctrl+/)'}
      aria-label="编辑器所见即所得模式切换"
      aria-pressed={!isLive}
      data-editor-mode={mode}
      className={cn(
        'h-6 gap-1 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground border border-border/60 bg-muted/20 transition-colors',
        isLive && 'bg-accent/70 text-foreground font-semibold shadow-xs',
      )}
      onClick={() => onChange(isLive ? 'source' : 'live-preview')}
    >
      {isLive ? <Code className="size-3" /> : <Sparkles className="size-3 text-primary" />}
      <span>{isLive ? '编辑源码' : '返回所见即所得'}</span>
    </Button>
  )
}
