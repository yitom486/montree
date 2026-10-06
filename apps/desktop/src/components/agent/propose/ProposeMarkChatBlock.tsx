import { Bookmark, ChevronDown, ChevronRight, Highlighter } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  AgentChatItem,
  AgentChatItemBody,
} from '@/components/agent/chat/AgentChatItem'
import { ProposeMarkCard } from '@/components/agent/propose/ProposeMarkCard'
import { Button } from '@/components/ui/button'
import { adoptProposedMark } from '@/lib/agent/context/propose-mark'
import { toastMarkProposalFailure } from '@/lib/agent/mark-proposal-failure'
import { cn } from '@/lib/utils'
import type { MarkProposalStatus, ProposedMark } from '@montree/annotations'

interface ProposeMarkChatBlockProps {
  proposal: ProposedMark
  status?: MarkProposalStatus
  /** 待确认默认折叠；批注小窗等可传 true */
  defaultExpanded?: boolean
  embedded?: boolean
  className?: string
  onNoteChange?: (note: string) => void
  onAdopt?: (note: string) => void | Promise<void>
  onDismiss?: () => void
  onResolved?: (status: Exclude<MarkProposalStatus, 'pending'>) => void
  extraActions?: ReactNode
}

function excerptPreview(excerpt: string, max = 28): string {
  const text = excerpt.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function collapsedLabel(
  proposal: ProposedMark,
  status: MarkProposalStatus,
): string {
  const kind = proposal.kind === 'highlight' ? '高亮' : '批注'
  const preview = excerptPreview(proposal.excerpt)
  if (status === 'adopted') return `已保存${kind}`
  if (status === 'dismissed') return `已忽略${kind}提议`
  if (preview) return `${kind}草稿 · ${preview} · 待确认`
  return `${kind}草稿 · 待确认`
}

/** 聊天气泡内可折叠提议块（权限卡 / 工具卡同级视觉）。 */
export function ProposeMarkChatBlock({
  proposal,
  status = 'pending',
  defaultExpanded = false,
  embedded = false,
  className,
  onNoteChange,
  onAdopt,
  onDismiss,
  onResolved,
  extraActions,
}: ProposeMarkChatBlockProps) {
  const pending = status === 'pending'
  const [open, setOpen] = useState(defaultExpanded)
  const label = collapsedLabel(proposal, status)
  const Icon = proposal.kind === 'highlight' ? Highlighter : Bookmark

  if (embedded && !pending) {
    return (
      <p className="text-[10px] text-muted-foreground">{label}</p>
    )
  }

  return (
    <AgentChatItem
      variant="card"
      tone={pending ? 'tool-pending' : 'tool'}
      streaming={false}
      probe="mark-proposal"
      messageId={proposal.id}
      role="mark-proposal"
      className={cn(embedded ? 'mt-2' : undefined, className)}
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            proposal.kind === 'highlight'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-primary',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
          {label}
        </span>
        {pending ? (
          <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400">
            展开确认
          </span>
        ) : null}
      </button>

      {open ? (
        <AgentChatItemBody className="border-border/30">
          <ProposeMarkCard
            proposal={proposal}
            status={status}
            compact
            hideHeader
            className="mt-0 border-0 bg-transparent p-0"
            onNoteChange={onNoteChange}
            onAdopt={onAdopt}
            onDismiss={onDismiss}
            onResolved={onResolved}
            extraActions={extraActions}
          />
        </AgentChatItemBody>
      ) : null}
    </AgentChatItem>
  )
}

interface ProposeMarkBlockListProps {
  proposals: Array<{
    proposal: ProposedMark
    status: MarkProposalStatus
  }>
  defaultExpanded?: boolean
  embedded?: boolean
  onResolved?: (proposalId: string, status: Exclude<MarkProposalStatus, 'pending'>) => void
  onNoteChange?: (proposalId: string, note: string) => void
  onAdopt?: (proposalId: string, note: string) => void | Promise<void>
  onDismiss?: (proposalId: string) => void
  extraActionsFor?: (proposalId: string) => ReactNode
}

/** 同一条 Agent 回复下多条提议（P3 批量勾选采用）。 */
export function ProposeMarkBlockList({
  proposals,
  defaultExpanded = false,
  embedded = false,
  onResolved,
  onNoteChange,
  onAdopt,
  onDismiss,
  extraActionsFor,
}: ProposeMarkBlockListProps) {
  if (proposals.length === 0) return null

  const pendingRows = proposals.filter((row) => row.status === 'pending')
  const batchMode = pendingRows.length >= 2
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(pendingRows.map((row) => row.proposal.id)),
  )
  const [open, setOpen] = useState(defaultExpanded)

  const selectedPending = useMemo(
    () => pendingRows.filter((row) => selectedIds.has(row.proposal.id)),
    [pendingRows, selectedIds],
  )

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelectedIds(
      checked ? new Set(pendingRows.map((row) => row.proposal.id)) : new Set(),
    )
  }

  const handleAdoptSelected = () => {
    if (selectedPending.length === 0) return
    void (async () => {
      let ok = 0
      for (const row of selectedPending) {
        try {
          if (onAdopt) {
            await onAdopt(row.proposal.id, row.proposal.note)
          } else {
            await adoptProposedMark({
              note: row.proposal.note,
              excerpt: row.proposal.excerpt,
              flatIndex: row.proposal.flatIndex,
              kind: row.proposal.kind,
            })
          }
          onResolved?.(row.proposal.id, 'adopted')
          ok += 1
        } catch (cause) {
          toastMarkProposalFailure(cause, { flatIndex: row.proposal.flatIndex })
        }
      }
      if (ok > 0) toast.success(`已保存 ${ok} 条标记`)
    })()
  }

  const handleDismissPending = () => {
    for (const row of pendingRows) {
      if (onDismiss) onDismiss(row.proposal.id)
      else onResolved?.(row.proposal.id, 'dismissed')
    }
  }

  if (batchMode) {
    const allChecked =
      pendingRows.length > 0 && pendingRows.every((row) => selectedIds.has(row.proposal.id))

    return (
      <AgentChatItem
        variant="card"
        tone="tool-pending"
        streaming={false}
        probe="mark-proposal-batch"
        role="mark-proposal-batch"
        className={cn(embedded ? 'mt-2' : undefined)}
      >
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Highlighter className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
            批量划重点 · {pendingRows.length} 条待确认
          </span>
        </button>

        {open ? (
          <AgentChatItemBody className="space-y-2 border-border/30 px-2.5 pb-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 rounded border-input"
                checked={allChecked}
                onChange={(event) => toggleAll(event.target.checked)}
              />
              全选
            </label>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {pendingRows.map((row) => {
                const checked = selectedIds.has(row.proposal.id)
                const Icon = row.proposal.kind === 'highlight' ? Highlighter : Bookmark
                return (
                  <label
                    key={row.proposal.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-border/50 px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 shrink-0 rounded border-input"
                      checked={checked}
                      onChange={(event) => toggleOne(row.proposal.id, event.target.checked)}
                    />
                    <Icon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-[10px] leading-relaxed text-foreground/90">
                      {excerptPreview(row.proposal.excerpt, 64)}
                      {row.proposal.note.trim() ? (
                        <span className="mt-0.5 block text-muted-foreground">
                          批注：{excerptPreview(row.proposal.note, 40)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-7 px-2.5 text-[11px]"
                disabled={selectedPending.length === 0}
                onClick={handleAdoptSelected}
              >
                采用选中 ({selectedPending.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-[11px]"
                onClick={handleDismissPending}
              >
                全部忽略
              </Button>
            </div>
          </AgentChatItemBody>
        ) : null}

        {proposals
          .filter((row) => row.status !== 'pending')
          .map((row) => (
            <ProposeMarkChatBlock
              key={row.proposal.id}
              proposal={row.proposal}
              status={row.status}
              embedded={embedded}
              onResolved={
                onResolved ? (status) => onResolved(row.proposal.id, status) : undefined
              }
            />
          ))}
      </AgentChatItem>
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', embedded ? 'mt-2' : undefined)}>
      {proposals.map((row) => (
        <ProposeMarkChatBlock
          key={row.proposal.id}
          proposal={row.proposal}
          status={row.status}
          defaultExpanded={defaultExpanded}
          embedded={embedded}
          onNoteChange={
            onNoteChange ? (note) => onNoteChange(row.proposal.id, note) : undefined
          }
          onAdopt={onAdopt ? (note) => onAdopt(row.proposal.id, note) : undefined}
          onDismiss={onDismiss ? () => onDismiss(row.proposal.id) : undefined}
          onResolved={
            onResolved ? (status) => onResolved(row.proposal.id, status) : undefined
          }
          extraActions={extraActionsFor?.(row.proposal.id)}
        />
      ))}
    </div>
  )
}
