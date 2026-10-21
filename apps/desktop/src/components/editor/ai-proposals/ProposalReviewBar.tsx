import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, MoreHorizontal, PanelRight, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { TextDocument } from '@/lib/editor/text-document'
import { useEditProposals } from '@/hooks/editor/useEditProposals'
import { ProposalReviewPanel } from './ProposalReviewPanel'

const PANEL_KEY = 'montree.proposalPanelOpen'
const noop = () => () => {}

function useNotice(document?: TextDocument) {
  return useSyncExternalStore(document ? document.proposals.subscribe : noop, () => document?.proposals.notice() ?? null, () => null)
}

/** 紧凑审阅栏：计数、导航、接受/拒绝当前、更多（全部接受/拒绝）与右侧面板开关。 */
export function ProposalReviewBar({ document, panelOpen, onTogglePanel }: { document?: TextDocument; panelOpen?: boolean; onTogglePanel?: () => void }) {
  const proposals = useEditProposals(document)
  const notice = useNotice(document)
  const pending = useMemo(() => proposals.filter((item) => item.status === 'pending'), [proposals])
  const invalid = useMemo(() => proposals.filter((item) => item.status === 'invalid'), [proposals])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (index >= pending.length) setIndex(Math.max(0, pending.length - 1)) }, [index, pending.length])
  if (!document || (!pending.length && !invalid.length && !notice)) return null

  const run = (action: () => unknown) => {
    try { setError(null); action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const go = (next: number) => {
    if (!pending.length) return
    const target = (next + pending.length) % pending.length
    setIndex(target)
    document.revealRange(pending[target].from, pending[target].to)
  }
  const current = pending[index]

  return (
    <div className="flex h-8 items-center gap-1 border-b bg-emerald-500/5 px-2 text-xs" role="region" aria-label="AI 修改建议" data-testid="proposal-review-bar">
      <Sparkles className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
      <span className="shrink-0 font-medium" data-testid="proposal-review-count">
        {pending.length ? `${pending.length} 处修改建议` : '无待处理建议'}
        {invalid.length ? <span className="ml-1 text-amber-600">· {invalid.length} 处已失效</span> : null}
      </span>
      {pending.length > 0 && (
        <>
          <Button size="icon-xs" variant="ghost" title="上一处" aria-label="上一处建议" onClick={() => go(index - 1)}><ChevronLeft /></Button>
          <span className="tabular-nums text-muted-foreground" data-testid="proposal-review-position">{index + 1}/{pending.length}</span>
          <Button size="icon-xs" variant="ghost" title="下一处" aria-label="下一处建议" onClick={() => go(index + 1)}><ChevronRight /></Button>
        </>
      )}
      {notice && (
        <span className="ml-1 flex min-w-0 items-center gap-1 truncate rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400" role="status" data-testid="proposal-notice">
          <span className="truncate">{notice.text}</span>
          <button type="button" className="shrink-0 opacity-70 hover:opacity-100" aria-label="关闭提示" onClick={document.proposals.dismissNotice}><X className="size-3" /></button>
        </span>
      )}
      {error && <span className="truncate text-destructive" role="alert">{error}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {current && (
          <>
            <Button size="xs" variant="outline" onClick={() => run(() => document.proposals.accept(current.id))} data-testid="proposal-accept-current"><Check />接受</Button>
            <Button size="xs" variant="outline" onClick={() => run(() => document.proposals.reject(current.id))} data-testid="proposal-reject-current"><X />拒绝</Button>
          </>
        )}
        {(pending.length > 1 || invalid.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label="更多审阅操作" data-testid="proposal-more"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {pending.length > 1 && <DropdownMenuItem onSelect={() => run(document.proposals.acceptAll)} data-testid="proposal-accept-all"><Check />全部接受（{pending.length}）</DropdownMenuItem>}
              {pending.length > 1 && <DropdownMenuItem onSelect={() => run(document.proposals.rejectAll)} data-testid="proposal-reject-all"><X />全部拒绝</DropdownMenuItem>}
              {invalid.length > 0 && <DropdownMenuItem onSelect={() => run(document.proposals.dismissInvalid)} data-testid="proposal-dismiss-invalid">清除失效（{invalid.length}）</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onTogglePanel && (
          <Button size="icon-xs" variant={panelOpen ? 'secondary' : 'ghost'} title="审阅面板" aria-label="审阅面板" aria-pressed={panelOpen} onClick={onTogglePanel} data-testid="proposal-panel-toggle"><PanelRight /></Button>
        )}
      </div>
    </div>
  )
}

/** 审阅栏 + 右侧可折叠审阅面板的布局外壳，包住编辑区。 */
export function ProposalReviewLayout({ document, children }: { document?: TextDocument; children: ReactNode }) {
  const proposals = useEditProposals(document)
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_KEY) === '1' } catch { return false } })
  const toggle = () => setPanelOpen((open) => { try { localStorage.setItem(PANEL_KEY, open ? '0' : '1') } catch { /* ignore */ } return !open })
  const showPanel = panelOpen && proposals.length > 0
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProposalReviewBar document={document} panelOpen={showPanel} onTogglePanel={toggle} />
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
        {showPanel && document && <ProposalReviewPanel document={document} onClose={toggle} />}
      </div>
    </div>
  )
}
