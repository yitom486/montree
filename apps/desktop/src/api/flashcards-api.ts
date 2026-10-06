import type {
  AppendFlashcardReviewPayload,
  DueFlashcard,
  ListDueFlashcardsPayload,
} from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'

function requireElectronAPI() {
  if (!window.electronAPI) {
    return err({
      code: 'API_UNAVAILABLE' as const,
      message: 'Electron API 不可用',
    })
  }
  return ok(window.electronAPI)
}

export const flashcardsApi = {
  /** 本书待复习列表（未复习优先、其次最久未复习） */
  async listDue(payload: ListDueFlashcardsPayload): Promise<Result<DueFlashcard[], AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.listDueFlashcards(payload)
  },

  /**
   * 记一次复习评分；true=已落盘，false=未落盘（调用方本地评分态照常推进）。
   */
  async appendReview(
    payload: AppendFlashcardReviewPayload,
  ): Promise<Result<boolean, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.appendFlashcardReview(payload)
  },
}
