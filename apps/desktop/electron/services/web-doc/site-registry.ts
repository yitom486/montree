import type { WebDocSiteId } from '@montree/contracts'
import { isHrttNewsHost } from '@montree/web-doc'
import { isPeopleDailyPaperHost } from '@montree/web-doc'

/**
 * 仅保留确需版面特化的站点 id。
 * 文档站（含原 react.dev）一律走 generic-ssr 通用目录/正文能力。
 */
export function resolveWebDocSiteId(url: URL): WebDocSiteId {
  const host = url.hostname.toLowerCase()
  if (isPeopleDailyPaperHost(host)) {
    return 'people-daily-paper'
  }
  if (isHrttNewsHost(host)) {
    return 'hrtt-news'
  }
  return 'generic-ssr'
}
