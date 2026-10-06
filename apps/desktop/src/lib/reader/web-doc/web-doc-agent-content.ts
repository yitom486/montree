import { webDocApi } from '@/api/web-doc-api'
import { htmlToText } from '@/lib/agent/context/extract-dom-text'
import { buildWebDocPageContent } from '@/lib/reader/web-doc/web-doc-html'
import type { ReaderUnit } from '@montree/reader-core'
import { normalizeWebDocNavUrl } from '@montree/reader-core'
import { resolveWebDocSiteId } from '@montree/web-doc'
import { isOk } from '@montree/contracts'
import type { ReaderUnitText } from '@/lib/agent/context/reader-content-registry'

const WEB_DOC_TEXT_CACHE_LIMIT = 48

const textCache = new Map<string, string>()

function rememberCachedText(pageUrl: string, text: string): void {
  const key = normalizeWebDocNavUrl(pageUrl)
  if (textCache.size >= WEB_DOC_TEXT_CACHE_LIMIT) {
    const oldest = textCache.keys().next().value
    if (oldest) textCache.delete(oldest)
  }
  textCache.set(key, text)
}

export function primeWebDocAgentTextCache(pageUrl: string, text: string): void {
  rememberCachedText(pageUrl, text)
}

export function clearWebDocAgentTextCache(): void {
  textCache.clear()
}

export async function fetchWebDocPlainText(pageUrl: string): Promise<string> {
  const key = normalizeWebDocNavUrl(pageUrl)
  const cached = textCache.get(key)
  if (cached !== undefined) return cached

  const result = await webDocApi.fetchPage({ url: pageUrl })
  if (!isOk(result)) {
    throw new Error(result.error.message)
  }

  const content = buildWebDocPageContent(
    result.value.html,
    result.value.url,
    resolveWebDocSiteId(result.value.url),
  )
  const text = htmlToText(content.bodyHtml)
  rememberCachedText(result.value.url, text)
  return text
}

export async function readWebDocUnitByIndex(
  units: readonly ReaderUnit[],
  flatIndex: number,
): Promise<ReaderUnitText> {
  const unit = units[flatIndex]
  if (!unit) {
    throw new Error(`flatIndex 越界：有效范围 0..${Math.max(0, units.length - 1)}，收到 ${flatIndex}`)
  }

  const text = await fetchWebDocPlainText(unit.href)
  return {
    label: unit.label,
    text,
  }
}

export async function* iterateWebDocUnits(
  units: readonly ReaderUnit[],
): AsyncIterable<ReaderUnitText> {
  for (const unit of units) {
    const text = await fetchWebDocPlainText(unit.href)
    yield {
      label: unit.label,
      text,
    }
  }
}
