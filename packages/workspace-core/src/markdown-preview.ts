import type { ReadingAnchor } from '@yitom/contracts'

/** 本地或远端 Markdown 渲染文档的身份；仅用于引用存储，不能用于网络导航。 */
export function markdownPreviewUrl(filePath: string): string {
  const url = new URL('montree-markdown:///document')
  url.searchParams.set('path', filePath.trim())
  return url.href
}

/** WebReadingAnchor 的文本引用策略复用于 Markdown；只接受与文档路径严格绑定的内部 URL。 */
export function isMarkdownPreviewAnchor(filePath: string, anchor: ReadingAnchor): boolean {
  return /\.(md|markdown)$/i.test(filePath.trim()) && anchor.format === 'web' &&
    anchor.url === markdownPreviewUrl(filePath)
}
