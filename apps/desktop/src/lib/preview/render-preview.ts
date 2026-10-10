import DOMPurify from 'dompurify'
import { fileApi } from '@/api/file-api'
import { isOk } from '@montree/contracts'
import { renderMarkdown, type MarkdownRenderEnv } from '@/lib/editor/markdown'
import { resolveLocalImagePath } from '@/lib/editor/markdown-images'
import { PREVIEW_SANITIZE_OPTIONS } from './preview-sanitize'

/** Shared by reading preview and CodeMirror widgets. Parse HTML attributes with the DOM. */
export type PreviewRenderEnv = MarkdownRenderEnv & { references?: Record<string, { href: string; title: string }> }

export async function renderPreview(source: string, filePath?: string, env?: PreviewRenderEnv, renderedHtml?: string): Promise<string> {
  const html = String(DOMPurify.sanitize(`<div>${renderedHtml ?? renderMarkdown(source, env ? { ...env } : undefined)}</div>`, PREVIEW_SANITIZE_OPTIONS))
  const container = document.createElement('div')
  container.innerHTML = html
  const pending = new Map<string, Promise<string | undefined>>()
  await Promise.all(Array.from(container.querySelectorAll('img')).map(async (image) => {
    const path = resolveLocalImagePath(filePath, image.getAttribute('src') ?? '', true)
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
