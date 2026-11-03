import type { WebDocFetchPayload, WebDocFetchResult, Result, AppError } from '@yitom/contracts'

export const WEB_DOC_IMAGE_IPC = 'web-doc:fetch-image'
export interface WebDocImagePayload { pageUrl: string; url: string }
export interface WebDocImageResult { url: string; dataUrl: string }
export interface WebDocImagesAPI {
  fetch: (payload: WebDocImagePayload) => Promise<Result<WebDocImageResult, AppError>>
}

/** 页面声明的 Markdown 正文源（`<link rel="alternate" type="text/markdown">`）。 */
export interface WebDocMarkdownSource {
  url: string
  text: string
}

export interface WebDocFetchPayloadWithMarkdown extends WebDocFetchPayload {
  /** 优先抓取页面声明的 Markdown 源；抓取失败时仍回退 HTML。 */
  preferMarkdown?: boolean
}

export type WebDocFetchResultWithMarkdown = WebDocFetchResult & {
  markdown?: WebDocMarkdownSource
}
