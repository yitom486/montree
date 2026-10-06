import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  flattenFileTree,
  searchQuickOpenFiles,
  type QuickOpenFileItem,
  type QuickOpenMatchResult,
} from '@/lib/workspace/quick-open'
import type { FileTreeNode } from '@montree/contracts'
import { Book, BookOpen, Clock, FileCode, FileText, Search } from 'lucide-react'

interface QuickOpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileTree: FileTreeNode[]
  workspaceRoot?: string
  recentFiles?: string[]
  onSelectFile: (filePath: string) => void
}

function getFileIcon(documentKind: string): ReactNode {
  switch (documentKind) {
    case 'markdown':
      return <FileText className="size-4 shrink-0 text-blue-500 dark:text-blue-400" />
    case 'pdf':
      return <FileText className="size-4 shrink-0 text-rose-500 dark:text-rose-400" />
    case 'epub':
      return <BookOpen className="size-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
    case 'mobi':
      return <Book className="size-4 shrink-0 text-amber-500 dark:text-amber-400" />
    default:
      return <FileCode className="size-4 shrink-0 text-muted-foreground" />
  }
}

function HighlightedName({
  name,
  indices,
}: {
  name: string
  indices: number[]
}) {
  if (!indices || indices.length === 0) {
    return <span className="truncate">{name}</span>
  }

  const indexSet = new Set(indices)
  const parts: ReactNode[] = []
  let currentMatched = false
  let currentBuffer = ''

  for (let i = 0; i < name.length; i++) {
    const isMatch = indexSet.has(i)
    if (i === 0) {
      currentMatched = isMatch
      currentBuffer += name[i]
    } else if (isMatch === currentMatched) {
      currentBuffer += name[i]
    } else {
      parts.push(
        currentMatched ? (
          <mark
            key={i}
            className="rounded-xs bg-primary/20 font-semibold text-primary underline decoration-primary/50 decoration-1"
          >
            {currentBuffer}
          </mark>
        ) : (
          <span key={i}>{currentBuffer}</span>
        ),
      )
      currentMatched = isMatch
      currentBuffer = name[i]
    }
  }

  if (currentBuffer) {
    parts.push(
      currentMatched ? (
        <mark
          key="tail"
          className="rounded-xs bg-primary/20 font-semibold text-primary underline decoration-primary/50 decoration-1"
        >
          {currentBuffer}
        </mark>
      ) : (
        <span key="tail">{currentBuffer}</span>
      ),
    )
  }

  return <span className="truncate">{parts}</span>
}

export function QuickOpenDialog({
  open,
  onOpenChange,
  fileTree,
  workspaceRoot,
  recentFiles = [],
  onSelectFile,
}: QuickOpenDialogProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items: QuickOpenFileItem[] = useMemo(() => {
    return flattenFileTree(fileTree, workspaceRoot, recentFiles)
  }, [fileTree, workspaceRoot, recentFiles])

  const results: QuickOpenMatchResult[] = useMemo(() => {
    return searchQuickOpenFiles(items, query, recentFiles)
  }, [items, query, recentFiles])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    )
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleSelect = (item: QuickOpenFileItem) => {
    onSelectFile(item.path)
    onOpenChange(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = results[selectedIndex]
      if (target) {
        handleSelect(target.item)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[25%] translate-y-[-25%] overflow-hidden p-0 sm:max-w-xl shadow-2xl border border-border/80"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">快速打开文件</DialogTitle>
        <DialogDescription className="sr-only">
          输入关键词搜索工作区中的文档与电子书
        </DialogDescription>

        <div className="flex items-center gap-2.5 border-b border-border/60 px-3.5 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/70 focus:outline-none"
            placeholder="搜索工作区文件或电子书..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <span className="text-[11px] text-muted-foreground font-mono">
              {results.length} 个结果
            </span>
          ) : null}
        </div>

        <ScrollArea className="max-h-[360px] min-h-[120px]">
          <div ref={listRef} className="p-1.5 space-y-0.5">
            {results.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {items.length === 0
                  ? '工作区暂无已打开的文件'
                  : '未找到匹配的文件或书籍'}
              </div>
            ) : (
              results.map((res, index) => {
                const isSelected = index === selectedIndex
                return (
                  <button
                    key={res.item.path}
                    data-index={index}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-xs transition-colors',
                      isSelected
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-foreground/90 hover:bg-muted/50',
                    )}
                    onClick={() => handleSelect(res.item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {getFileIcon(res.item.documentKind)}
                      <HighlightedName
                        name={res.item.name}
                        indices={res.matchedIndices}
                      />
                    </div>

                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                      {res.item.folderPath ? (
                        <span className="truncate max-w-[160px] font-mono text-muted-foreground/70">
                          {res.item.folderPath}
                        </span>
                      ) : null}
                      {res.item.isRecent ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <Clock className="size-2.5" />
                          最近
                        </span>
                      ) : null}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-border/70 bg-background px-1 py-0.5 font-mono text-[10px]">
                ↑↓
              </kbd>{' '}
              移动
            </span>
            <span>
              <kbd className="rounded border border-border/70 bg-background px-1 py-0.5 font-mono text-[10px]">
                Enter
              </kbd>{' '}
              打开
            </span>
            <span>
              <kbd className="rounded border border-border/70 bg-background px-1 py-0.5 font-mono text-[10px]">
                Esc
              </kbd>{' '}
              关闭
            </span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            Ctrl+P / Cmd+P
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
