import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { fileApi } from '@/api/file-api'
import {
  buildImageReplacements,
  extractLocalImageRefsFromHtml,
  replaceImageSrcInHtml,
} from '@/lib/editor/markdown-images'
import { renderMarkdown } from '@/lib/editor/markdown'
import { PREVIEW_SANITIZE_OPTIONS } from '@/lib/preview/preview-sanitize'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'
import { isOk } from '@montree/contracts'

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

export function useMarkdownPreview(content: string, filePath?: string, delay = 300): string {
  const [html, setHtml] = useState('')

  useEffect(() => {
    let cancelled = false

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const env: { headingSlugCounts: Map<string, number> } = {
            headingSlugCounts: new Map(),
          }
          const raw = renderMarkdown(content, env)
          const withImages = await resolveLocalImagesInHtml(raw, filePath)

          if (!cancelled) {
            // 包一层再消毒：sole-root 的 pre.mermaid 在 DOMPurify 下会被剥成纯文本
            setHtml(String(DOMPurify.sanitize(`<div>${withImages}</div>`, PREVIEW_SANITIZE_OPTIONS)))
          }
        } catch (error) {
          console.error('[useMarkdownPreview]', error)
          if (!cancelled) {
            setHtml('')
          }
          reportRuntimeError(error, { source: 'preview', filePath })
        }
      })()
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [content, filePath, delay])

  return html
}
