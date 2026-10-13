import DOMPurify from 'dompurify'
import { fileApi } from '@/api/file-api'
import { workspaceApi } from '@/api/workspace-api'
import { isOk } from '@montree/contracts'
import { renderMarkdown, type MarkdownRenderEnv } from '@/lib/editor/markdown'
import { resolveLocalImagePath, resolveWorkspaceImageRef } from '@/lib/editor/markdown-images'
import { PREVIEW_SANITIZE_OPTIONS } from './preview-sanitize'

/** Shared by reading preview and CodeMirror widgets. Parse HTML attributes with the DOM. */
export type PreviewRenderEnv = MarkdownRenderEnv & { references?: Record<string, { href: string; title: string }> }

/** B2：远端文档图片经宿主读取（workspaceId + 文档相对路径；不拼 UNC）。 */
export interface PreviewWorkspaceRef {
  workspaceId: string
  relativePath: string
}

export async function renderPreview(source: string, filePath?: string, env?: PreviewRenderEnv, renderedHtml?: string, workspaceRef?: PreviewWorkspaceRef): Promise<string> {
  const html = String(DOMPurify.sanitize(`<div>${renderedHtml ?? renderMarkdown(source, env ? { ...env } : undefined)}</div>`, PREVIEW_SANITIZE_OPTIONS))
  const container = document.createElement('div')
  container.innerHTML = html
  const pending = new Map<string, Promise<string | undefined>>()
  await Promise.all(Array.from(container.querySelectorAll('img')).map(async (image) => {
    const rawSrc = image.getAttribute('src') ?? ''
    // B2：远端文档相对图片走宿主（DocumentRef），不断言本机绝对路径。
    if (workspaceRef) {
      const rel = resolveWorkspaceImageRef(workspaceRef.relativePath, rawSrc)
      if (!rel) return
      let request = pending.get(`ws:${rel}`)
      if (!request) {
        request = workspaceApi.readImage({ workspaceId: workspaceRef.workspaceId, relativePath: rel }).then((result) => isOk(result) ? result.value.dataUrl : undefined)
        pending.set(`ws:${rel}`, request)
      }
      const dataUrl = await request
      if (dataUrl) image.setAttribute('src', dataUrl)
      return
    }
    const path = resolveLocalImagePath(filePath, rawSrc, true)
    if (!path) return
    let request = pending.get(path)
    if (!request) {
      request = fileApi.readImage(path).then((result) => isOk(result) ? result.value.dataUrl : undefined)
      pending.set(path, request)
    }
    const dataUrl = await request
    if (dataUrl) image.setAttribute('src', dataUrl)
  }))
  return String(DOMPurify.sanitize(`<div>${container.innerHTML}</div>`, PREVIEW_SANITIZE_OPTIONS))
}
