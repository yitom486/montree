import { err } from '@yitom/contracts'
import type { AppError, Result } from '@yitom/contracts'
import type { FeedAuthStatus, FeedSourceId } from '../../contracts/feed'

function missingApiError(): AppError {
  return {
    code: 'API_UNAVAILABLE',
    message: '资讯登录接口不可用（请重启应用以加载最新 preload）',
  }
}

export const feedAuthApi = {
  async login(source: FeedSourceId): Promise<Result<FeedAuthStatus, AppError>> {
    const api = typeof window !== 'undefined' ? window.montreeFeedAuth : undefined
    if (!api) return err(missingApiError())
    return api.login(source)
  },

  async status(source: FeedSourceId): Promise<Result<FeedAuthStatus, AppError>> {
    const api = typeof window !== 'undefined' ? window.montreeFeedAuth : undefined
    if (!api) return err(missingApiError())
    return api.status(source)
  },

  async logout(source: FeedSourceId): Promise<Result<void, AppError>> {
    const api = typeof window !== 'undefined' ? window.montreeFeedAuth : undefined
    if (!api) return err(missingApiError())
    return api.logout(source)
  },
}
