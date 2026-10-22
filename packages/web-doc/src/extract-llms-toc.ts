import type { WebDocTocEntry } from '@yitom/contracts'

const MAX_TOC_ENTRIES = 240
/** 分区 llms.txt 动辄数百篇，按标题建树时放宽上限 */
const MAX_LLMS_TOC_ENTRIES = 800

export function isVersionPathSegment(segment: string): boolean {
  return /^v\d+$/i.test(segment)
}

/** 通用路径段标题化：get-started → Get Started（无站点词表） */
export function humanizePathSegment(segment: string): string {
  if (isVersionPathSegment(segment)) return segment
  return segment
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** 将文档索引里的 `.md` 链转为可打开的 HTML 路径 */
export function normalizeLlmsDocHref(href: string, baseOrigin: string): string | null {
  try {
    const absolute = new URL(href, baseOrigin)
    if (!['http:', 'https:'].includes(absolute.protocol)) return null
    absolute.hash = ''
    absolute.search = ''
    let path = absolute.pathname
    if (path.endsWith('.md')) path = path.slice(0, -3)
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    absolute.pathname = path || '/'
    return absolute.toString()
  } catch {
    return null
  }
}

/**
 * 路径段原样用于建树（含 v1/v2）。
 * 文档站 URL 里版本目录本身就是层级（如 /protocol/v1/overview），与原站侧栏一致。
 */
export function structuralPathParts(parts: string[]): {
  groupParts: string[]
  leafPart: string | null
  version: string | null
} {
  if (parts.length === 0) {
    return { groupParts: [], leafPart: null, version: null }
  }

  const version = parts.find((part) => isVersionPathSegment(part)) ?? null
  return {
    groupParts: parts.slice(0, -1),
    leafPart: parts[parts.length - 1]!,
    version,
  }
}

/**
 * 解析 llms.txt（文档站常见索引）：`- [Title](url): desc`
 * 按 URL 路径段建树；版本号段（v1/v2）保留为中间层，对齐原站。
 */
export function extractLlmsTxtToc(text: string, baseOrigin: string): WebDocTocEntry[] {
  const headingMode = extractLlmsTxtTocByHeadings(text, baseOrigin)
  if (headingMode.length) return headingMode
  return extractLlmsTxtTocByPath(text, baseOrigin)
}

/**
 * llms.txt 自带 `##`/`###` 分组标题时（多数分区索引都有），按标题建树，
 * 与原站侧栏分组一致；首个标题之前的链接（索引自引用、仓库、主页）跳过，跨站链接跳过。
 */
function extractLlmsTxtTocByHeadings(text: string, baseOrigin: string): WebDocTocEntry[] {
  const lines = text.split(/\r?\n/)
  const headingLevels = lines
    .map((line) => /^(#{2,6})\s+\S/.exec(line)?.[1]?.length)
    .filter((n): n is number => typeof n === 'number')
  if (headingLevels.length === 0) return []
  const minLevel = Math.min(...headingLevels)
  let origin: string
  try {
    origin = new URL(baseOrigin).origin
  } catch {
    return []
  }

  const entries: WebDocTocEntry[] = []
  const seen = new Set<string>()
  let pendingGroups: { label: string; level: number }[] = []
  let currentDepth = -1
  let seenHeading = false

  for (const line of lines) {
    const heading = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      seenHeading = true
      const level = heading[1]!.length - minLevel
      pendingGroups = pendingGroups.filter((g) => g.level < level)
      pendingGroups.push({ label: heading[2]!.trim(), level })
      currentDepth = level
      continue
    }
    if (!seenHeading) continue
    const link = /^\s*-\s*\[([^\]]+)\]\(([^)\s]+)\)/.exec(line)
    if (!link) continue
    const href = normalizeLlmsDocHref(link[2]!.trim(), origin)
    if (!href || new URL(href).origin !== origin || seen.has(href)) continue
    seen.add(href)
    // 分组节点挂在首个子页上（与路径建树一致，点击分组即打开首篇）
    for (const group of pendingGroups) {
      entries.push({ href, label: group.label, level: group.level })
    }
    pendingGroups = []
    entries.push({ href, label: link[1]!.trim(), level: currentDepth + 1 })
    if (entries.length >= MAX_LLMS_TOC_ENTRIES) break
  }
  return entries.length >= 3 ? entries : []
}

function extractLlmsTxtTocByPath(text: string, baseOrigin: string): WebDocTocEntry[] {
  const entries: WebDocTocEntry[] = []
  const seenLeaves = new Set<string>()
  const emittedGroups = new Set<string>()
  const labelsUnderParent = new Map<string, Set<string>>()

  const linkPattern = /^\s*-\s*\[([^\]]+)\]\(([^)\s]+)\)/gm
  let match: RegExpExecArray | null

  while ((match = linkPattern.exec(text)) !== null) {
    const rawLabel = match[1]?.trim()
    const hrefRaw = match[2]?.trim()
    if (!rawLabel || !hrefRaw) continue

    const href = normalizeLlmsDocHref(hrefRaw, baseOrigin)
    if (!href) continue

    let pathname: string
    try {
      pathname = new URL(href).pathname
    } catch {
      continue
    }

    const parts = pathname.split('/').filter(Boolean)
    if (parts.length === 0) {
      if (seenLeaves.has(href)) continue
      seenLeaves.add(href)
      entries.push({ href, label: rawLabel, level: 0 })
      if (entries.length >= MAX_TOC_ENTRIES) break
      continue
    }

    const { groupParts } = structuralPathParts(parts)

    for (let i = 0; i < groupParts.length; i++) {
      const prefix = groupParts.slice(0, i + 1).join('/')
      const groupKey = `${i}:${prefix}`
      if (emittedGroups.has(groupKey)) continue
      emittedGroups.add(groupKey)
      entries.push({
        href,
        label: humanizePathSegment(groupParts[i]!),
        level: i,
      })
      if (entries.length >= MAX_TOC_ENTRIES) return entries
    }

    if (seenLeaves.has(href)) continue
    seenLeaves.add(href)

    const parentKey = groupParts.join('/') || '_'
    const used = labelsUnderParent.get(parentKey) ?? new Set<string>()
    let label = rawLabel
    if (used.has(rawLabel)) {
      label = `${rawLabel} (${parts[parts.length - 1]})`
    }
    used.add(rawLabel)
    used.add(label)
    labelsUnderParent.set(parentKey, used)

    entries.push({
      href,
      label,
      level: groupParts.length,
    })
    if (entries.length >= MAX_TOC_ENTRIES) break
  }

  return entries
}

