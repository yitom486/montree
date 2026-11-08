import { MessageSquareText, Pencil } from 'lucide-react'
import { MotionConfig, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleIndicator, CollapsibleTrigger } from '@/components/motion/collapsible'

/** Comments remain plain text: their Markdown and HTML are writing notes, never executable content. */
export function CommentPreview({ source, onEdit }: { source: string; onEdit: () => void }) {
  const reduceMotion = useReducedMotion() ?? false
  const body = source.trim().slice(4, -3).trim()
  const summary = body.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !/^[-=_*]{3,}$/.test(line)) ?? '空备注'

  return (
    <MotionConfig skipAnimations={reduceMotion}>
      <Collapsible className="rounded-lg border border-border bg-muted text-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-2 p-2">
          <CollapsibleTrigger
            render={<Button variant="ghost" className="h-auto min-h-11 min-w-0 flex-1 basis-48 justify-start whitespace-normal text-left hover:bg-background" />}
            aria-label={`查看写作备注：${summary}`}
          >
            <MessageSquareText className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-normal">写作备注</span>
              <span className="truncate text-sm font-medium">{summary}</span>
            </span>
            <CollapsibleIndicator className="text-foreground" />
          </CollapsibleTrigger>
          <Button variant="ghost" className="min-h-11 shrink-0 hover:bg-background" onClick={onEdit} aria-label="编辑写作备注">
            <Pencil className="size-4" aria-hidden="true" />
            编辑
          </Button>
        </div>
        <CollapsibleContent contentClassName="border-t border-border p-4">
          <div className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{body || '此备注暂无内容。'}</div>
        </CollapsibleContent>
      </Collapsible>
    </MotionConfig>
  )
}
