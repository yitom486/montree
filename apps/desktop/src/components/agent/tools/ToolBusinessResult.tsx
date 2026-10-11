import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/query-keys'
import { readingMarksApi } from '@/api/reading-marks-api'
import { useActiveDocumentStore } from '@/stores/active-document-store'
import { toast } from 'sonner'
import { emitAnchorHighlight } from '@/lib/reader/marks/mark-linkage'
import {
  DiagramViewerCard,
  type DiagramPayload,
} from '@/components/agent/tools/DiagramViewerCard'
import {
  CrossReferenceCard,
  type CrossReferencePayload,
} from '@/components/agent/tools/CrossReferenceCard'
import {
  ContentAuditCard,
  type ContentAuditPayload,
} from '@/components/agent/tools/ContentAuditCard'
import {
  ChapterSuggestionCard,
  type SuggestChaptersPayload,
} from '@/components/agent/tools/ChapterSuggestionCard'
import { openChapterForMarkRecovery } from '@/lib/agent/mark-proposal-failure'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { toChapterKey, type ReadingAnchor } from '@montree/contracts'
import { normalizeLoadKey } from '@montree/reader-core'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'

export function buildNoteFromDiagram(payload: DiagramPayload): string {
  const lines: string[] = []
  if (payload.summary) {
    lines.push(`> **核心解读**：${payload.summary}\n`)
  }
  if (payload.visualSteps && payload.visualSteps.length > 0) {
    lines.push('### 推演流转步骤')
    payload.visualSteps.forEach((step, idx) => {
      const parts = [`${idx + 1}. **${step.action}**`]
      if (step.from && step.to && (step.from !== 'Client' || step.to !== 'Agent')) {
        parts.push(`（${step.from} → ${step.to}）`)
      }
      if (step.desc) {
        parts.push(`：${step.desc}`)
      }
      lines.push(parts.join(''))
    })
    lines.push('')
  }
  if (payload.mermaidCode) {
    lines.push('### 架构图表')
    lines.push('```mermaid')
    lines.push(payload.mermaidCode.trim())
    lines.push('```')
  }
  return lines.join('\n')
}

function parseDiagramPayload(text?: string, title?: string): DiagramPayload | null {
  if (!text || (!text.includes('mermaidCode') && !title?.includes('montree_generate_diagram'))) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && typeof obj.mermaidCode === 'string') {
      return obj as DiagramPayload
    }
  } catch {
    return null
  }
  return null
}

function parseCrossReferencePayload(text?: string, title?: string): CrossReferencePayload | null {
  if (
    !text ||
    (!text.includes('chapterDistribution') && !title?.includes('montree_cross_reference'))
  ) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (
      obj &&
      typeof obj === 'object' &&
      Array.isArray(obj.chapterDistribution) &&
      typeof obj.entity === 'string'
    ) {
      return obj as CrossReferencePayload
    }
  } catch {
    return null
  }
  return null
}

function parseContentAuditPayload(text?: string, title?: string): ContentAuditPayload | null {
  if (!text || (!text.includes('"hits"') && !title?.includes('montree_inspect_content'))) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && Array.isArray(obj.hits) && typeof obj.query === 'string') {
      return obj as ContentAuditPayload
    }
  } catch {
    return null
  }
  return null
}

function parseSuggestChaptersPayload(text?: string, title?: string): SuggestChaptersPayload | null {
  if (!text || (!text.includes('"chapters"') && !title?.includes('montree_suggest_chapters'))) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && Array.isArray(obj.chapters)) {
      return obj as SuggestChaptersPayload
    }
  } catch {
    return null
  }
  return null
}

/**
 * 富业务结果是否真实可渲染（至少一种 payload 解析成功）。
 * 分类启发式（标题/关键字）命中但 JSON 解析失败时返回 false，
 * 调用方回退为普通文本展示，不留空折叠区。
 */
export function hasBusinessResult(detail?: string, title?: string): boolean {
  return (
    parseDiagramPayload(detail, title) != null ||
    parseCrossReferencePayload(detail, title) != null ||
    parseContentAuditPayload(detail, title) != null ||
    parseSuggestChaptersPayload(detail, title) != null
  )
}

function buildFallbackAnchor(
  filePath: string,
  selectedText?: string,
  chapterHref?: string,
): ReadingAnchor {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.pdf')) {
    return { format: 'pdf', page: 1, selectedText }
  }
  if (lower.endsWith('.mobi') || lower.endsWith('.azw3')) {
    return { format: 'mobi', chapterId: chapterHref || '', selectedText }
  }
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return { format: 'web', url: filePath, selectedText }
  }
  return { format: 'epub', cfi: '', href: chapterHref || undefined, selectedText }
}

/**
 * 阅读业务结果分发（R2）：图表 / 跨章互引 / 内容审计 / 章节建议。
 * 只负责“富结果是什么、怎么交互”；通用折叠外壳与审批在 `AgentToolCallCard`。
 */
