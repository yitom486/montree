import type { WebDocTocEntry } from '@montree/contracts'

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ''))
}

/** 从「本版新闻」列表提取同版文章链接 */
export function extractPeopleDailyToc(html: string, baseUrl: string): WebDocTocEntry[] {
  const base = new URL(baseUrl)
  const newsListMatch = html.match(
    /<ul[^>]*\bclass=["'][^"']*news-list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i,
  )
  if (!newsListMatch?.[1]) return []

  const seen = new Set<string>()
  const entries: WebDocTocEntry[] = []
  const anchorPattern = /<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorPattern.exec(newsListMatch[1])) !== null) {
    const hrefRaw = match[1]?.trim()
    if (!hrefRaw) continue

    let absolute: URL
    try {
      absolute = new URL(hrefRaw, base)
    } catch {
      continue
    }

    if (absolute.origin !== base.origin) continue
    if (!absolute.pathname.includes('content_')) continue

    absolute.hash = ''
    const key = absolute.toString()
    if (seen.has(key)) continue
    seen.add(key)

    const label = stripTags(match[2] ?? '')
    if (!label || label.length < 2) continue

    entries.push({
      href: key,
      label: label.length > 80 ? `${label.slice(0, 80)}…` : label,
      level: 0,
    })
  }

  return entries
}
