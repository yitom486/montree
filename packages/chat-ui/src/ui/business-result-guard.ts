import { parsePresentResult, type MontreePresentResult } from '@montree/contracts'
import { isPresentToolTitle } from '@montree/chat-core'

// 自宿主 `apps/desktop/src/components/agent/tools/ToolBusinessResult.tsx` 的纯守卫部分整搬
// （M3c 私有复刻，不进 barrel；仅供包内 `agent-message-bubble` 的富结果分流使用）：
// `parseDiagram/CrossReference/ContentAudit/SuggestChapters/PresentPayload` + `hasBusinessResult` 逐字，
// 无 store、无 api、无 toast。`CrossReference/ContentAudit/SuggestChapters` payload 类型本地最小声明
// （宿主原类型仅 JSON 形状断言用，不进包；`DiagramPayload` 以包内 `diagram-viewer-card` 为准，此处仅判空）。
// `parsePresentPayload` 的 `enriched` 分支保留（`message.presentResult` 由 core `ChatMessage` 透传）。

interface CrossReferencePayloadShape {
  entity: string
  chapterDistribution: unknown[]
}

interface ContentAuditPayloadShape {
  query: string
  hits: unknown[]
  total?: number
  truncated?: boolean
  limit?: number
}

interface SuggestChaptersPayloadShape {
  chapters: unknown[]
}

function parseDiagramPayload(text?: string, title?: string): { mermaidCode: string } | null {
  if (!text || (!text.includes('mermaidCode') && !title?.includes('montree_generate_diagram'))) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && typeof (obj as Record<string, unknown>).mermaidCode === 'string') {
      return obj as { mermaidCode: string }
    }
  } catch {
    return null
  }
  return null
}

function parseCrossReferencePayload(text?: string, title?: string): CrossReferencePayloadShape | null {
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
      Array.isArray((obj as Record<string, unknown>).chapterDistribution) &&
      typeof (obj as Record<string, unknown>).entity === 'string'
    ) {
      return obj as CrossReferencePayloadShape
    }
  } catch {
    return null
  }
  return null
}

function parseContentAuditPayload(text?: string, title?: string): ContentAuditPayloadShape | null {
  if (!text) return null
  const isExplicitTool = Boolean(title?.includes('montree_inspect_content'))
  if (!isExplicitTool && !text.includes('"hits"')) {
    return null
  }
  try {
    const obj = JSON.parse(text) as Record<string, unknown>
    if (obj && typeof obj === 'object' && Array.isArray(obj.hits)) {
      const hits = obj.hits as unknown[]
      const hasMeaningfulText =
        hits.length === 0 ||
        hits.some(
          (h: unknown) =>
            h &&
            typeof h === 'object' &&
            Boolean(
              (typeof (h as Record<string, unknown>).text === 'string' && ((h as Record<string, unknown>).text as string).trim()) ||
              (typeof (h as Record<string, unknown>).content === 'string' && ((h as Record<string, unknown>).content as string).trim()) ||
              (typeof (h as Record<string, unknown>).snippet === 'string' && ((h as Record<string, unknown>).snippet as string).trim()) ||
              (typeof (h as Record<string, unknown>).match === 'string' && ((h as Record<string, unknown>).match as string).trim()) ||
              (typeof (h as Record<string, unknown>).excerpt === 'string' && ((h as Record<string, unknown>).excerpt as string).trim()),
            ),
        )

      if (typeof obj.query === 'string' && (isExplicitTool || hasMeaningfulText)) {
        return obj as unknown as ContentAuditPayloadShape
      }
    }
  } catch {
    return null
  }
  return null
}

function parseSuggestChaptersPayload(text?: string, title?: string): SuggestChaptersPayloadShape | null {
  if (!text || (!text.includes('"chapters"') && !title?.includes('montree_suggest_chapters'))) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && Array.isArray((obj as Record<string, unknown>).chapters)) {
      return obj as SuggestChaptersPayloadShape
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
export function hasBusinessResult(
  detail?: string,
  title?: string,
  enriched?: MontreePresentResult,
): boolean {
  return (
    parseDiagramPayload(detail, title) != null ||
    parseCrossReferencePayload(detail, title) != null ||
    parseContentAuditPayload(detail, title) != null ||
    parseSuggestChaptersPayload(detail, title) != null ||
    parsePresentPayload(detail, title, enriched) != null
  )
}

export function isUnparsablePresentResult(detail?: string, title?: string): boolean {
  if (!isPresentToolTitle(title)) return false
  if (!detail) return false
  return parsePresentPayload(detail, title) == null
}
