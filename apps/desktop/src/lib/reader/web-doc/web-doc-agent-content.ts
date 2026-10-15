import { webDocApi } from '@/api/web-doc-api'
import { htmlToText } from '@/lib/agent/context/extract-dom-text'
import { buildWebDocPageContent } from '@/lib/reader/web-doc/web-doc-html'
import type { ReaderUnit } from '@montree/reader-core'
import { normalizeWebDocNavUrl } from '@montree/reader-core'
import { resolveWebDocSiteId } from '@montree/web-doc'
import { isOk } from '@montree/contracts'
import type { ReaderUnitText } from '@/lib/agent/context/reader-content-registry'

const WEB_DOC_TEXT_CACHE_LIMIT = 48
interface CachedPage { text: string; bodyHtml?: string }
const textCache = new Map<string, CachedPage>()

function rememberPage(pageUrl: string, page: CachedPage): void {
  const key = normalizeWebDocNavUrl(pageUrl)
  if (!textCache.has(key) && textCache.size >= WEB_DOC_TEXT_CACHE_LIMIT) {
    const oldest = textCache.keys().next().value
    if (oldest) textCache.delete(oldest)
  }
  textCache.set(key, page)
}

export function primeWebDocAgentTextCache(pageUrl: string, text: string, bodyHtml?: string): void {
  rememberPage(pageUrl, { text, bodyHtml })
}

export function clearWebDocAgentTextCache(): void { textCache.clear() }

async function fetchPage(pageUrl: string, requireHtml = false): Promise<CachedPage> {
  const key = normalizeWebDocNavUrl(pageUrl)
  const cached = textCache.get(key)
  if (cached && (!requireHtml || cached.bodyHtml !== undefined)) return cached
  // Fetch the page without its fragment; a fragment is resolved against the extracted body below.
  const target = new URL(pageUrl)
  target.hash = ''
  const result = await webDocApi.fetchPage({ url: target.toString() })
  if (!isOk(result)) throw new Error(result.error.message)
  const content = buildWebDocPageContent(result.value.html, result.value.url, resolveWebDocSiteId(result.value.url))
  const page = { text: htmlToText(content.bodyHtml), bodyHtml: content.bodyHtml }
  if (!page.text.trim()) throw new Error('网页正文提取为空，可能需要登录或动态渲染')
  rememberPage(result.value.url, page)
  rememberPage(pageUrl, page)
  return page
}

export async function fetchWebDocPlainText(pageUrl: string): Promise<string> {
  return (await fetchPage(pageUrl)).text
}

/** A fragment refers to its section, never silently to the whole article. */
function sectionText(bodyHtml: string, fragment: string): string {
  const doc = new DOMParser().parseFromString(bodyHtml, 'text/html')
  let id: string
  try { id = decodeURIComponent(fragment) } catch { id = fragment }
  const target = doc.getElementById(id) ?? Array.from(doc.querySelectorAll('a[name]')).find(el => el.getAttribute('name') === id)
  if (!target) throw new Error('页面正文中找不到目录锚点 #' + fragment)
  const heading = target.closest('h1,h2,h3,h4,h5,h6')
  if (!heading) return htmlToText(target.outerHTML)
  const level = Number(heading.tagName.slice(1))
  const next = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(el =>
    Boolean(heading.compareDocumentPosition(el) & 4) && Number(el.tagName.slice(1)) <= level)
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */)
  const pieces: string[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const afterStart = Boolean(heading.compareDocumentPosition(node) & 4 /* FOLLOWING */)
    const beforeEnd = !next || Boolean(next.compareDocumentPosition(node) & 2 /* PRECEDING */)
    if (afterStart && beforeEnd && node.textContent?.trim()) pieces.push(node.textContent)
  }
  return pieces.join('\n')
}

export async function readWebDocUnitByIndex(units: readonly ReaderUnit[], flatIndex: number): Promise<ReaderUnitText> {
  const unit = units[flatIndex]
  if (!unit) throw new Error('flatIndex 越界：有效范围 0..' + Math.max(0, units.length - 1) + '，收到 ' + flatIndex)
  try {
    const fragment = new URL(unit.href).hash.slice(1)
    const page = await fetchPage(unit.href, Boolean(fragment))
    const text = fragment ? sectionText(page.bodyHtml!, fragment) : page.text
    if (!text.trim()) throw new Error('目标章节正文为空')
    return { label: unit.label, href: unit.href, text }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error('未能读取网页章节「' + unit.label + '」（index=' + flatIndex + '）；URL: ' + unit.href + '；原因：' + reason)
  }
}

export async function* iterateWebDocUnits(units: readonly ReaderUnit[]): AsyncIterable<ReaderUnitText> {
  for (const [index] of units.entries()) {
    try { yield await readWebDocUnitByIndex(units, index) }
    catch { /* Search skips inaccessible pages; explicit chapter reads report their error. */ }
  }
}
