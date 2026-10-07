/**
 * 阅读器视口分节（跨格式）：侧栏按 TOC flatIndex；底栏按渲染 loadKey 章节。
 * 核心原则：视口激活线处**可见标题**优先，禁止短标签模糊匹配（如「小结」≠「讨论与小结」）。
 */

export interface ViewportNavEntry {
  flatIndex: number
  label: string
  /** EPUB：spine 基路径；MOBI/AZW3：章节 id */
  loadKey: string
  fragment?: string
  /** MOBI/AZW3：resolveHref 章内 CSS 选择器 */
  selector?: string
}

export function normalizeLoadKey(key: string | null | undefined): string {
  if (!key) return ''
  return key.split('#')[0]?.toLowerCase() ?? key.toLowerCase()
}

/** iframe 中的 HTMLElement 属于 iframe 自己的 Window，不能用父窗口构造器判断。 */
export function isDocumentHtmlElement(node: Element | null): node is HTMLElement {
  if (!node) return false
  const HTMLElementConstructor = node.ownerDocument?.defaultView?.HTMLElement
  if (HTMLElementConstructor) return node instanceof HTMLElementConstructor
  return typeof HTMLElement !== 'undefined' && node instanceof HTMLElement
}

export function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 标题与 TOC 标签是否匹配。
 * - 短标签（≤3 字）仅精确匹配
 * - 禁止用「大容器 textContent 包含小节标题」冒充锚点（KF8 的 div.calibre 常见）
 */
export function isHeadingLabelMatch(label: string, headingText: string): boolean {
  const target = normalizeHeadingText(label)
  const text = normalizeHeadingText(headingText)
  if (!target || !text) return false
  if (text === target) return true
  if (target.length <= 3 || text.length <= 3) return false

  // 元素正文远长于 TOC 标签 → 多半是章节包装容器，不是小节标题本身
  const maxWrapperLen = Math.max(target.length + 24, Math.ceil(target.length * 1.6))
  if (text.length > maxWrapperLen) return false

  if (text.includes(target)) return true
  if (target.includes(text) && text.length >= 5) return true
  return false
}

/** 在候选节点中选最贴合 TOC 标签的锚点（精确 > 更短文本） */
export function pickBestHeadingMatch(
  nodes: Iterable<Element>,
  label: string,
): HTMLElement | null {
  const target = normalizeHeadingText(label)
  if (!target) return null

  let best: HTMLElement | null = null
  let bestScore = -1

  for (const node of nodes) {
    if (!isDocumentHtmlElement(node)) continue
    const text = normalizeHeadingText(node.textContent ?? '')
    if (!isHeadingLabelMatch(label, text)) continue

    // 精确匹配优先；其次文本越短越好（避免命中父级容器）
    const score = text === target ? 1_000_000 - text.length : 100_000 - text.length
    if (score > bestScore) {
      bestScore = score
      best = node
    }
  }

  return best
}

