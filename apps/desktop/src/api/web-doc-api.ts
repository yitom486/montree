import type {
  WebDocDiscoverTocPayload,
  WebDocDiscoverTocResult,
} from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import type { Result } from '@yitom/contracts'
import type { ElectronAPI } from '@yitom/contracts'
import { err } from '@yitom/contracts'
import type {
  WebDocFetchPayloadWithMarkdown,
  WebDocFetchResultWithMarkdown,
} from '../../contracts/web-doc'

function requireElectronAPI(): Result<ElectronAPI, AppError> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.fetchWebDocPage || !api.discoverWebDocToc) {
    return err({
      code: 'API_UNAVAILABLE',
      message: '在线文档 API 不可用（请重启应用以加载最新 preload）',
    })
  }
  return { ok: true, value: api }
}

export const webDocApi = {
  async fetchPage(
    payload: WebDocFetchPayloadWithMarkdown,
  ): Promise<Result<WebDocFetchResultWithMarkdown, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.fetchWebDocPage(payload)
  },

  async discoverToc(
    payload: WebDocDiscoverTocPayload,
  ): Promise<Result<WebDocDiscoverTocResult, AppError>> {
    const api = requireElectronAPI()
    if (!api.ok) return api
    return api.value.discoverWebDocToc(payload)
  },
}
