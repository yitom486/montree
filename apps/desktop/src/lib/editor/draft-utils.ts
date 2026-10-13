import { scopeDocumentKey } from '@montree/contracts'

/** 崩溃恢复草稿：未命名文档使用固定键 */
export const UNTITLED_DRAFT_KEY = '__untitled__'

export interface DocumentDraft {
  filePath?: string
  /** 工作区身份；缺省为本机（local），历史裸键零变化。 */
  workspaceId?: string
  content: string
  /** 写入草稿时磁盘上的已保存内容（用于恢复后仍标记 dirty） */
  baselineContent: string
  updatedAt: number
}

/**
 * 草稿键：local/缺省沿用裸路径（回归零变化），远端按 workspaceId
 * 命名空间隔离（同一相对路径在不同工作区是不同文档）。
 */
export function getDraftKey(filePath?: string, workspaceId?: string): string {
  return scopeDocumentKey(filePath ?? UNTITLED_DRAFT_KEY, workspaceId)
}

export function isRecoverableDraft(draft: DocumentDraft): boolean {
  return draft.content !== draft.baselineContent
}

export function pickLatestRecoverableDraft(
  drafts: Record<string, DocumentDraft>,
): DocumentDraft | null {
  const recoverable = Object.values(drafts)
    .filter(isRecoverableDraft)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return recoverable[0] ?? null
}

export function getDraftDisplayName(draft: DocumentDraft): string {
  if (draft.filePath) {
    return draft.filePath.split(/[/\\]/).pop() ?? draft.filePath
  }
  return '未命名文档'
}
