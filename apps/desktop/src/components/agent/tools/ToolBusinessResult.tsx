import { lazy, Suspense, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/query-keys'
import { readingMarksApi } from '@/api/reading-marks-api'
import { useActiveDocumentStore } from '@/stores/active-document-store'
import { useWebDocStore } from '@/stores/web-doc-store'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { toast } from 'sonner'
import { MermaidBlock } from '@/components/markdown/MermaidBlock'
import { emitAnchorHighlight } from '@/lib/reader/marks/mark-linkage'
import {
  DiagramViewerCard,
  type DiagramPayload,
} from '@yitom/chat-ui'
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
import {
  ChapterComparisonCard,
  HtmlArtifactCard,
  ComponentUiCardLazy,
  sanitizeArtifactFileName,
  type GenerativeSubmitPayload,
} from '@yitom/chat-ui'
import { openChapterForMarkRecovery } from '@/lib/agent/mark-proposal-failure'
import { checkPresentDocument } from '@/lib/agent/present-locate'
import { isPresentToolTitle } from '@yitom/chat-core'
import type { AcpChatMessage } from '@/stores/acp-chat-types'
import { isOk, parsePresentResult, type MontreePresentResult } from '@yitom/contracts'
import { toChapterKey, type ReadingAnchor } from '@yitom/contracts'
import { normalizeLoadKey } from '@yitom/reader-core'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { fileApi } from '@/api/file-api'
import { compileReactArtifact } from '@/api/react-artifact-api'
import { upgradeLegacyMindmapHtml } from '@/lib/agent/context/upgrade-legacy-mindmap'

const ReactArtifactCardLazy = lazy(() => import('@yitom/chat-ui').then(module => ({ default: module.ReactArtifactCard })))

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
  if (!text) return null
  const isExplicitTool = Boolean(title?.includes('montree_inspect_content'))
  if (!isExplicitTool && !text.includes('"hits"')) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && Array.isArray(obj.hits)) {
      // 避免普通 execute 终端脚本输出未知带 hits 的 JSON 时误解析为空白卡片：
      // 如果不是显式的 montree_inspect_content，必须有 query 字符串，
      // 且 hits 为空或者至少有一个命中项具有可读正文字段
      const hasMeaningfulText =
        obj.hits.length === 0 ||
        obj.hits.some(
          (h: any) =>
            h &&
            typeof h === 'object' &&
            Boolean(
              (typeof h.text === 'string' && h.text.trim()) ||
              (typeof h.content === 'string' && h.content.trim()) ||
              (typeof h.snippet === 'string' && h.snippet.trim()) ||
              (typeof h.match === 'string' && h.match.trim()) ||
              (typeof h.excerpt === 'string' && h.excerpt.trim()),
            ),
        )

      if (typeof obj.query === 'string' && (isExplicitTool || hasMeaningfulText)) {
        const normalizedHits = obj.hits.map((h: any) => {
          if (!h || typeof h !== 'object') {
            return {
              source: 'book-index' as const,
              locator: {},
              text: String(h || ''),
              textTruncated: false,
              matchPosition: 'start' as const,
            }
          }
          const rawText = h.text ?? h.content ?? h.snippet ?? h.match ?? h.excerpt ?? ''
          const source =
            h.source ||
            (h.url || h.locator?.url
              ? 'web-doc'
              : h.locator?.filePath || h.filePath
                ? 'workspace-file'
                : 'book-index')

          const locator = {
            ...(h.locator || {}),
            ...(h.url && !h.locator?.url ? { url: h.url } : {}),
            ...(h.filePath && !h.locator?.filePath ? { filePath: h.filePath } : {}),
            ...(h.line && !h.locator?.lineStart ? { lineStart: h.line } : {}),
          }

          return {
            source,
            locator,
            text: String(rawText),
            textTruncated: Boolean(h.textTruncated),
            matchPosition: h.matchPosition || 'start',
          }
        })

        return {
          query: obj.query,
          total: typeof obj.total === 'number' ? obj.total : normalizedHits.length,
          truncated: Boolean(obj.truncated),
          limit: typeof obj.limit === 'number' ? obj.limit : undefined,
          hits: normalizedHits,
        }
      }
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

function parsePresentPayload(
  detail?: string,
  title?: string,
  enriched?: MontreePresentResult,
): MontreePresentResult | null {
  if (enriched && (enriched.kind === 'chapter-comparison' || enriched.kind === 'html-artifact' || enriched.kind === 'component-ui' || enriched.kind === 'react-artifact')) {
    return enriched
  }
  if (!detail || (!detail.includes('chapter-comparison') && !detail.includes('html-artifact') && !detail.includes('component-ui') && !detail.includes('react-artifact') && !title?.includes('montree_present'))) {
    return null
  }
  try {
    return parsePresentResult(detail)
  } catch {
    return null
  }
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
    parseSuggestChaptersPayload(detail, title) != null ||
    parsePresentPayload(detail, title) != null
  )
}

