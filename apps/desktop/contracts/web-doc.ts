import type { WebDocFetchPayload, WebDocFetchResult } from '@yitom/contracts'

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
