import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { TextDocument } from '@/lib/editor/text-document'
import { useEditProposals } from '@/hooks/editor/useEditProposals'

function preview(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat || '（空）'
}

/** 审阅栏：当前文档的 AI 修改建议导航、全部接受/拒绝与列表。 */
export function ProposalReviewBar({ document }: { document?: TextDocument }) {
  const proposals = useEditProposals(document)
  const pending = useMemo(() => proposals.filter((item) => item.status === 'pending'), [proposals])
  const invalid = useMemo(() => proposals.filter((item) => item.status === 'invalid'), [proposals])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (index >= pending.length) setIndex(Math.max(0, pending.length - 1)) }, [index, pending.length])
  if (!document || (!pending.length && !invalid.length)) return null

  const run = (action: () => unknown) => {
    try { setError(null); action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const go = (next: number) => {
    if (!pending.length) return
    const target = (next + pending.length) % pending.length
    setIndex(target)
    const item = pending[target]
    document.revealRange(item.from, item.to)
  }
  const current = pending[index]

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 border-b bg-emerald-500/5 px-2 py-1 text-xs" role="region" aria-label="AI 修改建议" data-testid="proposal-review-bar">
      <Sparkles className="size-3.5 text-emerald-600" aria-hidden="true" />
      <span className="font-medium" data-testid="proposal-review-count">
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="ghost" aria-label="建议列表">列表<ChevronDown /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-80 overflow-y-auto">
          <DropdownMenuLabel>修改建议</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {[...pending, ...invalid].map((item) => (
            <DropdownMenuItem key={item.id} className="flex flex-col items-start gap-0.5"
              onSelect={() => { if (item.status === 'pending') go(pending.indexOf(item)); else document.revealRange(item.from, item.from) }}>
              <span className="text-[11px] text-muted-foreground">第 {document.state.doc.lineAt(Math.min(item.from, document.state.doc.length)).number} 行{item.status === 'invalid' ? ' · 已失效' : ''}</span>
              <span className="line-through decoration-red-500/70">{preview(item.expectedText)}</span>
              <span className="text-emerald-700 dark:text-emerald-400">{preview(item.replacement)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto flex items-center gap-1">
        {current && (
          <>
            <Button size="xs" variant="outline" onClick={() => run(() => document.proposals.accept(current.id))} data-testid="proposal-accept-current"><Check />接受当前</Button>
            <Button size="xs" variant="outline" onClick={() => run(() => document.proposals.reject(current.id))}><X />拒绝当前</Button>
          </>
        )}
        {invalid.length > 0 && <Button size="xs" variant="ghost" onClick={() => run(document.proposals.dismissInvalid)}>清除失效</Button>}
        {pending.length > 1 && (
          <>
            <Button size="xs" variant="default" onClick={() => run(document.proposals.acceptAll)} data-testid="proposal-accept-all"><Check />全部接受</Button>
            <Button size="xs" variant="ghost" onClick={() => run(document.proposals.rejectAll)} data-testid="proposal-reject-all"><X />全部拒绝</Button>
          </>
        )}
      </div>
      {error && <span className="basis-full text-destructive" role="alert">{error}</span>}
    </div>
  )
}
