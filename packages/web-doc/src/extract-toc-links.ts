import type { WebDocTocEntry } from '@yitom/contracts'

const MAX_TOC_ENTRIES = 240

/** 解码常见 HTML 实体（含 &nbsp; / 数字实体），供目录标签使用 */
export function decodeHtmlEntities(text: string): string {
  const named = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ensp;/gi, ' ')
    .replace(/&emsp;/gi, ' ')
    .replace(/&thinsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")

  return named
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
}

function extractAnchorLabel(anchorHtml: string): string {
  const ellipsis = anchorHtml.match(/<span[^>]*\bmd-ellipsis\b[^>]*>([\s\S]*?)<\/span>/i)?.[1]
  if (ellipsis) {
    const label = stripTags(ellipsis)
    if (label) return label
  }

  const title = anchorHtml.match(/\btitle=["']([^"']+)["']/i)?.[1]
  if (title?.trim()) return decodeHtmlEntities(title)

  const srOnly = anchorHtml.match(/<span[^>]*\bsr-only\b[^>]*>([\s\S]*?)<\/span>/i)?.[1]
  if (srOnly) {
    const label = stripTags(srOnly)
    if (label) return label
  }

  return stripTags(anchorHtml)
}

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
}

/**
 * 按标签深度平衡截取元素（避免非贪婪正则在嵌套 nav 处提早结束）。
 * MkDocs Material 等主题的主侧栏内含多层 `<nav>`。
 */
export function extractBalancedElements(html: string, tagName: string): string[] {
  const openRe = new RegExp(`<${tagName}\\b`, 'gi')
  const blocks: string[] = []
  let match: RegExpExecArray | null

  while ((match = openRe.exec(html)) !== null) {
    const start = match.index
    let depth = 0
    let i = start
    while (i < html.length) {
      const slice = html.slice(i)
      const openRel = slice.slice(1).search(new RegExp(`<${tagName}\\b`, 'i'))
      const closeRel = slice.search(new RegExp(`</${tagName}>`, 'i'))
      const nextOpen = openRel < 0 ? -1 : i + 1 + openRel
      const nextClose = closeRel < 0 ? -1 : i + closeRel
      if (nextClose < 0) break

      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1
        i = nextOpen
        continue
      }

      if (depth === 0) {
        const end = nextClose + tagName.length + 3
        blocks.push(html.slice(start, end))
        // 避免在已匹配块内部再次从子 nav 起扫
        openRe.lastIndex = end
        break
      }

      depth -= 1
      i = nextClose + tagName.length + 3
    }
  }

  return blocks
}

/**
 * 选取最可能是「站点目录」的 nav：完整主侧栏优先于章节内嵌套 nav。
 * 核心原则：
 * 1. 强力区分「全站跨页主侧栏」与「页内锚点大纲（On this page）」：
 *    - 链接绝大多数为 #hash 锚点、或标有 On this page/docs-toc 的导航直接降权排除；
 * 2. 优先重奖含有大量跨页面相对路径链接、具有 sidebar 标识与多层分组的导航容器。
 */
