/**
 * 从阅读器 iframe 的 document 里取可读正文。
 * 优先 `innerText`（尊重 CSS 换行与隐藏元素），退回 `textContent`。
 */
export function extractDocumentText(doc: Document | null | undefined): string {
  const body = doc?.body
  if (!body) return ''
  return body.innerText || body.textContent || ''
}

/**
 * 把未挂载的章节 HTML 转成纯文本。
 * 只能用 `textContent`：文档没有 layout，`innerText` 会返回空串。
 */
export function htmlToText(html: string): string {
  if (!html) return ''
  return new DOMParser().parseFromString(html, 'text/html').body?.textContent ?? ''
}

function resolveScrollRoot(doc: Document): HTMLElement {
  return (doc.scrollingElement ?? doc.documentElement) as HTMLElement
}

/**
 * 取当前视口内可见块的纯文本（约「一屏」），避免把整章塞给 Agent 或听书器。
 * 支持普通垂直滚动与 EPUB / MOBI 多列水平分页排版。
 * 严格按照浏览器视口物理边界 [0, 0, viewWidth, viewHeight] 过滤屏幕外的元素，
 * 并按视觉阅读顺序（多栏先列后行，滚动按行）排列。
 * 无 layout / 无可见块时退回全文（再由上层截断）。
 */
export function extractViewportText(doc: Document | null | undefined): string {
  if (!doc?.body) return ''

  const scrollRoot = resolveScrollRoot(doc)
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null)
  const viewWidth = win?.innerWidth || scrollRoot.clientWidth || 0
  const viewHeight = win?.innerHeight || scrollRoot.clientHeight || 0

  if (viewWidth <= 0 || viewHeight <= 0) {
    return extractDocumentText(doc)
  }

  const blocks = doc.body.querySelectorAll(
    'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, th, dt, dd, figcaption, section, article, div',
  )

  interface VisibleBlock {
    text: string
    top: number
    left: number
  }

  const visibleBlocks: VisibleBlock[] = []
  for (const node of blocks) {
    if (!(node instanceof HTMLElement)) continue
    // 跳过仅作容器的父级 div / section / article
    if (node.tagName === 'DIV' || node.tagName === 'SECTION' || node.tagName === 'ARTICLE') {
      const hasBlockChild = node.querySelector(
        'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, th, div, section, article',
      )
      if (hasBlockChild) continue
    }

    const rect = node.getBoundingClientRect()
    if (rect.height <= 0 || rect.width <= 0) continue

    // 1. 垂直视口边界过滤（允许 4px 边缘容差）
    // 元素底端在当前视口上方（已滚出视口），或者顶端在 viewHeight 下方（尚未进入视口），直接跳过
    if (rect.bottom < -4 || rect.top > viewHeight + 4) continue

    // 2. 水平视口边界过滤（EPUB 多列分页翻页的关键）
    // 元素右侧在当前视口左侧（翻过去的前页），或者左侧在 viewWidth 右侧（未翻到的后页），直接跳过
    if (rect.right < -4 || rect.left > viewWidth + 4) continue

    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
    if (text) {
      visibleBlocks.push({
        text,
        top: Math.max(0, rect.top),
        left: Math.max(0, rect.left),
      })
    }
  }

  if (visibleBlocks.length === 0) return extractDocumentText(doc)

  // 保证按用户视觉阅读顺序排序：水平多列分页模式优先按栏列，其次按 top；单列滚动模式按 top
  visibleBlocks.sort((a, b) => {
    // 若水平列相差较大（分栏排版，一栏通常 >= 150px），按列排；若在同一列内，按垂直 top 排
    const colDiff = Math.floor(a.left / 120) - Math.floor(b.left / 120)
    if (colDiff !== 0) return colDiff
    return a.top - b.top
  })

  return visibleBlocks.map((b) => b.text).join('\n\n')
}
