import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ListTree, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { OcrTocEntry } from '@montree/contracts'

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
      { title: '', printedPage: 1, level: 1, source: 'manual' as const },
    ])
  }

  return (
    <aside className="flex w-[min(28%,320px)] min-w-[180px] shrink-0 flex-col border-r border-border/60 bg-sidebar">
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
          修改标题或印刷页码；PDF 页 = 印刷页 + {pageOffset}。
        </p>
        {aiControl ? <div className="mb-2 px-1">{aiControl}</div> : null}
        <ul className="space-y-2">
          {draft.map((entry, index) => (
            <li
              key={`${index}-${entry.title}-${entry.printedPage}`}
              className="rounded-md border border-border/60 bg-background/60 p-2"
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
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      印刷页
                      <input
                        type="number"
                        min={1}
                        className="w-16 rounded border border-border/60 bg-background px-1.5 py-0.5 text-xs text-foreground"
                        value={entry.printedPage}
                        onChange={(event) =>
                          updateEntry(index, {
                            printedPage: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                          })
                        }
                      />
                    </label>
                    <span className="text-[10px] text-muted-foreground/80">
                      → PDF {entry.printedPage + pageOffset}
                    </span>
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
          ))}
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
          onClick={() => onSave(draft)}
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
