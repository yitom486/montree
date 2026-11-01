import type { HtmlPreviewAPI, HtmlPreviewLink, HtmlPreviewRegistration } from '../../contracts/html-preview'

function bridge(): HtmlPreviewAPI {
  if (!window.montreeHtmlPreview) throw new Error('HTML 预览接口未就绪，请完全重启应用后重试')
  return window.montreeHtmlPreview
}

export const htmlPreviewApi = {
  async resolveLink(token: string, href: string): Promise<HtmlPreviewLink> {
    const result = await bridge().resolveLink(token, href)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  },
  async register(filePath: string): Promise<HtmlPreviewRegistration> {
    const result = await bridge().register(filePath)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  },
  async update(token: string, html: string): Promise<void> {
    const result = await bridge().update(token, html)
    if (!result.ok) throw new Error(result.error.message)
  },
  async release(token: string): Promise<void> {
    await bridge().release(token)
  },
}
