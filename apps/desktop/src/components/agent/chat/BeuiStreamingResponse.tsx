// Adapted from beui.dev/components/agents/streaming-response (MIT © 2026 Saurabh Chauhan).
// See ../LICENSE.beui. CSS replaces Motion; Markdown, ACP and citations stay owned by the host.
import type { ReactNode } from 'react'

export function BeuiStreamingResponse({ streaming, actions, children }: {
  streaming: boolean
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div data-slot="streaming-response" data-state={streaming ? 'streaming' : 'complete'} aria-busy={streaming} className="group/response min-w-0 w-full">
      <div className="min-w-0 text-[13px] leading-relaxed">{children}</div>
      {!streaming && actions ? (
        <div aria-label="回答操作" className="bui-anim mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/response:opacity-100 focus-within:opacity-100" style={{ animation: 'bui-fade-up 180ms ease-out both' }}>
          {actions}
        </div>
      ) : null}
    </div>
  )
}
