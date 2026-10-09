import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ListTree, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { OcrTocEntry } from '@montree/contracts'
import { computeTocPageRanges } from '@montree/ocr-core'
import { cn } from '@/lib/utils'

interface PdfOcrTocEditorProps {
  entries: OcrTocEntry[]
  pageOffset: number
  saving?: boolean
  /** 目录探测/识别运行中：保存按钮同步禁用（锁负责逻辑互斥） */
  busy?: boolean
  onToggle: () => void
  onSave: (entries: OcrTocEntry[]) => void
  onCancel: () => void
  /** AI 整理控件（调用方传入，已含会话与模型选择逻辑） */
  aiControl?: ReactNode
}

function cloneEntries(entries: OcrTocEntry[]): OcrTocEntry[] {
  return entries.map((entry) => ({ ...entry }))
}

export function PdfOcrTocEditor({
  entries,
  pageOffset,
  saving = false,
  busy = false,
  onToggle,
  onSave,
  onCancel,
  aiControl,
}: PdfOcrTocEditorProps) {
  const [draft, setDraft] = useState(() => cloneEntries(entries))

  useEffect(() => {
    setDraft(cloneEntries(entries))
  }, [entries])

  const updateEntry = (index: number, patch: Partial<OcrTocEntry>) => {
    setDraft((prev) =>
      prev.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)),
    )
  }

  const removeEntry = (index: number) => {
    setDraft((prev) => prev.filter((_, entryIndex) => entryIndex !== index))
  }

  const addEntry = () => {
    setDraft((prev) => [
      ...prev,
      { title: '', printedPage: 1, level: 0, source: 'manual' as const },
    ])
  }

  return (
    <aside className="flex w-[min(30%,340px)] min-w-[200px] shrink-0 flex-col border-r border-border/60 bg-sidebar">
      <button
        type="button"
        className="flex w-full shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 hover:text-foreground"
        onClick={onToggle}
        aria-expanded
      >
        <ChevronDown className="size-3.5 shrink-0" />
        <ListTree className="size-3.5 shrink-0" />
        校正目录
        <span className="ml-auto text-[10px] font-normal normal-case text-muted-foreground/80">
          {draft.length}
        </span>
      </button>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <p className="mb-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          修改标题、层级或起始页；结束页自动按下一节起始页 - 1 推导（末尾留空）。
        </p>
        {aiControl ? <div className="mb-2 px-1">{aiControl}</div> : null}
        <ul className="space-y-2">
          {draft.map((entry, index) => {
            const nextEntry = draft[index + 1]
            const inferredEnd =
              entry.endPage ??
              (nextEntry?.printedPage && nextEntry.printedPage > 0
                ? Math.max(entry.printedPage, nextEntry.printedPage - 1)
                : null)
            const levelIndent =
              entry.level === 1
                ? 'ml-2.5 border-l-2 border-l-primary/40'
                : entry.level === 2
                  ? 'ml-5 border-l-2 border-l-primary/60'
                  : entry.level >= 3
                    ? 'ml-7.5 border-l-2 border-l-primary/80'
                    : ''

            return (
              <li
                key={`${index}-${entry.title}-${entry.printedPage}`}
                className={cn(
                  'rounded-md border border-border/60 bg-background/60 p-2 transition-all',
                  levelIndent,
                )}
              >
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <input
                      type="text"
                      className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs"
                      value={entry.title}
                      placeholder="章节标题"
                      onChange={(event) => updateEntry(index, { title: event.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>页码</span>
                      <input
                        type="number"
                        min={1}
                        className="w-14 rounded border border-border/60 bg-background px-1.5 py-0.5 text-xs text-foreground"
                        value={entry.printedPage}
                        onChange={(event) =>
                          updateEntry(index, {
                            printedPage: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                          })
                        }
                      />
                      <span>至</span>
                      <span className="font-mono text-xs font-medium text-foreground">
                        {inferredEnd != null ? inferredEnd : '—'}
                      </span>
                      <span className="text-[10px] text-muted-foreground/80">
                        (PDF {entry.printedPage + pageOffset}
                        {inferredEnd != null ? ` ~ ${inferredEnd + pageOffset}` : ' ~ 末尾'})
                      </span>
                      <button
                        type="button"
                        className="ml-auto rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                        title="点击循环切换层级 (1级=单元/部, 2级=课/章, 3级=小节/专栏)"
                        onClick={() => {
                          const nextLevel =
                            entry.level <= 0 ? 1 : entry.level === 1 ? 2 : entry.level === 2 ? 3 : 0
                          updateEntry(index, { level: nextLevel })
                        }}
                      >
                        {entry.level <= 0
                          ? '1级 单元'
                          : entry.level === 1
                            ? '2级 课'
                            : entry.level === 2
                              ? '3级 节'
                              : `${entry.level + 1}级 子节`}
                      </button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="删除条目"
                    onClick={() => removeEntry(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 w-full text-xs" onClick={addEntry}>
          <Plus className="mr-1 size-3.5" />
          添加条目
        </Button>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border/60 p-2">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          disabled={saving || busy || draft.length === 0}
          onClick={() => onSave(computeTocPageRanges(draft))}
        >
          {saving ? '保存中…' : '保存'}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          取消
        </Button>
      </div>
    </aside>
  )
}

