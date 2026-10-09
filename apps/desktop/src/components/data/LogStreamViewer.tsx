import { memo, useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  Code2,
  Info,
  ScrollText,
  Search,
  X,
} from 'lucide-react'
import { LogDataset, type LogEntry, type LogLevel } from '@/lib/data/log-parser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface LogStreamViewerProps {
  content: string
  onChange?: (newContent: string) => void
  readOnly?: boolean
}

export const LogStreamViewer = memo(function LogStreamViewer({
  content,
  onChange,
  readOnly = true,
}: LogStreamViewerProps) {
  const [viewMode, setViewMode] = useState<'stream' | 'raw'>('stream')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(
    () => new Set(['error', 'warn', 'info', 'debug', 'trace', 'unknown']),
  )
  const [expandedStacks, setExpandedStacks] = useState<Set<number>>(() => new Set())

  // 解析日志流
  const dataset = useMemo(() => LogDataset.parse(content), [content])
  const stats = useMemo(() => dataset.getStats(), [dataset])

  // 过滤后的条目
  const filteredEntries = useMemo(() => {
    return dataset.filter({
      levels: Array.from(selectedLevels),
      searchQuery: searchQuery.trim() || undefined,
      caseSensitive: false,
    })
  }, [dataset, selectedLevels, searchQuery])

  // 级别过滤切换
  const toggleLevel = (lvl: LogLevel) => {
    setSelectedLevels((prev) => {
      const next = new Set(prev)
      if (next.has(lvl)) {
        // 至少保留一个或者允许全部清空
        next.delete(lvl)
      } else {
        next.add(lvl)
      }
      return next
    })
  }

  // 堆栈展开控制
  const toggleStack = (lineIndex: number) => {
    setExpandedStacks((prev) => {
      const next = new Set(prev)
      if (next.has(lineIndex)) next.delete(lineIndex)
      else next.add(lineIndex)
      return next
    })
  }

  const handleExpandAllStacks = () => {
    const all = new Set<number>()
    dataset.entries.forEach((e) => {
      if (e.isStackTrace) all.add(e.lineIndex)
    })
    setExpandedStacks(all)
  }

  const handleCollapseAllStacks = () => {
    setExpandedStacks(new Set())
  }

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground select-text">
      {/* 顶部控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
            <ScrollText className="size-4 text-primary" />
            <span>日志分析 · {dataset.totalCount} 行</span>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* 级别药丸过滤器 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleLevel('error')}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                selectedLevels.has('error')
                  ? 'bg-destructive/15 text-destructive ring-1 ring-destructive/30'
                  : 'bg-muted/50 text-muted-foreground opacity-50',
              )}
            >
              <AlertCircle className="size-3" />
              ERROR ({stats.errorCount})
            </button>

            <button
              type="button"
              onClick={() => toggleLevel('warn')}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                selectedLevels.has('warn')
                  ? 'bg-warning/15 text-warning ring-1 ring-warning/30'
                  : 'bg-muted/50 text-muted-foreground opacity-50',
              )}
            >
              <AlertTriangle className="size-3" />
              WARN ({stats.warnCount})
            </button>

            <button
              type="button"
              onClick={() => toggleLevel('info')}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                selectedLevels.has('info')
                  ? 'bg-info/15 text-info ring-1 ring-info/30'
                  : 'bg-muted/50 text-muted-foreground opacity-50',
              )}
            >
              <Info className="size-3" />
              INFO ({stats.infoCount})
            </button>

            <button
              type="button"
              onClick={() => {
                toggleLevel('debug')
                toggleLevel('trace')
              }}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                selectedLevels.has('debug')
                  ? 'bg-muted text-foreground ring-1 ring-border'
                  : 'bg-muted/50 text-muted-foreground opacity-50',
              )}
            >
              <Bug className="size-3" />
              DEBUG ({stats.debugCount})
            </button>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* 搜索框 */}
          <div className="relative flex items-center">
            <Search className="absolute left-2 size-3 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索日志与模块..."
              className="h-7 w-40 rounded pl-7 pr-6 text-xs focus-visible:ring-1"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
            <Button
              variant={viewMode === 'stream' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('stream')}
              className="h-6 gap-1 px-2 text-xs"
            >
              <ScrollText className="size-3" />
              流视图
            </Button>
            <Button
              variant={viewMode === 'raw' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('raw')}
              className="h-6 gap-1 px-2 text-xs"
            >
              <Code2 className="size-3" />
              纯文本
            </Button>
          </div>
        </div>
      </div>

      {/* 主展示区 */}
      <div className="relative flex-1 overflow-auto">
        {viewMode === 'raw' ? (
          <textarea
            value={content}
            readOnly={readOnly}
            onChange={(e) => onChange?.(e.target.value)}
            className="h-full w-full resize-none bg-background p-4 font-mono text-xs leading-relaxed outline-none"
            spellCheck={false}
          />
        ) : (
          <div className="flex flex-col divide-y divide-border/60 font-mono text-xs">
            {filteredEntries.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                没有符合过滤条件的日志
              </div>
            ) : (
              filteredEntries.map((entry) => {
                const isStack = entry.isStackTrace
                return (
                  <div
                    key={entry.lineIndex}
                    className={cn(
                      'group flex items-start gap-2.5 px-3 py-1.5 transition-colors hover:bg-muted/30',
                      entry.level === 'error' && 'bg-destructive/5 hover:bg-destructive/10',
                      entry.level === 'warn' && 'bg-warning/5 hover:bg-warning/10',
                    )}
                  >
                    {/* 行号 */}
                    <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground/50 select-none">
                      {entry.lineIndex}
                    </span>

                    {/* 级别标签 */}
                    <span className="shrink-0">
                      {entry.level === 'error' ? (
                        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                          ERROR
                        </span>
                      ) : entry.level === 'warn' ? (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold text-warning">
                          WARN
                        </span>
                      ) : entry.level === 'info' ? (
                        <span className="rounded bg-info/15 px-1.5 py-0.5 text-[10px] font-medium text-info">
                          INFO
                        </span>
                      ) : entry.level === 'debug' ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          DEBUG
                        </span>
                      ) : (
                        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
                          LOG
                        </span>
                      )}
                    </span>

                    {/* 时间戳 */}
                    {entry.timestamp && (
                      <span className="shrink-0 text-muted-foreground/70 select-none">
                        {entry.timestamp}
                      </span>
                    )}

                    {/* 模块标签 */}
                    {entry.module && (
                      <span className="shrink-0 rounded bg-muted/80 px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                        [{entry.module}]
                      </span>
                    )}

                    {/* 日志消息正文与堆栈展示 */}
                    <div className="flex-1 break-all leading-relaxed">
                      {isStack ? (
                        <span className="text-muted-foreground/90 pl-3 italic">
                          {entry.message}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            entry.level === 'error' && 'font-medium text-destructive',
                            entry.level === 'warn' && 'text-warning',
                          )}
                        >
                          {entry.message}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
})
