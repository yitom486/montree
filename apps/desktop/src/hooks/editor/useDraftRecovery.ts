import { useEffect, useRef, useState } from 'react'
import { getDraftKey, pickLatestRecoverableDraft } from '@/lib/editor/draft-utils'
import { useDraftStore } from '@/stores/draft-store'

/** 应用启动时检测本地草稿，返回待恢复的 draft key */
export function useDraftRecoveryPrompt(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const [recoveryDraftKey, setRecoveryDraftKey] = useState<string | null>(null)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (!enabled || checkedRef.current) return
    checkedRef.current = true

    const { drafts } = useDraftStore.getState()
    const latest = pickLatestRecoverableDraft(drafts)
    if (latest) {
      setRecoveryDraftKey(getDraftKey(latest.filePath, latest.workspaceId))
    }
  }, [enabled])

  const dismissRecovery = () => setRecoveryDraftKey(null)

  return { recoveryDraftKey, dismissRecovery }
}

export { useDraftPersistence, clearDraftForFile } from './useDraftPersistence'
