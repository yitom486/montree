import type { ChapterMarkPlanEntry, ChapterMarkPlanToolResult } from '@montree/annotations'
import { toChapterMarkPlanEntry } from '@montree/annotations'

const SUGGEST_CHAPTERS_TOOL_PATTERN =
  /montree_suggest_chapters|suggest.?chapters|章级建议|chapter.?plan/i

export function isChapterMarkPlanToolTitle(title: string | undefined): boolean {
  if (!title?.trim()) return false
  return SUGGEST_CHAPTERS_TOOL_PATTERN.test(title)
}

function parseChapterRow(value: unknown): ChapterMarkPlanToolResult['chapters'][number] | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const flatIndex = row.flatIndex
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
  if (typeof flatIndex !== 'number' || !Number.isFinite(flatIndex) || !title) return null
  return { flatIndex, title, reason: reason || '值得划重点' }
}

export function parseChapterMarkPlanToolResult(text: string): ChapterMarkPlanToolResult | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const row = JSON.parse(trimmed) as Record<string, unknown>
    if (row.suggested !== true || !Array.isArray(row.chapters)) return null
    const chapters = row.chapters
      .map(parseChapterRow)
      .filter((item): item is NonNullable<typeof item> => item !== null)
    if (chapters.length === 0) return null
    return {
      suggested: true,
      count: typeof row.count === 'number' ? row.count : chapters.length,
      chapters,
      message: typeof row.message === 'string' ? row.message : '',
    }
  } catch {
    return null
  }
}

export function parseChapterMarkPlanFromTool(
  toolTitle: string | undefined,
  toolContentText: string | undefined,
  toolCallId?: string,
): ChapterMarkPlanEntry[] {
  const parsed = parseChapterMarkPlanToolResult(toolContentText ?? '')
  if (!parsed) {
    if (!isChapterMarkPlanToolTitle(toolTitle)) return []
    return []
  }
  return parsed.chapters.map((chapter, index) =>
    toChapterMarkPlanEntry(
      chapter,
      toolCallId ? `tool:${toolCallId}:${index}` : undefined,
    ),
  )
}

export function enrichToolMessageWithChapterPlan<
  T extends {
    role: string
    toolTitle?: string
    toolContentText?: string
    text?: string
    toolCallId?: string
    toolStatus?: string
    streaming?: boolean
    chapterMarkPlan?: ChapterMarkPlanEntry[]
  },
>(message: T, isActiveStatus: (status: string | undefined) => boolean): T {
  if (message.role !== 'tool' || message.chapterMarkPlan?.length) return message
  if (message.streaming || isActiveStatus(message.toolStatus)) return message

  const entries = parseChapterMarkPlanFromTool(
    message.toolTitle,
    message.toolContentText ?? message.text,
    message.toolCallId,
  )
  if (entries.length === 0) return message

  return {
    ...message,
    chapterMarkPlan: entries,
  }
}
