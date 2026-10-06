import {
  CONTENT_AUDIT_HIT_TEXT_BUDGET,
  CONTENT_AUDIT_RESPONSE_TEXT_BUDGET,
  resolveContentAuditMatchPosition,
  windowContentAuditText,
  type ContentAuditHit,
  type ContentAuditResult,
} from '@montree/contracts'

/**
 * 编辑器内存字面检索（P2.1，纯函数）。输入为已校验的 query（≥3 字）与
 * limit（1–10）；调用方（inspect 快照链）负责校验与文档绑定。
 * 按行命中：total 为命中行数精确值，limit 只截断展示；空文本/零命中
 * 返回 total=0 的合法 JSON，不抛错。
 */
export function inspectEditorBufferText(
  text: string,
  query: string,
  limit: number,
): ContentAuditResult {
  const needle = query.toLowerCase()
  const matched: { lineStart: number; line: string }[] = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.toLowerCase().includes(needle)) {
      matched.push({ lineStart: index + 1, line })
    }
  }
  const shown = matched.slice(0, Math.max(0, limit))
  // 与库审计同口径：单条 1200 封顶，多条按总预算 7800 均摊
  const perHitBudget = Math.min(
    CONTENT_AUDIT_HIT_TEXT_BUDGET,
    Math.floor(CONTENT_AUDIT_RESPONSE_TEXT_BUDGET / Math.max(1, shown.length)),
  )
  const hits: ContentAuditHit[] = shown.map(({ lineStart, line }) => {
    const windowed = windowContentAuditText(line, query, perHitBudget)
    return {
      source: 'editor-buffer' as const,
      locator: { lineStart },
      text: windowed.text,
      textTruncated: windowed.truncated,
      matchPosition: resolveContentAuditMatchPosition(windowed.text, query),
    }
  })
  return {
    query,
    total: matched.length,
    truncated: hits.length < matched.length,
    limit,
    hits,
  }
}