export function pickDocsNavHtml(html: string): string | null {
  const cleaned = stripScriptsAndStyles(html)
  const navBlocks = extractBalancedElements(cleaned, 'nav')
  if (navBlocks.length === 0) {
    const sidebar = cleaned.match(/<div\b[^>]*\bid=["']sidebar["'][^>]*>[\s\S]*?<\/div>/i)?.[0]
    return sidebar ?? null
  }

  const scored = navBlocks.map((block) => {
    const openTag = block.match(/^<nav\b[^>]*>/i)?.[0] ?? ''
    let score = 0

    // 统计链接特征：跨页同站链接 vs 纯 #hash 本页锚点
    const allAnchors = block.match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi) ?? []
    const totalAnchors = allAnchors.length
    let hashAnchorCount = 0
    let crossPageAnchorCount = 0
    for (const a of allAnchors) {
      const hrefMatch = a.match(/\bhref=["']([^"']+)["']/i)
      if (!hrefMatch) continue
      const h = hrefMatch[1]!.trim()
      if (h.startsWith('#')) {
        hashAnchorCount += 1
      } else if (!h.startsWith('javascript:') && !h.startsWith('mailto:') && !h.startsWith('tel:')) {
        crossPageAnchorCount += 1
      }
    }

    const isMostlyHash = totalAnchors >= 2 && hashAnchorCount / totalAnchors >= 0.6
    const isInPageToc =
      /aria-label=["'][^"']*(on this page|page outline|table of contents|本页|页内|in this article)[^"']*["']/i.test(openTag) ||
      /\bclass=["'][^"']*(docs-toc|page-toc|on-this-page|in-page-toc|table-of-contents)[^"']*["']/i.test(openTag) ||
      /<h[2-4][^>]*>(on this page|page outline|本页目录|本页大纲|in this article)<\/h[2-4]>/i.test(block)

    const isHeaderOrFooter =
      /md-header|md-footer|md-nav--secondary/i.test(openTag) ||
      /aria-label=["'][^"']*(页眉|页脚|header|footer)[^"']*["']/i.test(openTag)

    // 页内大纲与页眉页脚强力降权，严防错选
    if (isMostlyHash || isInPageToc) {
      score -= 200
    }
    if (isHeaderOrFooter) {
      score -= 100
    }

    // 主侧栏标志重赏
    if (
      /\b(id|class)=["'][^"']*(sidebar|docs-sidebar|nav-sidebar|documentation-sidebar|site-sidebar|main-sidebar)[^"']*["']/i.test(
        openTag,
      )
    ) {
      score += 120
    }
    if (/md-nav--primary/i.test(openTag)) {
      score += 120
    }
    if (
      /aria-label=["'][^"']*(documentation|docs|navigation|sidebar|site navigation|全站|pages)[^"']*["']/i.test(
        openTag,
      )
    ) {
      score += 80
    }
    if (/\brole=["']navigation["']/i.test(openTag)) {
      score += 40
    }
    if (/sidebar-group|sidebar-title|md-nav__list/i.test(block)) {
      score += 50
    }

    // 跨页有效链接数重奖
    score += Math.min(crossPageAnchorCount * 4, 160)
    const ulCount = (block.match(/<ul\b/gi) ?? []).length
    score += Math.min(ulCount * 3, 30)
    const nestedNavCount = (block.match(/<nav\b/gi) ?? []).length
    score += Math.min(nestedNavCount * 5, 40)

    return { block, score, crossPageAnchorCount, totalAnchors }
  })

  scored.sort((a, b) => b.score - a.score || b.crossPageAnchorCount - a.crossPageAnchorCount)
  const best = scored[0]
  if (!best || best.score <= 0 || best.crossPageAnchorCount < 2) return null
  return best.block
}

function resolveSameOriginHref(hrefRaw: string, base: URL): string | null {
  const raw = hrefRaw.trim()
  if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:')) return null
  if (raw === '#' || raw.startsWith('javascript:')) return null

  let absolute: URL
  try {
    absolute = new URL(raw, base)
  } catch {
    return null
  }

  if (absolute.origin !== base.origin) return null
  if (!['http:', 'https:'].includes(absolute.protocol)) return null
  absolute.hash = ''
  return absolute.toString()
}

/**
 * 从文档站侧栏 nav 提取层级目录。
 * - 保留 DOM 顺序
 * - 嵌套 `<ul>` 增加缩进（MkDocs 内层 nav 里的 ul 一并计入）
 * - `<h2>`/`<h3>`/`<h4>` 分组标题合成父节点
 */
export function extractStructuredNavToc(html: string, baseUrl: string): WebDocTocEntry[] {
  const navHtml = pickDocsNavHtml(html)
  if (!navHtml) return []

  const base = new URL(baseUrl)
  const entries: WebDocTocEntry[] = []
  const seenLeaves = new Set<string>()

  let depth = 0
  // 跳过最外层包裹 nav，避免整树多缩进一层
  let pos = 0
  if (/^<nav\b/i.test(navHtml)) {
    const gt = navHtml.indexOf('>')
    pos = gt >= 0 ? gt + 1 : 0
  }

  let pendingGroup: { label: string; level: number } | null = null
  let activeGroupLevel: number | null = null
  let groupBaseDepth = 0

  const push = (entry: WebDocTocEntry, asLeaf: boolean): boolean => {
    const label = entry.label.length > 80 ? `${entry.label.slice(0, 80)}…` : entry.label
    if (asLeaf) {
      if (seenLeaves.has(entry.href)) return false
      seenLeaves.add(entry.href)
    }
    entries.push({ ...entry, label })
    return entries.length >= MAX_TOC_ENTRIES
  }

  const bumpDepth = (delta: number, at: number, tokenLen: number) => {
    depth = Math.max(0, depth + delta)
    if (delta < 0 && activeGroupLevel !== null && depth < groupBaseDepth) {
      activeGroupLevel = null
      groupBaseDepth = 0
    }
    return at + tokenLen
  }

  while (pos < navHtml.length) {
    const ulOpen = navHtml.indexOf('<ul', pos)
    const ulClose = navHtml.indexOf('</ul>', pos)
    const aMatches = ['<a ', '<a\n', '<a\t', '<a>'].map((token) => navHtml.indexOf(token, pos))
    const nextA = aMatches.filter((i) => i >= 0).reduce((min, i) => Math.min(min, i), Infinity)
    const headingMatches = ['<h2', '<h3', '<h4'].map((token) => navHtml.indexOf(token, pos))
    const nextH = headingMatches.filter((i) => i >= 0).reduce((min, i) => Math.min(min, i), Infinity)

    const candidates = [
      ulOpen,
      ulClose,
      nextA === Infinity ? -1 : nextA,
      nextH === Infinity ? -1 : nextH,
    ].filter((index) => index >= 0)
    if (candidates.length === 0) break

    const next = Math.min(...candidates)

    if (next === ulOpen) {
      pos = bumpDepth(1, ulOpen, 3)
      continue
    }
    if (next === ulClose) {
      pos = bumpDepth(-1, ulClose, 5)
      continue
    }

    if (next === nextH) {
      const closeTag = navHtml.indexOf('>', nextH)
      const endHeading = navHtml.indexOf('</h', nextH)
      if (closeTag < 0 || endHeading < 0) break
      const label = stripTags(navHtml.slice(closeTag + 1, endHeading))
      pos = endHeading + 5
      if (label && label.length >= 2 && label.length <= 80) {
        pendingGroup = { label, level: Math.max(0, depth > 0 ? depth - 1 : 0) }
        activeGroupLevel = null
        groupBaseDepth = 0
      }
      continue
    }

    const closeTag = navHtml.indexOf('</a>', nextA)
    if (closeTag < 0) break

    const anchorHtml = navHtml.slice(nextA, closeTag + 4)
    pos = closeTag + 4

    const hrefMatch = anchorHtml.match(/\bhref=["']([^"']+)["']/i)
    if (!hrefMatch) continue

    const key = resolveSameOriginHref(hrefMatch[1]!, base)
    if (!key) continue

    const label = extractAnchorLabel(anchorHtml)
    if (!label || label.length < 2 || label.length > 120) continue

    if (pendingGroup) {
      activeGroupLevel = pendingGroup.level
      groupBaseDepth = Math.max(1, depth)
      if (
        push(
          {
            href: key,
            label: pendingGroup.label,
            level: pendingGroup.level,
          },
          false,
        )
      ) {
        break
      }
      pendingGroup = null
    }

    const level =
      activeGroupLevel !== null
        ? activeGroupLevel + 1 + Math.max(0, depth - groupBaseDepth)
        : Math.max(0, depth > 0 ? depth - 1 : 0)

    if (
      push(
        {
          href: key,
          label,
          level,
        },
        true,
      )
    ) {
      break
    }
  }

  return entries
}

/** 从整页 HTML 中提取同站文档链接（扁平兜底，保留出现顺序） */
export function extractSameOriginDocLinks(html: string, baseUrl: string): WebDocTocEntry[] {
  const base = new URL(baseUrl)
  const seen = new Set<string>()
  const entries: WebDocTocEntry[] = []

  const anchorPattern = /<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorPattern.exec(html)) !== null) {
    const hrefRaw = match[1]?.trim()
    if (!hrefRaw || hrefRaw.startsWith('mailto:') || hrefRaw.startsWith('tel:')) continue

    const key = resolveSameOriginHref(hrefRaw, base)
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)

    const label = stripTags(match[2] ?? '')
    if (!label || label.length < 2) continue
    if (label.length > 120) continue

    entries.push({
      href: key,
      label: label.length > 80 ? `${label.slice(0, 80)}…` : label,
      level: 1,
    })

    if (entries.length >= MAX_TOC_ENTRIES) break
  }

  return entries
}

/**
 * 从「链接最密」的 ul/ol 提取目录（报纸版面、文章列表等，不绑 class/域名）。
 */
export function extractDenseListToc(html: string, baseUrl: string): WebDocTocEntry[] {
  const cleaned = stripScriptsAndStyles(html)
  const base = new URL(baseUrl)
  const listPattern = /<(ul|ol)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  let best: { score: number; inner: string } | null = null
  let match: RegExpExecArray | null

  while ((match = listPattern.exec(cleaned)) !== null) {
    const attrs = match[2] ?? ''
    const inner = match[3] ?? ''
    const anchors = [...inner.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    let sameOrigin = 0
    for (const anchor of anchors) {
      if (resolveSameOriginHref(anchor[1] ?? '', base)) sameOrigin += 1
    }
    if (sameOrigin < 2) continue

    let score = sameOrigin
    if (/\b(class|id)=["'][^"']*(news|list|toc|menu|article|catalog|contents)[^"']*["']/i.test(attrs)) {
      score += 20
    }
    if (sameOrigin > 80) score -= 15

    if (!best || score > best.score) {
      best = { score, inner }
    }
  }

  if (!best) return []

  const seen = new Set<string>()
  const entries: WebDocTocEntry[] = []
  const anchorPattern = /<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let anchorMatch: RegExpExecArray | null
  while ((anchorMatch = anchorPattern.exec(best.inner)) !== null) {
    const key = resolveSameOriginHref(anchorMatch[1] ?? '', base)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const label = stripTags(anchorMatch[2] ?? '')
    if (!label || label.length < 2 || label.length > 120) continue
    entries.push({
      href: key,
      label: label.length > 80 ? `${label.slice(0, 80)}…` : label,
      level: 0,
    })
    if (entries.length >= MAX_TOC_ENTRIES) break
  }

  return entries
}

/** mdBook keeps its chapter list in static HTML on older builds and toc.html on newer builds. */
export function extractMdBookToc(html: string, baseUrl: string): WebDocTocEntry[] {
  const root = extractBalancedElements(stripScriptsAndStyles(html), 'ol').find(block =>
    /^<ol\b[^>]*\bclass=["'][^"']*\bchapter\b[^"']*["']/i.test(block) && /\bchapter-item\b/i.test(block),
  )
  if (!root) return []
  const entries: WebDocTocEntry[] = []
  const seen = new Set<string>()
  const base = new URL(baseUrl)
  let depth = 0
  const tokens = root.match(/<ol\b[^>]*>|<\/ol\s*>|<a\b[^>]*>[\s\S]*?<\/a\s*>/gi) ?? []
  for (const token of tokens) {
    if (/^<ol\b/i.test(token)) { depth++; continue }
    if (/^<\/ol/i.test(token)) { depth = Math.max(0, depth - 1); continue }
    const rawHref = token.match(/\bhref=["']([^"']+)["']/i)?.[1]
    if (!rawHref) continue // Fold toggles are anchors without href.
    const decodedHref = decodeHtmlEntities(rawHref)
    if (!resolveSameOriginHref(decodedHref, base)) continue
    const href = new URL(decodedHref, base).toString()
    const label = extractAnchorLabel(token)
    if (!label || seen.has(href)) continue
    seen.add(href)
    entries.push({ href, label: label.slice(0, 120), level: Math.max(0, depth - 1) })
    if (entries.length >= MAX_TOC_ENTRIES) break
  }
  return entries
}

/** Only follow the mdBook sidebar's declared same-origin static TOC; never execute toc.js. */
export function resolveMdBookTocUrl(html: string, baseUrl: string): string | null {
  const clean = stripScriptsAndStyles(html)
  const sidebar = extractBalancedElements(clean, 'nav').find(block =>
    /^<nav\b[^>]*\bid=["'](?:mdbook-)?sidebar["']/i.test(block) && /mdbook-sidebar-scrollbox|sidebar-scrollbox|sidebar-iframe-outer/i.test(block),
  )
  if (!sidebar) return null
  for (const frame of sidebar.match(/<iframe\b[^>]*>/gi) ?? []) {
    const src = frame.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    if (!src) continue
    try {
      const base = new URL(baseUrl)
      const url = new URL(decodeHtmlEntities(src), base)
      if (url.origin !== base.origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || !/\/toc\.html$/i.test(url.pathname)) continue
      url.hash = ''
      return url.href
    } catch { /* Ignore malformed references and keep the ordinary discovery path. */ }
  }
  return null
}

/**
 * 通用目录：mdBook 章节树 → 结构化侧栏 → 密集列表 → 整页同站链接。
 */
export function extractGenericWebDocToc(html: string, baseUrl: string): WebDocTocEntry[] {
  const mdbook = extractMdBookToc(html, baseUrl)
  if (mdbook.length) return mdbook

  const structured = extractStructuredNavToc(html, baseUrl)
  if (structured.length >= 3) return structured

  const dense = extractDenseListToc(html, baseUrl)
  if (dense.length >= 2) return dense

  return extractSameOriginDocLinks(html, baseUrl)
}
