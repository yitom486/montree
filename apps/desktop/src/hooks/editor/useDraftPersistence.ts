import { useEffect } from 'react'
import { getDraftKey } from '@/lib/editor/draft-utils'
import { useDraftStore } from '@/stores/draft-store'

const DRAFT_DEBOUNCE_MS = 500

interface UseDraftPersistenceOptions {
  filePath?: string
  /** 工作区身份；缺省为本机（local），与历史裸键兼容。 */
  workspaceId?: string
  content: string
  savedContent: string
  isDirty: boolean
}

/** 编辑内容 debounce 后写入本地草稿；保存成功或不再 dirty 时清除 */
export function useDraftPersistence({
  filePath,
  workspaceId,
  content,
  savedContent,
  isDirty,
}: UseDraftPersistenceOptions) {
  const upsertDraft = useDraftStore((state) => state.upsertDraft)
  const removeDraft = useDraftStore((state) => state.removeDraft)
  const draftKey = getDraftKey(filePath, workspaceId)

  useEffect(() => {
    if (!isDirty) {
      removeDraft(draftKey)
      return
    }

    const timer = window.setTimeout(() => {
      upsertDraft({
        filePath,
        workspaceId,
        content,
        baselineContent: savedContent,
        updatedAt: Date.now(),
      })
    }, DRAFT_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [content, draftKey, filePath, isDirty, removeDraft, savedContent, upsertDraft, workspaceId])
}

export function clearDraftForFile(filePath?: string, workspaceId?: string): void {
  useDraftStore.getState().removeDraft(getDraftKey(filePath, workspaceId))
}