export function ToolBusinessResult({ message }: { message: AcpChatMessage }) {
  const detail = message.toolContentText || message.text
  const diagramPayload = useMemo(
    () => parseDiagramPayload(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const crossRefPayload = useMemo(
    () => parseCrossReferencePayload(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const auditPayload = useMemo(
    () => parseContentAuditPayload(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const suggestionPayload = useMemo(
    () => parseSuggestChaptersPayload(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const queryClient = useQueryClient()
  const activeFilePath = useActiveDocumentStore((s) => s.filePath)
  const [savedDiagramIds, setSavedDiagramIds] = useState<Set<string>>(new Set())

  const handleSaveAsKnowledgeCard = async (payload: DiagramPayload): Promise<boolean> => {
    if (!activeFilePath) {
      toast.error('未检测到当前打开的图书文档，无法沉淀知识卡片')
      return false
    }
    const excerpt =
      payload.anchorExcerpt || payload.visualSteps?.[0]?.anchorExcerpt || payload.title
    const noteContent = buildNoteFromDiagram(payload)

    const navState = useReaderNavigationStore.getState()
    const currentUnit =
      navState.nav.flatIndex >= 0
        ? navState.units[navState.nav.flatIndex]
        : navState.nav.current
    const chapterLabel = currentUnit?.label || navState.nav.current?.label || '当前章节'
    const rawHref =
      (currentUnit && 'href' in currentUnit && currentUnit.href
        ? currentUnit.href
        : navState.nav.current?.href) || ''
    const chapterKey = rawHref ? toChapterKey(normalizeLoadKey(rawHref)) : undefined
    const chapterIndex = navState.nav.flatIndex >= 0 ? navState.nav.flatIndex : 0

    const chapterRef = chapterKey
      ? {
          key: chapterKey,
          label: chapterLabel,
          index: chapterIndex,
        }
      : null

    const res = await readingMarksApi.create({
      filePath: activeFilePath,
      fileFingerprint: activeFilePath,
      kind: 'note',
      category: 'diagram',
      title: payload.title,
      aiSummary: payload.summary,
      diagramId: payload.diagramId,
      excerpt,
      chapter: chapterRef,
      anchor: buildFallbackAnchor(activeFilePath, excerpt, rawHref),
      note: noteContent,
      tags: ['知识卡片', payload.diagramType],
    })

    if (!res.ok) {
      toast.error('存入知识卡片失败：' + res.error.message)
      return false
    }

    setSavedDiagramIds((prev) => new Set(prev).add(payload.diagramId))
    void queryClient.invalidateQueries({ queryKey: queryKeys.readingMarks(activeFilePath) })
    toast.success(`已将「${payload.title}」存入本书知识卡片（${chapterLabel}）`)
    return true
  }

  if (!diagramPayload && !crossRefPayload && !auditPayload && !suggestionPayload) {
    return null
  }

  return (
    <>
      {diagramPayload ? (
        <div className="mt-1">
          <DiagramViewerCard
            payload={diagramPayload}
            isSavedAsCard={savedDiagramIds.has(diagramPayload.diagramId)}
            onSaveAsKnowledgeCard={handleSaveAsKnowledgeCard}
            onHighlightAnchor={(anchor: string) => {
              toast.message(`正在定位原文：「${anchor.slice(0, 24)}...」`)
              emitAnchorHighlight(anchor)
            }}
            onPinToDoc={(p: DiagramPayload) => {
              void navigator.clipboard.writeText(
                `\n\n\`\`\`mermaid\n${p.mermaidCode}\n\`\`\`\n\n`,
              )
              toast.success('图表 Mermaid 源码已复制，可粘贴至正文或笔记')
            }}
          />
        </div>
      ) : null}
      {crossRefPayload ? (
        <div className="mt-1">
          <CrossReferenceCard
            payload={crossRefPayload}
            onNavigateChapter={(flatIndex, excerpt) => {
              if (typeof flatIndex === 'number') {
                void openChapterForMarkRecovery(flatIndex)
              }
              if (excerpt) {
                emitAnchorHighlight(excerpt)
              }
            }}
          />
        </div>
      ) : null}
      {auditPayload ? (
        <div className="mt-1">
          <ContentAuditCard
            payload={auditPayload}
            onHighlightAnchor={(anchor: string) => {
              toast.message(`正在定位原句：「${anchor.slice(0, 24)}...」`)
              emitAnchorHighlight(anchor)
            }}
          />
        </div>
      ) : null}
      {suggestionPayload ? (
        <div className="mt-1">
          <ChapterSuggestionCard
            payload={suggestionPayload}
            onSelectChapter={(item) => {
              if (item.flatIndex != null) {
                void openChapterForMarkRecovery(item.flatIndex)
              }
            }}
          />
        </div>
      ) : null}
    </>
  )
}