function decodeFragment(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function findFragmentElement(document: Document, fragment: string): HTMLElement | null {
  const decoded = decodeFragment(fragment)
  for (const id of [fragment, decoded]) {
    const byId = document.getElementById(id)
    if (byId) return byId
    const byQuery = document.querySelector(`#${CSS.escape(id)}`)
    if (isDocumentHtmlElement(byQuery)) return byQuery
    const byName = document.querySelector(`a[name="${id}"]`)
    if (isDocumentHtmlElement(byName)) return byName
  }
  return null
}

export function findHeadingElementByLabel(document: Document, label: string): HTMLElement | null {
  const target = normalizeHeadingText(label)
  if (!target) return null

  const fromHeading = pickBestHeadingMatch(document.querySelectorAll('h1,h2,h3,h4,h5,h6'), label)
  if (fromHeading) return fromHeading

  // KF8/AZW3 常用 calibre 段落作标题；必须选最短匹配，勿取外层 div.calibre
  return pickBestHeadingMatch(
    document.querySelectorAll('p[class*="calibre"], div[class*="calibre"]'),
    label,
  )
}

function findElementBySelector(document: Document, selector: string): HTMLElement | null {
  const trimmed = selector.trim()
  if (!trimmed) return null

  const fileposMatch = trimmed.match(/^\[id="filepos:(\d+)"\]$/)
  if (fileposMatch) {
    const fileposId = `filepos:${fileposMatch[1]}`
    const byId = document.getElementById(fileposId)
    if (byId instanceof HTMLElement) return byId
  }

  try {
    const node = document.querySelector(trimmed)
    return isDocumentHtmlElement(node) ? node : null
  } catch {
    return null
  }
}

/** 按 TOC 标签在块级元素中查找锚点（KF8/AZW3 常不用 h1–h6） */
export function findBlockElementByLabel(document: Document, label: string): HTMLElement | null {
  const fromHeading = findHeadingElementByLabel(document, label)
  if (fromHeading) return fromHeading

  return pickBestHeadingMatch(
    document.querySelectorAll('p, div, blockquote, li, span, td, th'),
    label,
  )
}

export function findViewportEntryAnchor(document: Document, entry: ViewportNavEntry): HTMLElement | null {
  if (entry.selector) {
    // KF8 的位置解析器会取目标 offset 之后遇到的第一个 id/name/aid。
    // 对不少 AZW3，这个元素其实是脚注或正文段落，并不是 TOC 标题本身。
    // 因此先使用 TOC 标签定位语义标题，仅在标题确实不存在时才信任 selector。
    const byLabel = findBlockElementByLabel(document, entry.label)
    if (byLabel) return byLabel

    const bySelector = findElementBySelector(document, entry.selector)
    if (bySelector) return bySelector
  }
  if (entry.fragment) {
    const byFragment = findFragmentElement(document, entry.fragment)
    if (byFragment) return byFragment
  }
  return findBlockElementByLabel(document, entry.label)
}

function resolveScrollRoot(document: Document): HTMLElement {
  return (document.scrollingElement ?? document.documentElement) as HTMLElement
}

/** 相对滚动根的文档坐标（沿 parentElement 累加 offsetTop，兼容嵌套 EPUB） */
export function resolveElementScrollTop(element: HTMLElement, scrollRoot: HTMLElement): number {
  let top = 0
  let node: HTMLElement | null = element

  while (node && node !== scrollRoot) {
    top += node.offsetTop
    node = node.parentElement
  }

  if (node === scrollRoot) return top

  const elementRect = element.getBoundingClientRect()
  const rootRect = scrollRoot.getBoundingClientRect()
  return elementRect.top - rootRect.top + scrollRoot.scrollTop
}

function filterEntriesForLoadKey(entries: ViewportNavEntry[], loadKey: string): ViewportNavEntry[] {
  const base = normalizeLoadKey(loadKey)
  return entries.filter((entry) => normalizeLoadKey(entry.loadKey) === base)
}

function findPrimaryVisibleHeading(
  document: Document,
  scrollTop: number,
  activationLine: number,
): HTMLElement | null {
  const scrollRoot = resolveScrollRoot(document)
  const bandTop = scrollTop - 8
  const bandBottom = scrollTop + activationLine
  let best: HTMLElement | null = null
  let bestTop = -Infinity

  for (const node of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if (!isDocumentHtmlElement(node)) continue
    const text = normalizeHeadingText(node.textContent ?? '')
    if (text.length < 2) continue

    const top = resolveElementScrollTop(node, scrollRoot)
    if (top < bandTop - 8 || top > bandBottom) continue
    if (top > bestTop) {
      bestTop = top
      best = node
    }
  }

  if (!best) {
    for (const node of document.querySelectorAll('p[class*="calibre"], div[class*="calibre"]')) {
      if (!isDocumentHtmlElement(node)) continue
      const text = normalizeHeadingText(node.textContent ?? '')
      if (text.length < 4) continue

      const top = resolveElementScrollTop(node, scrollRoot)
      if (top < bandTop - 8 || top > bandBottom) continue
      if (top > bestTop) {
        bestTop = top
        best = node
      }
    }
  }

  return best
}

function findHighestAnchorBeforeActivation(
  candidates: ViewportNavEntry[],
  document: Document,
  activationY: number,
): { flatIndex: number; top: number; hasFragment: boolean } | null {
  const scrollRoot = resolveScrollRoot(document)
  let activeIndex = -1
  let activeTop = -Infinity
  let hasFragment = false

  for (const entry of candidates) {
    const element = findViewportEntryAnchor(document, entry)
    if (!element) continue
    const top = resolveElementScrollTop(element, scrollRoot)
    if (top <= activationY && top > activeTop) {
      activeTop = top
      activeIndex = entry.flatIndex
      hasFragment = Boolean(entry.fragment)
    }
  }

  if (activeIndex < 0) return null
  return { flatIndex: activeIndex, top: activeTop, hasFragment }
}

function findNearestAnchorBelowActivation(
  candidates: ViewportNavEntry[],
  document: Document,
  activationY: number,
): { flatIndex: number; distance: number } | null {
  const scrollRoot = resolveScrollRoot(document)
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const entry of candidates) {
    const element = findViewportEntryAnchor(document, entry)
    if (!element) continue
    const top = resolveElementScrollTop(element, scrollRoot)
    if (top <= activationY) continue
    const distance = top - activationY
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = entry.flatIndex
    }
  }

  if (nearestIndex < 0) return null
  return { flatIndex: nearestIndex, distance: nearestDistance }
}

