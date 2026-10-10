/** 在线文档允许内嵌的第三方可视化（白名单，避免任意 iframe） */
const EMBED_HOST_SUFFIXES = ['.pythontutor.com'] as const
const EMBED_HOSTS = new Set(['pythontutor.com', 'www.pythontutor.com'])

/** arXiv/LaTeXML 把插图放进 object；在插件清洗前降级为无脚本的图片。 */
export function normalizeWebDocImageObjects(root: HTMLElement, baseUrl: string): void {
  root.querySelectorAll('object[type]').forEach((node) => {
    const type = node.getAttribute('type')?.trim().toLowerCase()
    if (!type || !/^image\/(?:svg\+xml|png|jpeg|gif|webp|avif)$/.test(type)) return
    const data = node.getAttribute('data')?.trim()
    if (!data) return

    let url: URL
    try {
      url = new URL(data, baseUrl)
    } catch {
      return
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return

    const image = root.ownerDocument.createElement('img')
    image.src = url.toString()
    image.className = `${node.getAttribute('class') ?? ''} web-doc-object-image`.trim()
    image.alt = node.getAttribute('aria-label') || node.getAttribute('title') ||
      node.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || '文档插图'
    for (const attribute of ['id', 'width', 'height']) {
      const value = node.getAttribute(attribute)
      if (value) image.setAttribute(attribute, value)
    }
    node.replaceWith(image)
  })
}

export function isAllowedWebDocEmbedUrl(src: string | null | undefined): boolean {
  if (!src?.trim()) return false
  try {
    const url = new URL(src.trim())
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    if (EMBED_HOSTS.has(host)) return true
    return EMBED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  } catch {
    return false
  }
}

export function isAllowedWebDocEmbedIframe(node: Element): boolean {
  if (node.tagName !== 'IFRAME') return false
  return isAllowedWebDocEmbedUrl(node.getAttribute('src'))
}

/** 移除不安全的 script/object/embed，以及非白名单 iframe */
export function stripDisallowedWebDocEmbeds(root: ParentNode): void {
  root.querySelectorAll('script, object, embed').forEach((node) => node.remove())
  root.querySelectorAll('iframe').forEach((node) => {
    if (!isAllowedWebDocEmbedIframe(node)) {
      node.remove()
    }
  })
}

/** 规范化允许的 embed iframe 属性（阅读器内交互） */
export function normalizeAllowedWebDocEmbeds(root: ParentNode): void {
  root.querySelectorAll('iframe').forEach((node) => {
    if (!isAllowedWebDocEmbedIframe(node)) {
      node.remove()
      return
    }
    node.setAttribute('loading', 'lazy')
    node.setAttribute('referrerpolicy', 'no-referrer-when-downgrade')
    // Python Tutor 需要同页脚本通信较少；保持默认 sandbox 外放行（不设 sandbox）
    if (!node.getAttribute('title')) {
      node.setAttribute('title', '代码可视化')
    }
    const cls = node.getAttribute('class') ?? ''
    if (!cls.includes('web-doc-embed-iframe')) {
      node.setAttribute('class', `${cls} web-doc-embed-iframe`.trim())
    }
  })
}

export function buildWebDocEmbedCss(): string {
  return `
    details.pythontutor,
    details.web-doc-embed {
      margin: 1em 0;
      border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
      border-radius: 0.5rem;
      padding: 0.35rem 0.75rem 0.75rem;
    }
    details.pythontutor > summary,
    details.web-doc-embed > summary {
      cursor: pointer;
      font-weight: 600;
      padding: 0.4rem 0;
      list-style: none;
    }
    details.pythontutor > summary::-webkit-details-marker,
    details.web-doc-embed > summary::-webkit-details-marker {
      display: none;
    }
    .web-doc-embed-iframe,
    iframe.pythontutor-iframe {
      display: block;
      width: 100%;
      min-height: 480px;
      height: 549px;
      max-width: 100%;
      border: 0;
      border-radius: 0.375rem;
      background: transparent;
    }
  `
}
