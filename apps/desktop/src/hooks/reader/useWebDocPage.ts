import { useQuery } from '@tanstack/react-query'
import { webDocApi } from '@/api/web-doc-api'
import { queryKeys } from '@/api/query-keys'
import { buildWebDocPageContent } from '@/lib/reader/web-doc/web-doc-html'
import { resolveWebDocSiteId, stripWebDocFragment } from '@montree/web-doc'
import { isOk } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import type { WebDocPageContent } from '@montree/contracts'

export interface WebDocPageData {
  pageUrl: string
  content: WebDocPageContent
}

import { logWebDoc } from '@/lib/reader/web-doc/web-doc-debug'

async function fetchWebDocPageData(pageUrl: string): Promise<WebDocPageData> {
  logWebDoc('fetch-start', { pageUrl })
  const result = await webDocApi.fetchPage({ url: pageUrl })
  if (!isOk(result)) {
    logWebDoc('fetch-error', { pageUrl, message: result.error.message })
    throw result.error satisfies AppError
  }

  const content = buildWebDocPageContent(
    result.value.html,
    result.value.url,
    resolveWebDocSiteId(result.value.url),
  )
  logWebDoc('fetch-done', {
    pageUrl: result.value.url,
    siteId: content.siteId,
    title: content.title,
    bodyLen: content.bodyHtml.length,
  })
  return {
    pageUrl: result.value.url,
    content,
  }
}

export function useWebDocPage(pageUrl: string | null | undefined) {
  const safeUrl = pageUrl?.trim() || null
  const documentUrl = safeUrl ? stripWebDocFragment(safeUrl) : null

  return useQuery<WebDocPageData, AppError>({
    queryKey: queryKeys.webDocPage(documentUrl ?? ''),
    enabled: Boolean(documentUrl),
    queryFn: () => fetchWebDocPageData(documentUrl!),
    staleTime: 60_000,
  })
}
