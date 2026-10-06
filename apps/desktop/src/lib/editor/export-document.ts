import DOMPurify, { type Config } from 'dompurify'
import { fileApi } from '@/api/file-api'
import {
  EXPORT_DOCUMENT_STYLES,
  stripExportChrome,
} from '@/lib/editor/export-document-styles'
import {
  buildImageReplacements,
  extractLocalImageRefsFromHtml,
  replaceImageSrcInHtml,
} from '@/lib/editor/markdown-images'
import { renderMarkdown } from '@/lib/editor/markdown'
import { isOk } from '@montree/contracts'

const PREVIEW_SANITIZE_OPTIONS: Config = {
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  ADD_TAGS: ['input'],
  ADD_ATTR: ['type', 'checked', 'disabled'],
}

async function resolveLocalImagesInHtml(
  html: string,
  filePath: string | undefined,
): Promise<string> {
  const localRefs = extractLocalImageRefsFromHtml(html, filePath)
  if (localRefs.length === 0) return html

  const dataUrlsByAbsolutePath: Record<string, string | undefined> = {}
  const uniquePaths = [...new Set(localRefs.map((ref) => ref.absolutePath))]

  await Promise.all(
    uniquePaths.map(async (absolutePath) => {
      const result = await fileApi.readImage(absolutePath)
      if (isOk(result)) {
        dataUrlsByAbsolutePath[absolutePath] = result.value.dataUrl
      }
    }),
  )

  const replacements = buildImageReplacements(localRefs, dataUrlsByAbsolutePath)
  return replaceImageSrcInHtml(html, replacements)
}

export async function buildExportHtml(content: string, filePath?: string): Promise<string> {
  const env: { headingSlugCounts: Map<string, number> } = {
    headingSlugCounts: new Map(),
  }
  const raw = renderMarkdown(content, env)
  const withImages = await resolveLocalImagesInHtml(raw, filePath)
  const sanitized = String(DOMPurify.sanitize(withImages, PREVIEW_SANITIZE_OPTIONS))
  const body = stripExportChrome(sanitized)

  const title = filePath?.split(/[/\\]/).pop() ?? 'Markdown Export'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>${EXPORT_DOCUMENT_STYLES}</style>
</head>
<body>
  <article class="markdown-preview">${body}</article>
</body>
</html>`
}

export function getSuggestedExportName(filePath: string | undefined, extension: 'html' | 'pdf'): string {
  if (!filePath) return `export.${extension}`
  const base = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'export'
  return `${base}.${extension}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
