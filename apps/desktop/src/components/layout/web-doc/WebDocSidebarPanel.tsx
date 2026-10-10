import { Globe } from 'lucide-react'
import { WebDocUrlField } from '@/components/layout/web-doc/WebDocUrlField'

function formatWebDocLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.hostname}${path}`
  } catch {
    return url
  }
}

interface WebDocSidebarPanelProps {
  onOpenWebDoc: (url: string) => void
  recentWebUrls?: string[]
}

/** 侧栏底部的在线文档快捷入口（支持即时输入 URL 与最近列表快速切换） */
export function WebDocSidebarPanel({
  onOpenWebDoc,
  recentWebUrls = [],
}: WebDocSidebarPanelProps) {
  const recent = recentWebUrls.slice(0, 5)

  return (
    <div className="shrink-0 space-y-2 border-t border-border/60 bg-sidebar p-2">
      <p className="flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Globe className="size-3 shrink-0" />
        在线文档
      </p>
      <WebDocUrlField onOpen={onOpenWebDoc} />
      {recent.length > 0 ? (
        <ul className="space-y-0.5">
          {recent.map((url) => (
            <li key={url}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                title={url}
                onClick={() => onOpenWebDoc(url)}
              >
                <Globe className="mt-0.5 size-3 shrink-0 opacity-60" />
                <span className="min-w-0 break-all leading-snug">{formatWebDocLabel(url)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
