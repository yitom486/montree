import {
  CHAPTER_MARK_PLAN_MAX,
  type ChapterMarkPlanInput,
  type ChapterMarkPlanToolResult,
} from '@montree/annotations'
import { collectActiveDocument } from '@/lib/agent/context/collect-turn-context'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'

function resolveTocLabel(flatIndex: number): string | null {
  const document = collectActiveDocument()
  const reader = useReaderNavigationStore.getState()
  if (!document || reader.filePath !== document.path || !reader.ready) return null
  return reader.units[flatIndex]?.label?.trim() ?? null
}

/** MCP montree_suggest_chapters：校验 flatIndex 并返回结构化章级建议。 */
export async function suggestChaptersForAgent(
  chapters: ChapterMarkPlanInput[],
): Promise<ChapterMarkPlanToolResult> {
  if (chapters.length === 0) {
    throw new Error('chapters 数组不能为空')
  }
  if (chapters.length > CHAPTER_MARK_PLAN_MAX) {
    throw new Error(`章级建议最多 ${CHAPTER_MARK_PLAN_MAX} 条，收到 ${chapters.length} 条`)
  }

  const normalized: ChapterMarkPlanInput[] = []
  for (const item of chapters) {
    if (!Number.isFinite(item.flatIndex)) {
      throw new Error(`无效的 flatIndex：${String(item.flatIndex)}`)
    }
    const tocLabel = resolveTocLabel(item.flatIndex)
    if (!tocLabel) {
      throw new Error(
        `flatIndex ${item.flatIndex} 不在当前目录中，请先 montree_read(scope=toc) 核对`,
      )
    }
    normalized.push({
      flatIndex: item.flatIndex,
      title: item.title.trim() || tocLabel,
      reason: item.reason.trim() || '值得划重点',
    })
  }

  return {
    suggested: true,
    count: normalized.length,
    chapters: normalized,
    message:
      '已展示章级划重点建议；请用户点选一章后，再 read(scope=chapter) 并 montree_propose_mark(marks)，单批≤10。',
  }
}
