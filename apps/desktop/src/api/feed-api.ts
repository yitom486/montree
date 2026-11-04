import { err } from '@yitom/contracts'
import type { AppError, Result } from '@yitom/contracts'
import type { FeedFetchPayload, FeedResult } from '../../contracts/feed'

export const feedApi = {
  async fetch(payload: FeedFetchPayload): Promise<Result<FeedResult, AppError>> {
    const api = typeof window !== 'undefined' ? window.montreeFeed : undefined
    if (!api) {
      return err({
        code: 'API_UNAVAILABLE',
        message: '资讯源接口不可用（请重启应用以加载最新 preload）',
      })
    }
    return api.fetch(payload)
  },
}
