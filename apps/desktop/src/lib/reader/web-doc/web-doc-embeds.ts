import type { EpubThemeMode } from '@yitom/reader-core'
import { READER_PALETTE } from '@yitom/reader-core'

/** 在线文档允许内嵌的第三方可视化（白名单，避免任意 iframe） */
const EMBED_HOST_SUFFIXES = ['.pythontutor.com'] as const
const EMBED_HOSTS = new Set(['pythontutor.com', 'www.pythontutor.com'])

/** 常见交互式文档嵌入；被安全策略移除时降级为“在原文中打开”占位卡。 */
const INTERACTIVE_EMBED_HOSTS = [
  'codepen.io',
  'codesandbox.io',
  'stackblitz.com',
  'jsfiddle.net',
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'observablehq.com',
  'replit.com',
] as const

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
  if (node.classList.contains('web-doc-playground-iframe')) return true
  return isAllowedWebDocEmbedUrl(node.getAttribute('src'))
}

/** 演示区只允许脚本，不给同源：页面代码在不透明源里运行，够不到阅读器与应用窗口。 */
export const WEB_DOC_PLAYGROUND_SANDBOX = 'allow-scripts'

/**
 * 收紧保留下来的 iframe：页面自带的 srcdoc 一律丢弃（srcdoc 优先于 src，且继承阅读器的源）；
 * 演示区 iframe 的类名页面也能伪造，所以不论来源都强制写死沙箱。
 */
export function hardenWebDocIframe(node: Element): void {
  node.removeAttribute('srcdoc')
  if (node.classList.contains('web-doc-playground-iframe')) {
    node.setAttribute('sandbox', WEB_DOC_PLAYGROUND_SANDBOX)
    node.removeAttribute('src')
    node.removeAttribute('allow')
  }
}

/** 移除不安全的 script/object/embed，以及非白名单 iframe */
export function stripDisallowedWebDocEmbeds(root: ParentNode): void {
  root.querySelectorAll('script, object, embed').forEach((node) => node.remove())
  root.querySelectorAll('iframe').forEach((node) => {
    if (!isAllowedWebDocEmbedIframe(node)) {
      node.remove()
      return
    }
    hardenWebDocIframe(node)
  })
}

