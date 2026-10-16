import { Bookmark, Highlighter } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
// 自宿主 `apps/desktop/src/components/agent/propose/ProposeMarkCard.tsx` 整搬改 props-ify（M3c 私有复刻，不进 barrel；
// 仅供包内 `propose-mark-chat-block` 使用）：`Button` 改 `./button`；`cn` 改 `./cn`；
// 去 store fallback：`adoptProposedMark/dismissProposedMark` 移宿主（缺省仅 `onResolved`，不写库）；
// 去宿主 toast：成功/失败经可选 `onToast/onError` 回宿主，缺省静默（宿主 `onAdopt/onError` 内弹 toast）。
import { Button } from './button'
import { cn } from './cn'
import type { MarkProposalStatus, ProposedMark } from '@montree/annotations'

interface ProposeMarkCardProps {
  proposal: ProposedMark
  status?: MarkProposalStatus
  compact?: boolean
  /** 外层 ProposeMarkChatBlock 已展示标题时隐藏 */
  hideHeader?: boolean
  className?: string
  /** 批注小窗：编辑同步到外层 textarea */
  onNoteChange?: (note: string) => void
  /** 批注小窗：采用走对话框 onSave（必填化去 fallback；缺省仅 onResolved 不写库） */
  onAdopt?: (note: string) => void | Promise<void>
  onDismiss?: () => void
  onResolved?: (status: Exclude<MarkProposalStatus, 'pending'>) => void
  extraActions?: ReactNode
  /** 采用失败回宿主（宿主弹 `toastMarkProposalFailure`；缺省静默） */
  onError?: (cause: unknown, context: { flatIndex?: number }) => void
  /** 采用成功回宿主（宿主弹 `toast.success`；缺省静默） */
  onToast?: (kind: 'adopted', message: string) => void
}

export function ProposeMarkCard({
  proposal,
  status = 'pending',
  compact = false,
  hideHeader = false,
  className,
  onNoteChange,
  onAdopt,
  onDismiss,
  onResolved,
  extraActions,
  onError,
  onToast,
}: ProposeMarkCardProps) {
  const [note, setNote] = useState(proposal.note)

  useEffect(() => {
    setNote(proposal.note)
  }, [proposal.id, proposal.note])

  const resolved = status !== 'pending'
  const kindLabel = proposal.kind === 'highlight' ? '高亮' : '批注'

  const handleNoteChange = (value: string) => {
    setNote(value)
    onNoteChange?.(value)
  }

  const handleAdopt = () => {
    const trimmed = note.trim()
    const run = async () => {
      if (onAdopt) {
        await onAdopt(trimmed)
      }
      // 去 fallback：缺 onAdopt 时不写库（宿主 M4 经 onAdopt 传入 `adoptProposedMark`），仅落定。
      onResolved?.('adopted')
      onToast?.('adopted', trimmed ? '已保存批注' : '已添加高亮')
    }
    void run().catch((cause) => {
      onError?.(cause, { flatIndex: proposal.flatIndex })
    })
  }

  const handleDismiss = () => {
    if (onDismiss) onDismiss()
    // 去 fallback：缺 onDismiss 时不碰 `dismissProposedMark` store，仅落定（宿主经 onDismiss 传入）。
    onResolved?.('dismissed')
  }

  return (
    <div
      className={cn(
        hideHeader ? undefined : 'rounded-xl border border-primary/30 bg-primary/5',
        hideHeader ? 'space-y-2' : compact ? 'mt-2 px-2 py-2' : 'px-3 py-2.5',
        className,
      )}
      data-testid="propose-mark-card"
      data-proposal-status={status}
    >
      {hideHeader ? (
        <div className="space-y-2">
          {proposal.excerpt ? (
            <blockquote className="max-h-20 overflow-y-auto border-l-2 border-primary/40 pl-2.5 text-[11px] leading-relaxed text-muted-foreground italic">
              {proposal.excerpt}
            </blockquote>
          ) : null}
          {!resolved ? (
            <>
              <textarea
                value={note}
                onChange={(event) => handleNoteChange(event.target.value)}
                rows={proposal.kind === 'highlight' ? 2 : 4}
                className="flex min-h-[56px] w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={
                  proposal.kind === 'highlight'
                    ? '可选：补充一句批注，留空则仅高亮…'
                    : '可直接修改后再采用…'
                }
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={handleAdopt}
                >
                  采用并保存
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={handleDismiss}
                >
                  不要了
                </Button>
                {extraActions}
              </div>
            </>
          ) : null}
        </div>
      ) : (
      <div className="flex items-start gap-2">
        {proposal.kind === 'highlight' ? (
          <Highlighter className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <Bookmark className="mt-0.5 size-3.5 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          {!hideHeader ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <p className="text-[11px] font-medium text-foreground/90">
                {resolved
                  ? status === 'adopted'
                    ? `已采用${kindLabel}`
                    : `已忽略${kindLabel}提议`
                  : `AI 提议${kindLabel}`}
              </p>
              {proposal.locationHint ? (
                <span className="text-[10px] text-muted-foreground">
                  {proposal.locationHint}
                </span>
              ) : null}
            </div>
          ) : null}

          {proposal.excerpt ? (
            <blockquote className="max-h-20 overflow-y-auto border-l-2 border-primary/40 pl-2.5 text-[11px] leading-relaxed text-muted-foreground italic">
              {proposal.excerpt}
            </blockquote>
          ) : null}

          {!resolved ? (
            <>
              <textarea
                value={note}
                onChange={(event) => handleNoteChange(event.target.value)}
                rows={proposal.kind === 'highlight' ? 2 : 4}
                className="flex min-h-[56px] w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={
                  proposal.kind === 'highlight'
                    ? '可选：补充一句批注，留空则仅高亮…'
                    : '可直接修改后再采用…'
                }
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={handleAdopt}
                >
                  采用并保存
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={handleDismiss}
                >
                  不要了
                </Button>
                {extraActions}
              </div>
            </>
          ) : null}
        </div>
      </div>
      )}
    </div>
  )
}