function matchEntryByVisibleHeading(
  entries: ViewportNavEntry[],
  heading: HTMLElement,
): number {
  const text = normalizeHeadingText(heading.textContent ?? '')
  let bestIndex = -1
  let bestScore = -1

  for (const entry of entries) {
    if (!isHeadingLabelMatch(entry.label, text)) continue
    const score = Math.min(entry.label.length, text.length)
    if (score > bestScore) {
      bestScore = score
      bestIndex = entry.flatIndex
    }
  }

  return bestIndex
}

/**
 * 视口 scroll-spy：与底部导航同一粒度（TOC flatIndex）。
 * 1. 激活带内可见标题（须在视口内，非已滚走的页顶 h1）
 * 2. 最高 fragment/锚点 ≤ 激活线
 * 3. 仅当已滚过父级且无带内标题时，才提升到近距子 fragment
 */
export function findFlatIndexFromViewport(
  document: Document,
  entries: ViewportNavEntry[],
  loadKey: string,
): number {
  const scoped = filterEntriesForLoadKey(entries, loadKey)
  if (scoped.length === 0) return -1

  const scrollRoot = resolveScrollRoot(document)
  const viewportHeight = scrollRoot.clientHeight || document.documentElement.clientHeight
  const activationLine = Math.min(160, viewportHeight * 0.2)
  const scrollTop = scrollRoot.scrollTop
  const activationY = scrollTop + activationLine

  const withAnchor = scoped.filter((entry) => findViewportEntryAnchor(document, entry) !== null)
  const candidates = withAnchor.length > 0 ? withAnchor : scoped

  const visibleHeading = findPrimaryVisibleHeading(document, scrollTop, activationLine)
  if (visibleHeading) {
    const fromHeading = matchEntryByVisibleHeading(scoped, visibleHeading)
    if (fromHeading >= 0) return fromHeading
  }

  const highest = findHighestAnchorBeforeActivation(candidates, document, activationY)
  const nearestBelow = findNearestAnchorBelowActivation(candidates, document, activationY)

  if (!highest) {
    return nearestBelow?.flatIndex ?? candidates[0]!.flatIndex
  }

  const activeEntry = candidates.find((entry) => entry.flatIndex === highest.flatIndex)
  if (
    activeEntry &&
    !activeEntry.fragment &&
    scrollTop > highest.top + activationLine &&
    nearestBelow &&
    nearestBelow.distance < viewportHeight * 0.45
  ) {
    return nearestBelow.flatIndex
  }

  return highest.flatIndex
}

export function scrollToViewportEntry(
  document: Document,
  entry: ViewportNavEntry,
  options?: { behavior?: ScrollBehavior; topOffset?: number },
): boolean {
  const element = findViewportEntryAnchor(document, entry)
  if (!element) return false

  const behavior = options?.behavior ?? 'smooth'
  const scrollRoot = resolveScrollRoot(document)
  const topOffset = Math.max(0, options?.topOffset ?? 0)
  const top = Math.max(0, resolveElementScrollTop(element, scrollRoot) - topOffset)

  element.scrollIntoView({ behavior, block: 'start' })
  scrollRoot.scrollTo({ top, behavior })
  return true
}
