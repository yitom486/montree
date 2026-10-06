import { History, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { findBuiltinAcpRuntime } from '@montree/contracts'
import {
  useAcpUiStore,
  selectThreadsForRuntime,
  type AcpChatThread,
} from '@/stores/acp-ui-store'

function formatThreadTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface AgentHistoryMenuProps {
  workspaceRoot?: string
  disabled?: boolean
  onAfterSwitchThread?: () => void
}

export function AgentHistoryMenu({
  workspaceRoot,
  disabled,
  onAfterSwitchThread,
}: AgentHistoryMenuProps) {
  const threads = useAcpUiStore((s) => s.threads)
  const selectedRuntimeId = useAcpUiStore((s) => s.selectedRuntimeId)
  const activeThreadId = useAcpUiStore((s) => s.activeThreadId)
  const prompting = useAcpUiStore((s) => s.prompting)
  const createThread = useAcpUiStore((s) => s.createThread)
  const switchThread = useAcpUiStore((s) => s.switchThread)
  const deleteThread = useAcpUiStore((s) => s.deleteThread)

  // 按 runtime 过滤已验证多线程分桶：threads.runtimeId + agentSessionIds 双维隔离，
  // 切换运行时只列本 runtime 线程（见 selectThreadsForRuntime + session-slice 专属线程逻辑）。
  const runtimeThreads = selectThreadsForRuntime(threads, selectedRuntimeId)
  const runtimeName = findBuiltinAcpRuntime(selectedRuntimeId)?.name ?? selectedRuntimeId

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg"
          title="对话历史"
          disabled={disabled}
        >
          <History className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>
            {runtimeName} 对话历史
          </span>
          <span className="font-normal">{runtimeThreads.length}</span>
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="gap-2 text-xs"
          disabled={prompting}
          onSelect={(e) => {
            e.preventDefault()
            createThread(workspaceRoot)
            onAfterSwitchThread?.()
          }}
        >
          <Plus className="size-3.5" />
          新对话
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="max-h-64 overflow-y-auto">
          {runtimeThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={thread.id === activeThreadId}
              canSwitch={!prompting}
              onSelect={() => {
                switchThread(thread.id)
                onAfterSwitchThread?.()
              }}
              onDelete={() => deleteThread(thread.id)}
            />
          ))}
        </div>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          切换历史会自动连接并尝试恢复该对话的 Agent 会话；失败时仍可查看本地气泡。
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThreadRow({
  thread,
  active,
  canSwitch,
  onSelect,
  onDelete,
}: {
  thread: AcpChatThread
  active: boolean
  canSwitch: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const preview =
    thread.messages.find((m) => m.role === 'user')?.text.replace(/\s+/g, ' ').trim() ??
    '尚无消息'

  return (
    <div
      className={cn(
        'group flex items-start gap-1 rounded-md px-1 py-0.5',
        active && 'bg-accent/60',
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 rounded-md px-1.5 py-1.5 text-left disabled:opacity-50"
        disabled={!canSwitch && !active}
        onClick={onSelect}
      >
        <div className="truncate text-xs font-medium">{thread.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="shrink-0">{formatThreadTime(thread.updatedAt)}</span>
          <span className="truncate opacity-80">{preview.slice(0, 40)}</span>
        </div>
      </button>
      <button
        type="button"
        className="mt-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        title="删除对话"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}
