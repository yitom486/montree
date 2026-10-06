import { BookMarked, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import {
  AgentChatItem,
  AgentChatItemBody,
} from '@/components/agent/chat/AgentChatItem'
import { cn } from '@/lib/utils'
import type { ChapterMarkPlanEntry } from '@montree/annotations'

export interface ChapterMarkPlanSelectPayload {
  entry: ChapterMarkPlanEntry
  promptText: string
  displayText: string
}

interface ChapterMarkPlanCardProps {
  entries: ChapterMarkPlanEntry[]
  embedded?: boolean
  className?: string
  onSelectChapter?: (payload: ChapterMarkPlanSelectPayload) => void
}

function buildChapterSelectPayload(entry: ChapterMarkPlanEntry): ChapterMarkPlanSelectPayload {
  const displayText = `为「${entry.title}」划重点`
  const promptText = [
    `用户已选择章节：「${entry.title}」（flatIndex=${entry.flatIndex}）。`,
    `推荐理由：${entry.reason}`,
    '请执行：1) montree_read(scope=chapter, flatIndex=…) 读取该章正文；',
    '2) 挑选不超过 10 条值得划重点的句子；',
    '3) 调用 montree_propose_mark(marks=[{ excerpt, note? }]) 一次提交批量提议（不要逐条调用）。',
    '不要一次全书；仅本章。',
  ].join('\n')
  return { entry, displayText, promptText }
}

/** 章级划重点建议卡：用户点选一章后继续 Agent 流程。 */
export function ChapterMarkPlanCard({
  entries,
  embedded = false,
  className,
  onSelectChapter,
}: ChapterMarkPlanCardProps) {
  const pending = entries.filter((row) => row.status === 'pending')
  const resolved = entries.some((row) => row.status === 'selected')
  const [open, setOpen] = useState(!resolved)

  if (entries.length === 0) return null

  const collapsedLabel = resolved ? '已选定章节' : `章级建议 · ${pending.length} 章可选`

  return (
    <AgentChatItem
      variant="card"
      tone={pending.length > 0 ? 'tool-pending' : 'tool'}
      streaming={false}
      probe="chapter-mark-plan"
      role="chapter-plan"
      className={cn(embedded ? 'mt-2' : undefined, className)}
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <BookMarked className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
          {collapsedLabel}
        </span>
      </button>

      {open ? (
        <AgentChatItemBody className="space-y-1.5 border-border/30 px-2.5 pb-2.5">
          <p className="text-[10px] text-muted-foreground">
            点选一章后，Agent 将读取该章并生成批量划重点提议。
          </p>
          {entries.map((entry) => {
            const selected = entry.status === 'selected'
            const dismissed = entry.status === 'dismissed'
            return (
              <button
                key={entry.id}
                type="button"
                disabled={!onSelectChapter || dismissed || selected || pending.length === 0}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors',
                  selected
                    ? 'border-sky-500/40 bg-sky-500/10'
                    : dismissed
                      ? 'border-border/40 opacity-50'
                      : 'border-border/60 hover:border-sky-500/30 hover:bg-muted/40',
                )}
                onClick={() => onSelectChapter?.(buildChapterSelectPayload(entry))}
              >
                <span className="text-[11px] font-medium text-foreground/90">{entry.title}</span>
                <span className="text-[10px] leading-relaxed text-muted-foreground">
                  {entry.reason}
                </span>
                {selected ? (
                  <span className="text-[10px] font-medium text-sky-700 dark:text-sky-300">
                    已选定
                  </span>
                ) : null}
              </button>
            )
          })}
        </AgentChatItemBody>
      ) : null}
    </AgentChatItem>
  )
}
