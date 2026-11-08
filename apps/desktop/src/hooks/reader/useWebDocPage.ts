import { useQuery } from '@tanstack/react-query'
import { webDocApi } from '@/api/web-doc-api'
import { queryKeys } from '@/api/query-keys'
import {
  buildWebDocPageContent,
  buildWebDocPageContentFromMarkdown,
} from '@/lib/reader/web-doc/web-doc-html'
import { enrichWebDocCompatTables } from '@/lib/reader/web-doc/web-doc-compat'
import { resolveWebDocSiteId, stripWebDocFragment } from '@montree/web-doc'
import { isOk } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'
import type { WebDocPageContentWithDiscussion } from '@/lib/reader/web-doc/discussion-link'

export interface WebDocPageData {
  pageUrl: string
  content: WebDocPageContentWithDiscussion
}

import { logWebDoc } from '@/lib/reader/web-doc/web-doc-debug'

async function fetchWebDocPageData(pageUrl: string): Promise<WebDocPageData> {
  logWebDoc('fetch-start', { pageUrl })
  const result = await webDocApi.fetchPage({ url: pageUrl, preferMarkdown: true })
  if (!isOk(result)) {
    logWebDoc('fetch-error', { pageUrl, message: result.error.message })
    throw result.error satisfies AppError
  }

  const siteId = resolveWebDocSiteId(result.value.url)
  const markdown = result.value.markdown?.text.trim() ? result.value.markdown : null
  const content = markdown
    ? buildWebDocPageContentFromMarkdown(markdown.text, result.value.url, siteId)
    : buildWebDocPageContent(result.value.html, result.value.url, siteId)
  // MDN 兼容性表格由客户端 BCD 数据渲染；补表失败时保留原文占位卡。
  const bodyHtml = await enrichWebDocCompatTables(content.bodyHtml, result.value.url)
  const enrichedContent = bodyHtml === content.bodyHtml ? content : { ...content, bodyHtml }
  logWebDoc('fetch-done', {
    pageUrl: result.value.url,
    siteId: enrichedContent.siteId,
    title: enrichedContent.title,
    bodyLen: enrichedContent.bodyHtml.length,
    source: markdown ? 'markdown' : 'html',
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
    // 同一篇文章 60 分钟内直接复用抽取结果；离开再回来不重新抓取。
    // 阅读中不因窗口聚焦被动刷新，需要更新走工具栏「重新加载」。
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
  })
}
