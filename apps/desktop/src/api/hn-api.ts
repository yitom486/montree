import { err } from '@yitom/contracts'
import type { AppError, Result } from '@yitom/contracts'
import type { HnDiscussionRef, HnFeedPayload, HnFeedResult, HnFindDiscussionPayload } from '../../contracts/hn'

export const hnApi = {
  async fetchFeed(payload: HnFeedPayload): Promise<Result<HnFeedResult, AppError>> {
    const api = typeof window !== 'undefined' ? window.montreeHn : undefined
    if (!api) {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'Hacker News 接口不可用（请重启应用以加载最新 preload）',
      })
    }
    return api.fetchFeed(payload)
  },

  async findDiscussion(
    payload: HnFindDiscussionPayload,
  ): Promise<Result<HnDiscussionRef | null, AppError>> {
    const api = typeof window !== 'undefined' ? window.montreeHn : undefined
    if (!api) {
      return err({
        code: 'API_UNAVAILABLE',
        message: 'Hacker News 接口不可用（请重启应用以加载最新 preload）',
      })
    }
    return api.findDiscussion(payload)
  },
}
