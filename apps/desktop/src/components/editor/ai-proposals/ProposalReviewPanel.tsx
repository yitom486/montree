import { Check, LocateFixed, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TextDocument } from '@/lib/editor/text-document'
import type { EditProposal } from '@/lib/editor/ai-proposals/proposal-types'
import { useEditProposals } from '@/hooks/editor/useEditProposals'

const STATUS_LABEL: Record<EditProposal['status'], string> = { drafting: '生成中', pending: '待审', accepted: '已接受', rejected: '已拒绝', invalid: '已失效' }
const STATUS_CLASS: Record<EditProposal['status'], string> = {
  drafting: 'text-muted-foreground', pending: 'text-emerald-700 dark:text-emerald-400', accepted: 'text-muted-foreground',
  rejected: 'text-muted-foreground', invalid: 'text-amber-600',
}

function clip(text: string, max = 400): string { return text.length > max ? `${text.slice(0, max)}…` : text }

/** 右侧审阅面板：列出全部建议（原文/替换），可定位、接受、拒绝。 */
export function ProposalReviewPanel({ document, onClose }: { document: TextDocument; onClose: () => void }) {
  const proposals = useEditProposals(document)
  const ordered = [...proposals].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || a.from - b.from)
  const line = (offset: number) => document.state.doc.lineAt(Math.min(offset, document.state.doc.length)).number
  const safe = (run: () => unknown) => { try { run() } catch (error) { console.warn('[proposals]', error) } }
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-background" aria-label="修改建议审阅面板" data-testid="proposal-review-panel">
      <div className="flex h-8 items-center justify-between border-b px-2 text-xs font-medium">
        <span>修改建议（{proposals.filter((item) => item.status === 'pending').length} 待审）</span>
        <Button size="icon-xs" variant="ghost" aria-label="收起审阅面板" onClick={onClose}><X /></Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ol className="flex flex-col gap-2 p-2">
          {ordered.map((item) => (
            <li key={item.id} className="rounded-md border p-2 text-xs" data-testid="proposal-panel-item" data-proposal-id={item.id} data-status={item.status}>
              <div className="mb-1 flex items-center gap-1 text-[11px]">
                <span className="text-muted-foreground">第 {line(item.from)} 行</span>
                <span className={STATUS_CLASS[item.status]}>· {STATUS_LABEL[item.status]}</span>
                {item.source === 'text-edit' && <span className="text-muted-foreground">· 审阅模式</span>}
              </div>
              {item.expectedText && <div className="whitespace-pre-wrap break-words text-red-700/80 line-through decoration-red-500/70 dark:text-red-400/80">{clip(item.expectedText)}</div>}
              <div className="whitespace-pre-wrap break-words text-emerald-800 dark:text-emerald-300">{item.replacement ? clip(item.replacement) : <i className="text-muted-foreground">（删除）</i>}</div>
              {(item.invalidReason && item.status === 'invalid') && <div className="mt-1 text-amber-600">{item.invalidReason}</div>}
              {item.note && <div className="mt-1 text-muted-foreground" data-testid="proposal-panel-note">{item.note}</div>}
              <div className="mt-1.5 flex gap-1">
                <Button size="xs" variant="ghost" onClick={() => document.revealRange(item.from, item.status === 'pending' ? item.to : item.from)} aria-label="定位"><LocateFixed />定位</Button>
                {item.status === 'pending' && <Button size="xs" variant="outline" onClick={() => safe(() => document.proposals.accept(item.id))} data-testid="proposal-panel-accept"><Check />接受</Button>}
                {(item.status === 'pending' || item.status === 'invalid') && <Button size="xs" variant="ghost" onClick={() => safe(() => document.proposals.reject(item.id))} data-testid="proposal-panel-reject"><X />{item.status === 'invalid' ? '忽略' : '拒绝'}</Button>}
              </div>
            </li>
          ))}
        </ol>
      </ScrollArea>
    </aside>
  )
}
