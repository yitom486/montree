import { useEffect, useState } from 'react'
import { renderPreview, type PreviewRenderEnv } from '@/lib/preview/render-preview'
import { reportRuntimeError } from '@/lib/workspace/error-reporter'

export function useMarkdownPreview(content: string, filePath?: string, delay = 300, env?: PreviewRenderEnv, renderedHtml?: string): string {
  const [html, setHtml] = useState('')

  useEffect(() => {
    let cancelled = false

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const rendered = await renderPreview(content, filePath, env, renderedHtml)

          if (!cancelled) {
            setHtml(rendered)
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
  }, [content, filePath, delay, env, renderedHtml])

  return html
}