function normalizeTocDocumentHref(href: string): string | null {
  try {
    const url = new URL(href)
    url.hash = ''
    url.search = ''
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1)
    }
    return url.toString()
  } catch {
    return null
  }
}

/**
 * 站点原生 llms 目录通常已经按「模块 → 分节 → 页面」建树；
 * 当前页最深节点所在的子树就是原站当前侧栏，优先级高于 HTML 导航猜测。
 */
export function extractLlmsTocSection(
  entries: WebDocTocEntry[],
  currentHref: string,
): WebDocTocEntry[] | undefined {
  const current = normalizeTocDocumentHref(currentHref)
  if (!current) return undefined

  let currentIndex = -1
  let currentLevel = -1
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!
    if (normalizeTocDocumentHref(entry.href) !== current) continue
    if (entry.level >= currentLevel) {
      currentIndex = i
      currentLevel = entry.level
    }
  }
  if (currentIndex < 0 || currentLevel <= 0) return undefined

  let parentIndex = -1
  let parentLevel = -1
  for (let i = currentIndex - 1; i >= 0; i -= 1) {
    const entry = entries[i]!
    if (entry.level < currentLevel && entry.level > parentLevel) {
      parentIndex = i
      parentLevel = entry.level
    }
  }
  if (parentIndex < 0) return undefined

  const section: WebDocTocEntry[] = []
  for (let i = parentIndex; i < entries.length; i += 1) {
    const entry = entries[i]!
    if (i > parentIndex && entry.level <= parentLevel) break
    section.push({ ...entry, level: entry.level - parentLevel })
  }
  return section.length >= 2 ? section : undefined
}

/**
 * 是否值得尝试站点级目录索引（llms.txt）。
 * 以页面是否声明 /llms.txt 为主；sidebar 仅作弱启发（许多 docs 主题通用）。
 * 不绑定具体域名。
 */
export function looksLikeDocsIndexCandidate(html: string): boolean {
  if (/\bhref=["'][^"']*llms\.txt["']/i.test(html)) return true
  if (/\/llms\.txt/i.test(html)) return true
  if (/<nav\b[^>]*\bid=["']sidebar["']/i.test(html)) return true
  if (/<nav\b[^>]*aria-label=["'][^"']*pages[^"']*["']/i.test(html)) return true
  // 页面提供自身的 Markdown 版本（`<a href="…/page.md">`、`rel=alternate type=text/markdown`）：文档站通常同时提供 llms.txt
  if (/<link\b[^>]*type=["']text\/markdown["']/i.test(html)) return true
  if (/\bhref=["'][^"'#?]+\.md["']/i.test(html)) return true
  return false
}

/** @deprecated 使用 looksLikeDocsIndexCandidate */
export function looksLikeMintlifyOrLlmsDocs(html: string): boolean {
  return looksLikeDocsIndexCandidate(html)
}

export function resolveLlmsTxtUrl(pageUrl: string, html: string): string | null {
  try {
    const base = new URL(pageUrl)
    const fromHtml = html.match(/\bhref=["']([^"']*llms\.txt)["']/i)?.[1]
    if (fromHtml) {
      return new URL(fromHtml, base).toString()
    }
    return new URL('/llms.txt', base.origin).toString()
  } catch {
    return null
  }
}

/**
 * llms.txt 候选（由近到远）：页面声明的 → 路径各级前缀下的 `llms.txt` → 根 `/llms.txt`。
 * 多产品文档站（如 /ai/latest/docs/…）的根 llms.txt 常只是产品路由表，分区索引在路径前缀下。
 */
export function resolveLlmsTxtCandidates(pageUrl: string, html: string, max = 4): string[] {
  const out: string[] = []
  const push = (u: string) => {
    if (!out.includes(u)) out.push(u)
  }
  try {
    const base = new URL(pageUrl)
    const fromHtml = html.match(/\bhref=["']([^"']*llms\.txt)["']/i)?.[1]
    if (fromHtml) push(new URL(fromHtml, base).toString())
    const parts = base.pathname.split('/').filter(Boolean)
    // 去掉末段（当前页），从最深的目录前缀往上，至多取 2 段前缀
    const dirs = parts.slice(0, -1)
    for (let i = Math.min(dirs.length, 2); i >= 1; i--) {
      push(new URL(`/${dirs.slice(0, i).join('/')}/llms.txt`, base.origin).toString())
    }
    push(new URL('/llms.txt', base.origin).toString())
  } catch {
    return out
  }
  return out.slice(0, max)
}