/** 规范化允许的 embed iframe 属性（阅读器内交互） */
export function normalizeAllowedWebDocEmbeds(root: ParentNode): void {
  root.querySelectorAll('iframe').forEach((node) => {
    if (!isAllowedWebDocEmbedIframe(node)) {
      node.remove()
      return
    }
    hardenWebDocIframe(node)
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

function isInteractiveEmbedHost(hostname: string): boolean {
  return INTERACTIVE_EMBED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

function isInteractiveEmbedIframe(iframe: HTMLIFrameElement, pageUrl: string): boolean {
  if (isAllowedWebDocEmbedIframe(iframe)) return false
  if (!iframe.getAttribute('title')?.trim() && !iframe.getAttribute('aria-label')?.trim()) return false

  // MDN Live Sample：src 是 about:blank，靠站点脚本注入，只能看 data-live-*。
  if (iframe.hasAttribute('data-live-id') || iframe.classList.contains('sample-code-frame')) return true

  const src = iframe.getAttribute('src')?.trim()
  if (!src) return false
  try {
    const url = new URL(src, pageUrl)
    return isInteractiveEmbedHost(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * 被安全策略移除的交互式嵌入（MDN Live Sample、CodePen、StackBlitz、YouTube 等）
 * 不应留下空白；降级为说明卡并链接回原文，既保留信息又不执行站点脚本。
 */
export function normalizeWebDocEmbedPlaceholders(root: HTMLElement, pageUrl: string): void {
  const doc = root.ownerDocument
  root.querySelectorAll<HTMLIFrameElement>('iframe').forEach((iframe) => {
    if (!isInteractiveEmbedIframe(iframe, pageUrl)) return

    const title =
      iframe.getAttribute('title')?.trim() ||
      iframe.getAttribute('aria-label')?.trim() ||
      '交互示例'
    const placeholder = doc.createElement('section')
    placeholder.className = 'web-doc-embed-placeholder'
    placeholder.setAttribute('role', 'note')

    const heading = doc.createElement('div')
    heading.className = 'web-doc-embed-placeholder-title'
    heading.textContent = title

    const note = doc.createElement('small')
    note.className = 'web-doc-embed-placeholder-note'
    note.textContent = '该交互内容依赖站点脚本，阅读器未直接运行。'

    placeholder.append(heading, note)
    if (pageUrl) {
      try {
        const link = doc.createElement('a')
        link.className = 'web-doc-embed-placeholder-link'
        link.href = pageUrl
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = '在原文中打开'
        placeholder.appendChild(link)
      } catch {
        // 非法 base URL 时只保留说明，不生成链接
      }
    }
    iframe.replaceWith(placeholder)
  })
}

const CLIENT_RENDERED_TABLE_SELECTOR =
  'mdn-compat-table-lazy, mdn-compat-table, [data-bcd-query], [data-compat-query]'

/**
 * MDN 的 Browser compatibility 表格不是静态 HTML：页面只输出
 * `<mdn-compat-table-lazy query="...">`，真实数据由客户端脚本从 BCD 拉取后
 * 渲染进 Shadow DOM。阅读器不执行站点脚本，因此这里降级为说明卡 + 原文链接，
 * 避免标题下出现空白。query 保留在 data 属性上，后续可接 BCD 数据源。
 */
export function normalizeWebDocClientRenderedTables(root: HTMLElement, pageUrl: string): void {
  const doc = root.ownerDocument
  root.querySelectorAll<HTMLElement>(CLIENT_RENDERED_TABLE_SELECTOR).forEach((table) => {
    if (
      table.classList.contains('web-doc-embed-placeholder') ||
      table.classList.contains('web-doc-bcd') ||
      table.querySelector('.web-doc-bcd-table')
    ) {
      return
    }

    const query =
      table.getAttribute('query') ??
      table.getAttribute('data-bcd-query') ??
      table.getAttribute('data-compat-query') ??
      ''

    const placeholder = doc.createElement('section')
    placeholder.className = 'web-doc-embed-placeholder web-doc-compat-placeholder'
    placeholder.setAttribute('role', 'note')
    if (query) placeholder.setAttribute('data-bcd-query', query)

    const heading = doc.createElement('div')
    heading.className = 'web-doc-embed-placeholder-title'
    heading.textContent = '浏览器兼容性表格'

    const note = doc.createElement('small')
    note.className = 'web-doc-embed-placeholder-note'
    note.textContent = '该表格由 MDN 在浏览器端动态加载，阅读器未执行站点脚本。'

    placeholder.append(heading, note)
    try {
      const url = new URL(pageUrl)
      url.hash = 'browser_compatibility'
      const link = doc.createElement('a')
      link.className = 'web-doc-embed-placeholder-link'
      link.href = url.toString()
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = '在原文中查看完整兼容性表格'
      placeholder.appendChild(link)
    } catch {
      // 非法 URL 时保留说明卡，不生成链接
    }
    table.replaceWith(placeholder)
  })
}

export function buildWebDocEmbedCss(theme: EpubThemeMode): string {
  const palette = READER_PALETTE[theme]
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
    .web-doc-embed-placeholder {
      margin: 1em 0;
      padding: 0.85rem 1rem;
      border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
      border-radius: 0.5rem;
      background: color-mix(in oklab, currentColor 4%, transparent);
      color: inherit;
      font-size: 0.95rem;
      line-height: 1.55;
    }
    .web-doc-embed-placeholder-title {
      font-weight: 600;
      line-height: 1.45;
    }
    .web-doc-embed-placeholder-note {
      display: block;
      margin-top: 0.3rem;
      opacity: 0.72;
      font-size: 0.88em;
    }
    .web-doc-embed-placeholder-link {
      display: inline-block;
      margin-top: 0.55rem;
      color: ${palette.link};
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 0.16em;
    }
    .web-doc-embed-placeholder-link:hover {
      color: ${palette.linkHover};
    }
  `
}
