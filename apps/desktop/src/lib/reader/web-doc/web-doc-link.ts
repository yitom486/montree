export const MONTREE_NAV_HREF_ATTR = 'data-montree-href'
/** 临时保留卡片内部链接的原始 href，归一化后会提升到语义卡片根节点。 */
export const MONTREE_SOURCE_HREF_ATTR = 'data-montree-source-href'
export const WEB_DOC_READER_MARKER_ATTR = 'data-montree-web-doc-reader'
export const WEB_DOC_READER_MARKER_VALUE = '1'

function isNavigableHref(href: string): boolean {
  if (!href || href === '#') return false
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return false
  try {
    const protocol = new URL(href, 'https://montree.invalid').protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function toAbsoluteNavUrl(href: string, baseUrl: string): string | null {
  if (!baseUrl) return null
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}

/**
 * 将正文中的可导航链接改写为 data 属性，避免 iframe 直接跳转到原始站点。
 * 实际跳转由 WebDocViewer 统一走 fetch + 解析。
 */
export function neutralizeWebDocNavigationLinks(bodyHtml: string, baseUrl: string): string {
  if (!baseUrl.trim()) return bodyHtml

  const doc = new DOMParser().parseFromString(`<div id="montree-nav-root">${bodyHtml}</div>`, 'text/html')
  const root = doc.getElementById('montree-nav-root')
  if (!root) return bodyHtml

  // Mintlify 等站点把卡片做成 div[role="link"]，真正的 href 放在一个
  // aria-hidden/display:contents 的子 anchor 上。把原始 href 提升到卡片根节点，
  // 这样卡片的任意子元素都能走同一套应用内导航。
  root.querySelectorAll<HTMLElement>(`[${MONTREE_SOURCE_HREF_ATTR}]`).forEach((target) => {
    const raw = target.getAttribute(MONTREE_SOURCE_HREF_ATTR)?.trim() ?? ''
    target.removeAttribute(MONTREE_SOURCE_HREF_ATTR)
    target.removeAttribute('href')

    if (!raw || raw === '#' || raw.startsWith('mailto:') || raw.startsWith('tel:')) {
      target.removeAttribute(MONTREE_NAV_HREF_ATTR)
      return
    }

    const absolute = toAbsoluteNavUrl(raw, baseUrl)
    if (!absolute || !isNavigableHref(raw)) {
      target.removeAttribute(MONTREE_NAV_HREF_ATTR)
      return
    }

    target.setAttribute(MONTREE_NAV_HREF_ATTR, absolute)
    if (target.tagName !== 'A' && target.tagName !== 'AREA') {
      target.setAttribute('role', 'link')
      target.setAttribute('tabindex', '0')
    }
  })

  root.querySelectorAll<HTMLAnchorElement>('a').forEach((anchor) => {
    // 卡片内部 anchor 只是站点实现细节；导航目标已经提升到外层卡片。
    // 置空 href 可以阻止 srcdoc 原生导航，同时保留 aria-hidden 的语义。
    if (anchor.classList.contains('web-doc-card-inner-link')) {
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      anchor.removeAttribute(MONTREE_NAV_HREF_ATTR)
      anchor.setAttribute('aria-hidden', 'true')
      anchor.setAttribute('tabindex', '-1')
      return
    }

    const existing = anchor.getAttribute(MONTREE_NAV_HREF_ATTR)?.trim()
    if (existing) {
      // Keep the target in a data attribute only. A native href would still be
      // able to navigate the srcdoc frame if the delegated listener is late or
      // temporarily unavailable.
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      anchor.setAttribute('role', 'link')
      anchor.setAttribute('tabindex', '0')
      return
    }

    const raw = anchor.getAttribute('href')?.trim()
    if (!raw) {
      // 空 href 点击会导航到文档 base URL；srcdoc 下 base 就是应用自身，
      // 子 frame 又拿不到 preload 桥，会渲染出“preload 未注入”fallback。直接置惰性。
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      return
    }

    if (raw === '#') {
      // A bare hash is inert; most importantly, it must not resolve against the
      // host Electron document when this HTML is loaded through srcdoc.
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      return
    }

    // Preserve system-handled actions. The main-process web-document URL
    // validator intentionally accepts only http(s), so routing these through
    // the app would make mailto/tel links inert instead of opening externally.
    if (raw.startsWith('mailto:') || raw.startsWith('tel:')) return

    const absolute = toAbsoluteNavUrl(raw, baseUrl)
    if (!absolute || !isNavigableHref(raw)) {
      anchor.removeAttribute('href')
      return
    }

    anchor.setAttribute(MONTREE_NAV_HREF_ATTR, absolute)
    anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.setAttribute('role', 'link')
    anchor.setAttribute('tabindex', '0')
  })

  root.querySelectorAll<HTMLAreaElement>('area[href]').forEach((area) => {
    const raw = area.getAttribute('href')?.trim()
    if (!raw || !isNavigableHref(raw)) return

    const absolute = toAbsoluteNavUrl(raw, baseUrl)
    if (!absolute) {
      area.removeAttribute('href')
      return
    }

    area.setAttribute(MONTREE_NAV_HREF_ATTR, absolute)
    area.removeAttribute('href')
  })

  return root.innerHTML
}

/** 判断在线文档链接是否应在应用内导航（同站） */
export function shouldNavigateWebDocInApp(href: string, currentPageUrl: string): boolean {
  try {
    const target = new URL(href, currentPageUrl)
    const current = new URL(currentPageUrl)
    if (target.origin !== current.origin) return false
    return target.protocol === 'http:' || target.protocol === 'https:'
  } catch {
    return false
  }
}

/** 返回当前在线文档页面内的 hash 目标；跨页 hash 仍按普通网页链接处理。 */
export function resolveWebDocFragment(href: string, currentPageUrl: string): string | null {
  try {
    const target = new URL(href, currentPageUrl)
    const current = new URL(currentPageUrl)
    if (
      !target.hash ||
      target.origin !== current.origin ||
      target.pathname !== current.pathname ||
      target.search !== current.search
    ) {
      return null
    }

    const encodedId = target.hash.slice(1)
    try {
      return decodeURIComponent(encodedId)
    } catch {
      return encodedId
    }
  } catch {
    return null
  }
}

export function resolveWebDocClickHref(
  target: EventTarget | null,
  currentPageUrl: string,
): string | null {
  // The event target belongs to the iframe's DOM realm. Its Element
  // constructor is different from the parent renderer's Element constructor,
  // so instanceof Element would reject real iframe clicks.
  if (!target || typeof target !== 'object') return null
  const element = target as Partial<Element>
  if (typeof element.closest !== 'function') return null

  const area = element.closest('area')
  if (area) {
    const href = readMontreeNavHref(area)
    if (!href) return null
    try {
      return new URL(href, currentPageUrl).toString()
    } catch {
      return null
    }
  }

  const navigableTarget = element.closest(`[${MONTREE_NAV_HREF_ATTR}]`)
  if (navigableTarget) {
    const href = readMontreeNavHref(navigableTarget)
    if (!href) return null
    try {
      return new URL(href, currentPageUrl).toString()
    } catch {
      return null
    }
  }

  const anchor = element.closest('a')
  // 不限定 HTMLAnchorElement：SVG/MathML 的 <a>（SVGAElement 等）同样可点击导航，
  // 之前会被拦截逻辑漏掉而直接跳转。getAttribute 在各类 Element 上都可用。
  if (!anchor) return null

  const href = readMontreeNavHref(anchor)
  if (!href) return null

  try {
    return new URL(href, currentPageUrl).toString()
  } catch {
    return null
  }
}

/** iframe 是否已离开 srcdoc 阅读文档（跳到了原始站点） */
export function detectWebDocIframeEscape(
  iframe: HTMLIFrameElement,
  /** 宿主页面 origin（如 http://localhost:5173）；srcdoc 在 Chromium 下常报告此地址，需排除 */
  hostOrigin?: string,
): string | null {
  try {
    const document = iframe.contentDocument
    if (isWebDocReaderDocument(document)) {
      return null
    }

    const href = iframe.contentWindow?.location.href
    if (!href || href === 'about:srcdoc' || href.startsWith('about:blank')) {
      return null
    }

    // A test double or a transient load may not expose contentDocument. Keep
    // the old same-origin fallback only for that case; a real same-origin
    // document without our marker is an escaped host/app document.
    if (!document && hostOrigin) {
      try {
        if (new URL(href).origin === new URL(hostOrigin).origin) {
          return null
        }
      } catch {
        // ignore invalid URL
      }
    }

    return href
  } catch {
    return '__cross_origin__'
  }
}

/** 判断 iframe 当前文档是否为 Montree 生成的 srcdoc 阅读文档。 */
export function isWebDocReaderDocument(document: Document | null): boolean {
  return document?.documentElement?.getAttribute(WEB_DOC_READER_MARKER_ATTR) === WEB_DOC_READER_MARKER_VALUE
}

export function isCrossOriginIframeEscape(mark: string | null): mark is '__cross_origin__' {
  return mark === '__cross_origin__'
}

function readMontreeNavHref(element: Element): string | null {
  const fromData = element.getAttribute(MONTREE_NAV_HREF_ATTR)?.trim()
  if (fromData) return fromData

  const href = element.getAttribute('href')?.trim()
  if (!href || !isNavigableHref(href)) return null
  return href
}

/** 事件目标是否落在可应用内导航的链接/热区上 */
export function isWebDocNavigationTarget(
  target: EventTarget | null,
  currentPageUrl: string,
): boolean {
  return resolveWebDocClickHref(target, currentPageUrl) !== null
}
