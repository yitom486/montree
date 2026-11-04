import { Bookmark, Check, Clock, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { HnStory } from '../../../../contracts/hn'
import { formatRelativeTime } from './format'

interface HnStoryRowProps {
  story: HnStory
  rank: number
  isRead: boolean
  isSaved: boolean
  isLater: boolean
  isReturnTarget: boolean
  onOpen: () => void
  onOpenDiscussion: () => void
  onToggleRead: () => void
  onToggleLater: () => void
  onToggleShelf: () => void
  onOpenExternal: () => void
}

function RowAction({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active && 'text-primary',
      )}
    >
      {children}
    </button>
  )
}

export function HnStoryRow({
  story,
  rank,
  isRead,
  isSaved,
  isLater,
  isReturnTarget,
  onOpen,
  onOpenDiscussion,
  onToggleRead,
  onToggleLater,
  onToggleShelf,
  onOpenExternal,
}: HnStoryRowProps) {
  return (
    <li
      className={cn(
        'group relative flex gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50',
        isReturnTarget && 'bg-primary/5',
      )}
    >
      <span className="w-5 shrink-0 pt-1 text-right text-xs tabular-nums text-muted-foreground/60 select-none">
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              'min-w-0 text-left text-[14px] leading-[1.5] font-medium transition-colors hover:text-primary focus-visible:underline focus-visible:outline-none',
              isRead ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {story.title}
          </button>
          {!isRead && <span className="sr-only">未读</span>}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {story.domain && (
            <>
              <span className="max-w-64 truncate">{story.domain}</span>
              <span className="text-border">·</span>
            </>
          )}
          <span className="tabular-nums">{story.points} 分</span>
          <span className="text-border">·</span>
          <span className="truncate">{story.author}</span>
          <span className="text-border">·</span>
          <span>{formatRelativeTime(story.createdAt)}</span>
          <span className="text-border">·</span>
          <button
            type="button"
            onClick={onOpenDiscussion}
            className="rounded tabular-nums transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
          >
            {story.comments} 条评论
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
        <RowAction label={isRead ? '标记为未读' : '标记为已读'} active={isRead} onClick={onToggleRead}>
          <Check className="size-3.5" />
        </RowAction>
        <RowAction label={isLater ? '从稍后阅读移除' : '稍后阅读'} active={isLater} onClick={onToggleLater}>
          <Clock className="size-3.5" />
        </RowAction>
        <RowAction label={isSaved ? '从书架移除' : '收藏到书架'} active={isSaved} onClick={onToggleShelf}>
          <Bookmark className={cn('size-3.5', isSaved && 'fill-current')} />
        </RowAction>
        {story.url && (
          <RowAction label="在浏览器中打开原文" onClick={onOpenExternal}>
            <ExternalLink className="size-3.5" />
          </RowAction>
        )}
      </div>
    </li>
  )
}
