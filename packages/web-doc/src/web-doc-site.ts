import type { WebDocSiteId } from '@montree/contracts'
import { isHrttNewsHost } from './hrtt'
import { isPeopleDailyPaperHost, resolvePeopleDailyEditionUrl } from './people-daily'

/**
 * 仅人民日报纸媒与华人头条保留站点 id（版面 DOM 特殊）。
 * react.dev 等文档站走 generic-ssr。
 */
export function resolveWebDocSiteId(pageUrl: string): WebDocSiteId {
  try {
    const host = new URL(pageUrl).hostname.toLowerCase()
    if (isPeopleDailyPaperHost(host)) {
      return 'people-daily-paper'
    }
    if (isHrttNewsHost(host)) {
      return 'hrtt-news'
    }
  } catch {
    // ignore
  }
  return 'generic-ssr'
}

export { resolvePeopleDailyEditionUrl }

export function normalizeWebDocInputUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Remove only the client-side fragment from a valid document URL.
 *
 * Fragments are navigation state for the reader and must remain in the URL
 * shown to the user. They are not sent to the server, however, so fetch/cache
 * callers should use this helper to derive the document identity.
 */
export function stripWebDocFragment(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

export function formatWebDocTitle(pageUrl: string, pageTitle?: string): string {
  if (pageTitle?.trim()) return pageTitle.trim()
  return formatWebDocPathLabel(pageUrl)
}

/** 面包屑用：已有 host 时只显示路径或页标题 */
export function formatWebDocPathLabel(pageUrl: string, pageTitle?: string): string {
  if (pageTitle?.trim()) return pageTitle.trim()
  try {
    const url = new URL(pageUrl)
    const path = url.pathname.replace(/\/$/, '') || '/'
    return path === '/' ? url.hostname : path
  } catch {
    return pageUrl
  }
}

/**
 * 目录发现入口（缓存键）：
 * - 人民日报：同一「版」共享
 * - 现代技术文档站：智能识别版本号（/v2/）、语言（/zh/）与文档根（/docs/、/learn/ 等），避免因截断过短跌入过渡/重定向空页
 */
export function resolveWebDocTocDiscoveryUrl(pageUrl: string, siteId: WebDocSiteId): string {
  try {
    const url = new URL(pageUrl)
    if (siteId === 'people-daily-paper') {
      return resolvePeopleDailyEditionUrl(pageUrl) ?? url.toString()
    }
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length === 0) return `${url.origin}/`

    // 1. 如果路径中包含常见的文档根关键字（docs / doc / learn / guide / tutorial / manual / api）
    const docIndex = parts.findIndex((p) =>
      /^(docs?|learn|guides?|tutorials?|manual|reference|api)$/i.test(p),
    )
    if (docIndex >= 0) {
      const docParts = parts.slice(0, docIndex + 1)
      return `${url.origin}/${docParts.join('/')}/`
    }

    // 2. 检查是否首段是版本（v1, v2 等）或语言代码（zh, en 等）且还有后续段落
    const isVersionOrLang = /^(v\d+(\.\d+)*|[a-z]{2}(-[a-z]{2,4})?|latest|next)$/i.test(parts[0]!)
    if (isVersionOrLang && parts.length >= 2) {
      return `${url.origin}/${parts[0]}/${parts[1]}/`
    }

    // 3. 缺省回落第一段
    return `${url.origin}/${parts[0]}/`
  } catch {
    return pageUrl
  }
}

/** 在线文档书级 id：与 TOC 发现入口一致，用于阅读标记 filePath */
export function resolveWebDocDocumentId(pageUrl: string, siteId: WebDocSiteId): string {
  if (siteId === 'people-daily-paper') {
    return resolvePeopleDailyEditionUrl(pageUrl) ?? pageUrl
  }
  return resolveWebDocTocDiscoveryUrl(pageUrl, siteId)
}

export function buildWebDocFileFingerprint(documentId: string): string {
  return `web|${documentId}`
}
