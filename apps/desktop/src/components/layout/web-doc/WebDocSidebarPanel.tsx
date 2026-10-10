import { Globe } from 'lucide-react'

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

/** 有工作区时侧栏底部的在线文档快捷入口（输入框已收敛至顶栏地址栏，侧栏仅保留精简最近列表） */
export function WebDocSidebarPanel({
  onOpenWebDoc,
  recentWebUrls = [],
}: WebDocSidebarPanelProps) {
  const recent = recentWebUrls.slice(0, 5)

  if (recent.length === 0) return null

  return (
    <div className="shrink-0 space-y-1.5 border-t border-border/60 bg-sidebar p-2">
      <p className="flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Globe className="size-3 shrink-0" />
        最近在线文档
      </p>
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
    </div>
  )
}
