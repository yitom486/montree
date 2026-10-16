import { cn } from './cn'
import { buildSimpleDiffLines, type ChatToolDiff } from '@montree/chat-core'

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

interface AgentDiffPreviewProps {
  diffs: ChatToolDiff[]
}

// 自宿主 `apps/desktop/src/components/agent/tools/AgentDiffPreview.tsx` 整搬（M3c 私有复刻，不进 barrel；
// 仅供包内 `agent-tool-call-card` 使用）：`cn` 改 `./cn`；`AcpToolDiff/buildSimpleDiffLines` 改 `@montree/chat-core`；余逐字。
export function AgentDiffPreview({ diffs }: AgentDiffPreviewProps) {
  if (diffs.length === 0) return null

  return (
    <div className="min-w-0 max-w-full space-y-2">
      {diffs.map((diff) => {
        const lines = buildSimpleDiffLines(diff.oldText, diff.newText)
        const added = lines.filter((l) => l.kind === 'add').length
        const removed = lines.filter((l) => l.kind === 'del').length
        return (
          <div
            key={diff.path}
            className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/50 bg-background/60"
          >
            <div className="flex items-center gap-2 border-b border-border/40 px-2 py-1">
              <span className="truncate font-mono text-[10px] font-medium" title={diff.path}>
                {basename(diff.path)}
              </span>
              <span className="ml-auto shrink-0 text-[10px] tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="text-red-600 dark:text-red-400">−{removed}</span>
              </span>
            </div>
            <pre className="max-h-48 max-w-full overflow-x-auto overflow-y-auto text-[10px] leading-relaxed">
              {lines.map((line, i) => (
                <div
                  key={`${i}-${line.kind}-${line.text.slice(0, 24)}`}
                  className={cn(
                    'whitespace-pre-wrap break-all px-2 py-px',
                    line.kind === 'add' &&
                      'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
                    line.kind === 'del' && 'bg-red-500/10 text-red-800 dark:text-red-300',
                    line.kind === 'same' && 'text-muted-foreground',
                  )}
                >
                  <span className="mr-1 inline-block w-3 select-none opacity-60">
                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                  </span>
                  {line.text || ' '}
                </div>
              ))}
            </pre>
          </div>
        )
      })}
    </div>
  )
}
