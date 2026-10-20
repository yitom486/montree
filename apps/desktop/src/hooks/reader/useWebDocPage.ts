import { useQuery } from '@tanstack/react-query'
import { webDocApi } from '@/api/web-doc-api'
import { queryKeys } from '@/api/query-keys'
import { buildWebDocPageContent } from '@/lib/reader/web-doc/web-doc-html'
import { enrichWebDocCompatTables } from '@/lib/reader/web-doc/web-doc-compat'
import { resolveWebDocSiteId, stripWebDocFragment } from '@montree/web-doc'
import { isOk } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import type { WebDocPageContent } from '@yitom/contracts'

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
  // MDN 兼容性表格由客户端 BCD 数据渲染；补表失败时保留原文占位卡。
  const bodyHtml = await enrichWebDocCompatTables(content.bodyHtml, result.value.url)
  const enrichedContent = bodyHtml === content.bodyHtml ? content : { ...content, bodyHtml }
  logWebDoc('fetch-done', {
    pageUrl: result.value.url,
    siteId: enrichedContent.siteId,
    title: enrichedContent.title,
    bodyLen: enrichedContent.bodyHtml.length,
  })
  return {
    pageUrl: result.value.url,
    content: enrichedContent,
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
