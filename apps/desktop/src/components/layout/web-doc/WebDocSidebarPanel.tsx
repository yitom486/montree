import { ChevronDown, ChevronRight, Globe } from 'lucide-react'
import { WebDocUrlField } from '@/components/layout/web-doc/WebDocUrlField'
import { cn } from '@/lib/utils'

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
  /** 侧栏折叠模式：仅显示标题栏 */
  collapsed?: boolean
  onToggle?: () => void
}

/** 侧栏在线文档手风琴面板（支持可折叠、即时输入 URL 与最近列表快速切换） */
export function WebDocSidebarPanel({
  onOpenWebDoc,
  recentWebUrls = [],
  collapsed = false,
  onToggle,
}: WebDocSidebarPanelProps) {
  const recent = recentWebUrls.slice(0, 5)

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col bg-sidebar',
        collapsed ? 'shrink-0' : 'shrink-0 overflow-hidden',
      )}
    >
      <button
        type="button"
        className="flex w-full shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 hover:text-foreground transition-colors"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? '展开在线文档' : '折叠在线文档'}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
        <Globe className="size-3.5 shrink-0" />
        <span>在线文档</span>
        {recent.length > 0 && (
          <span className="ml-auto rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-normal normal-case text-muted-foreground/80">
            {recent.length}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="shrink-0 space-y-2 border-b border-border/60 bg-sidebar p-2.5">
          <WebDocUrlField onOpen={onOpenWebDoc} />
          {recent.length > 0 ? (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
              {recent.map((url) => (
                <li key={url}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors"
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
      )}
    </section>
  )
}

