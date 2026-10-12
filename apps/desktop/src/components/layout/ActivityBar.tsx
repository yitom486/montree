import { BookOpen, BookmarkCheck, Files, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ActivityBarProps {
  sidebarVisible: boolean
  onToggleSidebar: () => void
  onOpenLibrary?: () => void
  onOpenNotes?: () => void
  onOpenSettings?: () => void
}

/** 左侧活动栏：资源管理器 + 书库 + 札记 + 设置 */
export function ActivityBar({
  sidebarVisible,
  onToggleSidebar,
  onOpenLibrary,
  onOpenNotes,
  onOpenSettings,
}: ActivityBarProps) {
  return (
    <aside
      className="flex h-full w-12 shrink-0 flex-col items-center border-r border-border/60 bg-sidebar pt-1 pb-2"
      aria-label="活动栏"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'size-10 rounded-none border-l-2 border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          sidebarVisible && 'border-primary bg-accent/40 text-foreground',
        )}
        aria-label={sidebarVisible ? '隐藏资源管理器' : '显示资源管理器'}
        aria-pressed={sidebarVisible}
        title={sidebarVisible ? '隐藏资源管理器 (Ctrl+B)' : '显示资源管理器 (Ctrl+B)'}
        onClick={onToggleSidebar}
      >
        <Files className="size-5" />
      </Button>

      {onOpenLibrary ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 rounded-none border-l-2 border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          aria-label="馆藏书卷与在线规范"
          title="馆藏书卷与在线规范 (书库抽屉)"
          onClick={onOpenLibrary}
        >
          <BookOpen className="size-5" />
        </Button>
      ) : null}

      {onOpenNotes ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 rounded-none border-l-2 border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          aria-label="全书札记中心"
          title="全书札记中心与闪卡"
          onClick={onOpenNotes}
        >
          <BookmarkCheck className="size-5" />
        </Button>
      ) : null}

      {onOpenSettings ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-auto size-10 rounded-none border-l-2 border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          aria-label="应用设置"
          title="应用设置 (Ctrl+,)"
          onClick={onOpenSettings}
        >
          <Settings className="size-5" />
        </Button>
      ) : null}
    </aside>
  )
}

