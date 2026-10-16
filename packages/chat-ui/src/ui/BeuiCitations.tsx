// BeUI Citations adapter; MIT © 2026 Saurabh Chauhan, see ../LICENSE.beui.
import { useId, useState } from 'react'
import { BookOpenText, ChevronDown, ExternalLink } from 'lucide-react'
import { cn } from './cn'

export interface BeuiCitationItem {
  id: string
  title: string
  detail?: string
  excerpt?: string
  url?: string
  onSelect?: () => void
}

function webUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch { return undefined }
}

/** 明确结构化来源才接入；本地文档经宿主定位，不生成远程 favicon 请求。 */
export function BeuiCitations({ citations, label = '引用来源' }: { citations: BeuiCitationItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  if (!citations.length) return null
  return (
    <div data-slot="citations" className="bui-anim mt-2 min-w-0 border-t border-border/35 pt-1">
      <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(value => !value)} className="flex min-h-11 items-center gap-2 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
        <BookOpenText aria-hidden className="size-3.5" />
        <span>{label} · {citations.length} 处</span>
        <ChevronDown aria-hidden className={cn('size-3 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
      {open ? <ol id={contentId} className="space-y-1 rounded-lg bg-muted/20 p-1.5">
        {citations.map((citation, index) => {
          const url = webUrl(citation.url)
          const content = <><span className="shrink-0 font-mono text-[10px] text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1"><span className="block break-words text-xs font-medium">{citation.title}</span>{citation.detail ? <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">{citation.detail}</span> : null}{citation.excerpt ? <span className="mt-1 block whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{citation.excerpt}</span> : null}</span>{url ? <ExternalLink aria-hidden className="size-3 shrink-0" /> : null}</>
          const className = 'flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring'
          return <li key={citation.id} data-citation-id={citation.id}>{citation.onSelect ? <button type="button" onClick={citation.onSelect} className={className}>{content}</button> : url ? <a href={url} target="_blank" rel="noreferrer noopener" className={className}>{content}</a> : <div className={className}>{content}</div>}</li>
        })}
      </ol> : null}
    </div>
  )
}
