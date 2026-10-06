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
 * - 其它：同一路径首段共享（/learn/x → /learn/），避免各页 SSR 侧栏不一致
 */
export function resolveWebDocTocDiscoveryUrl(pageUrl: string, siteId: WebDocSiteId): string {
  try {
    const url = new URL(pageUrl)
    if (siteId === 'people-daily-paper') {
      return resolvePeopleDailyEditionUrl(pageUrl) ?? url.toString()
    }
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length >= 1) {
      return `${url.origin}/${parts[0]}/`
    }
    return `${url.origin}/`
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
