import type { ReadingMark, ReadingMarkCategory } from '@montree/contracts'

export interface ResolvedCardMeta {
  category: ReadingMarkCategory
  title?: string
  displayNote?: string
  aiSummary?: string
  keyPoints?: string[]
  diagramId?: string
}

export interface ParsedNoteCardMeta {
  category?: ReadingMarkCategory
  title?: string
  aiSummary?: string
  keyPoints?: string[]
  diagramId?: string
  note?: string
}

/**
 * 解析可能包含序列化卡片载荷的 note 字符串。
 * 若为 JSON 载荷，则抽离各微晶卡片元数据，并将 note 净化为用户手写留言（若无则置空，杜绝 raw JSON 泄漏入库）。
 */
export function parseNoteToCardMeta(rawNote?: string): ParsedNoteCardMeta {
  if (!rawNote) return {}
  const trimmed = rawNote.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        return {
          category: parsed.category,
          title: parsed.title,
          aiSummary: parsed.aiSummary,
          keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : undefined,
          diagramId: parsed.diagramId,
          note: parsed.userNote || parsed.note || undefined,
        }
      }
    } catch {
      // 非法 JSON 保持原样
    }
  }
  return { note: trimmed || undefined }
}

/**
 * 从阅读标记中解析微晶知识卡片的元数据。
 * 支持平铺字段与 note 内嵌结构化 JSON 的平滑反序列化，确保杜绝原始 JSON 字符串暴露在 UI 上。
 */
export function resolveCardMeta(mark: ReadingMark): ResolvedCardMeta {
  const nestedCardMeta = (mark as unknown as { cardMeta?: { category?: ReadingMarkCategory; title?: string } }).cardMeta
  let category: ReadingMarkCategory =
    mark.category ||
    nestedCardMeta?.category ||
    (mark.diagramId ? 'diagram' : mark.kind === 'note' ? 'note' : 'quote')
  let title: string | undefined = mark.title || mark.label || nestedCardMeta?.title
  let aiSummary: string | undefined = mark.aiSummary
  let keyPoints: string[] | undefined = mark.keyPoints
  let diagramId: string | undefined = mark.diagramId
  let displayNote: string | undefined = mark.note

  // 尝试反序列化内嵌在 note 中的 JSON 元数据（历史数据或未拆包数据兼容）
  if (displayNote && displayNote.trim().startsWith('{') && displayNote.trim().endsWith('}')) {
    const parsed = parseNoteToCardMeta(displayNote)
    if (parsed.category) category = parsed.category
    if (parsed.title) title = parsed.title
    if (parsed.aiSummary) aiSummary = parsed.aiSummary
    if (parsed.keyPoints) keyPoints = parsed.keyPoints
    if (parsed.diagramId) diagramId = parsed.diagramId
    displayNote = parsed.note
  }

  return {
    category,
    title,
    displayNote,
    aiSummary,
    keyPoints,
    diagramId,
  }
}

/** 归一化（去空白与中英文标点），供冗余判定 */
function normalizeForCompare(text: string): string {
  return text.replace(/[\s\p{P}]/gu, '')
}

/**
 * 滤掉复读摘录的要点 pill（展示层用，数据不动）。
 * quote/cloze 类卡的 keyPoints 常是摘录按标点切出来的原句，
 * 与上方摘录块逐字重复——展示层直接隐藏。
 * 判定：归一化后要点含于摘录（含）则视为复读丢弃；空串与精确去重一并处理。
 */
export function filterRedundantKeyPoints(
  keyPoints: readonly string[] | undefined,
  excerpt: string | undefined,
): string[] {
  if (!keyPoints || keyPoints.length === 0) return []
  const seen = new Set<string>()
  const excerptNorm = normalizeForCompare(excerpt ?? '')
  const out: string[] = []
  for (const raw of keyPoints) {
    const point = (raw ?? '').trim()
    if (!point) continue
    const norm = normalizeForCompare(point)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    // 摘录为空时无法判定复读，保留（调用方无摘录的卡本就不该有 pill，容错保留）
    if (excerptNorm && excerptNorm.includes(norm)) continue
    out.push(point)
  }
  return out
}