/** montree_present 标题命中但解析失败时，是否应显示可读失败而非空区 */
export function isUnparsablePresentResult(detail?: string, title?: string): boolean {
  if (!isPresentToolTitle(title)) return false
  if (!detail) return false
  return parsePresentPayload(detail, title) == null
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
 * 阅读业务结果分发（R2/U3）：图表 / 跨章互引 / 内容审计 / 章节建议。
 * 只负责“富结果是什么、怎么交互”；通用折叠外壳与审批在调用方。
 * compactResults：结果入口使用，图表默认紧凑预览（完整功能经入口进入）。
 * onGenerativeSubmit/threadId/prompting：component-ui 卡的选择提交链路
 * （AgentResultEntry 透传自 AgentMessageBubble，归属与 busy 由面板层校验）。
 */
export function ToolBusinessResult({ message, compactResults, threadId, prompting, onGenerativeSubmit }: { message: AcpChatMessage; compactResults?: boolean; threadId?: string; prompting?: boolean; onGenerativeSubmit?: (payload: GenerativeSubmitPayload) => void }) {
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
  const presentPayload = useMemo(
    () => parsePresentPayload(detail, message.toolTitle, message.presentResult),
    [detail, message.toolTitle, message.presentResult],
  )
  const presentUnparsable = useMemo(
    () => isUnparsablePresentResult(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const queryClient = useQueryClient()
  const activeFilePath = useActiveDocumentStore((s) => s.filePath)
  // M3d present 宿主实现：主题直传 + 导出（原卡内 `fileApi.exportHtml+toast` 下沉，取消静默）+ 编译直传主进程。
  const colorScheme = useEditorUiStore((s) => s.theme)
  const handleArtifactExport = async (html: string, title: string) => {
    const saved = await fileApi.exportHtml({
      html,
      suggestedName: sanitizeArtifactFileName(title),
    })
    if (isOk(saved)) {
      toast.success(`已导出：${saved.value.filePath}`)
      return
    }
    if (saved.error.code !== 'CANCELLED') {
      toast.error(`导出失败：${saved.error.message}`)
    }
  }
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

  if (!diagramPayload && !crossRefPayload && !auditPayload && !suggestionPayload && !presentPayload && !presentUnparsable) {
    return null
  }

  return (
    <>
      {diagramPayload ? (
        <div className="mt-1">
          <DiagramViewerCard
            payload={diagramPayload}
            defaultCompact={compactResults}
            renderMermaid={(source) => <MermaidBlock source={source} />}
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
              if (anchor) {
                toast.message(`正在定位原句：「${anchor.slice(0, 24)}...」`)
                emitAnchorHighlight(anchor)
              }
            }}
            onNavigateHit={(hit) => {
              if (hit.locator?.url) {
                const targetUrl = hit.locator.url
                const curWebUrl = useWebDocStore.getState().pageUrl
                if (curWebUrl !== targetUrl) {
                  useWebDocStore.getState().openPage(targetUrl)
                  useAppSettingsStore.getState().setLastWebDocUrl(targetUrl)
                  useActiveDocumentStore.getState().setActiveFilePath(null)
                }
              } else if (hit.locator?.filePath) {
                const curPath = useActiveDocumentStore.getState().filePath
                if (curPath !== hit.locator.filePath) {
                  useActiveDocumentStore.getState().setActiveFilePath(hit.locator.filePath)
                  useAppSettingsStore.getState().setLastOpenedFilePath(hit.locator.filePath)
                }
              }
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
      {presentPayload?.kind === 'chapter-comparison' ? (
        <div className="mt-1">
          <ChapterComparisonCard
            key={presentPayload.id}
            result={presentPayload}
            onLocateChapter={(flatIndex, excerpt) => {
              // 先校验来源文档归属：跨文档/无文档时禁止导航并引导；
              // 导航成功且内容就绪后再广播高亮（await，非 fire-and-forget）。
              // P1：等待期间可能切换文档，await 后复核归属，过期不广播，
              // 避免 A 的摘录高亮到 B；导航异常直接引导，不产生未处理拒绝。
              void (async () => {
                const verdict = checkPresentDocument(
                  presentPayload,
                  useActiveDocumentStore.getState().filePath,
                )
                if (!verdict.ok) {
                  toast.message(verdict.message)
                  return
                }
                let navigated = false
                try {
                  navigated = await openChapterForMarkRecovery(flatIndex, excerpt)
                } catch (error) {
                  toast.message(error instanceof Error ? error.message : '打开章节失败，请重试')
                  return
                }
                const after = checkPresentDocument(
                  presentPayload,
                  useActiveDocumentStore.getState().filePath,
                )
                if (!after.ok) {
                  toast.message(after.message)
                  return
                }
                if (navigated && excerpt) {
                  emitAnchorHighlight(excerpt)
                }
              })()
            }}
          />
        </div>
      ) : null}
      {presentPayload?.kind === 'html-artifact' ? (
        <div className="mt-1">
          <HtmlArtifactCard
            key={presentPayload.id}
            result={{
              ...presentPayload,
              html: upgradeLegacyMindmapHtml(presentPayload.html),
            }}
            colorScheme={colorScheme}
            onExport={() => void handleArtifactExport(presentPayload.html, presentPayload.title)}
          />
        </div>
      ) : null}
      {presentPayload?.kind === 'react-artifact' ? <Suspense fallback={<p role="status">正在加载交互界面…</p>}><ReactArtifactCardLazy key={presentPayload.id} result={presentPayload} toolStreaming={message.streaming} toolStatus={message.toolStatus} threadId={threadId} prompting={prompting} onSubmit={onGenerativeSubmit} onCompile={compileReactArtifact} onExport={(html, title) => void handleArtifactExport(html, title)} /></Suspense> : null}
      {presentPayload?.kind === 'component-ui' ? (
        <div className="mt-1">
          <ComponentUiCardLazy
            key={presentPayload.id}
            result={presentPayload}
            threadId={threadId ?? ''}
            prompting={prompting}
            onSubmit={onGenerativeSubmit}
            onLocateChapter={(flatIndex, excerpt) => {
              void (async () => {
                const verdict = checkPresentDocument(
                  presentPayload,
                  useActiveDocumentStore.getState().filePath,
                )
                if (!verdict.ok) {
                  toast.message(verdict.message)
                  return
                }
                let navigated = false
                try {
                  navigated = await openChapterForMarkRecovery(flatIndex, excerpt)
                } catch (error) {
                  toast.message(error instanceof Error ? error.message : '打开章节失败，请重试')
                  return
                }
                const after = checkPresentDocument(
                  presentPayload,
                  useActiveDocumentStore.getState().filePath,
                )
                if (!after.ok) {
                  toast.message(after.message)
                  return
                }
                if (navigated && excerpt) {
                  emitAnchorHighlight(excerpt)
                }
              })()
            }}
          />
        </div>
      ) : null}
      {presentPayload == null && presentUnparsable ? (
        <div className="mt-1 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2">
          <p className="text-[11px] font-medium text-foreground/90">呈现结果无法解析</p>
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            工具返回了 montree_present 结果，但版本或字段校验未通过（需要 schemaVersion 1 与合法种类）。原始内容保留在上方文本区，可换种问法重试。
          </p>
        </div>
      ) : null}
    </>
  )
}
