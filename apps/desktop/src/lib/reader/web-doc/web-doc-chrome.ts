import type { WebDocSiteId } from '@montree/contracts'
import { stripDisallowedWebDocEmbeds } from '@/lib/reader/web-doc/web-doc-embeds'
import { stripHrttChrome } from '@/lib/reader/web-doc/hrtt-extract'
import { MONTREE_SOURCE_HREF_ATTR } from '@/lib/reader/web-doc/web-doc-link'

const EDIT_PAGE_LABEL =
  /编辑此页|编辑本页|在\s*github\s*上编辑|edit this page|edit this file|edit on github|improve this page/i

const DOC_CHROME_BUTTON_LABEL =
  /copy(?:\s+(?:page|link|code))?|edit(?:\s+(?:this\s+)?(?:page|file))?|open\s+menu|search|toggle\s+(?:menu|navigation)|previous|next/i

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6'
const DIVIDER_SPACING_TAGS = new Set([
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'MAIN',
  'P',
  'SECTION',
])

function tailwindUtilityName(token: string): string {
  const variants = token.toLowerCase().split(':')
  return variants[variants.length - 1] ?? token.toLowerCase()
}

function hasTailwindBorderUtility(element: Element, edge: 'top' | 'bottom'): boolean {
  const edgePattern = edge === 'bottom' ? /^border-(?:b|y)(?:-|$)/ : /^border-(?:t|y)(?:-|$)/
  const zeroPattern = edge === 'bottom' ? /^border-(?:b|y)-(?:0|none)$/ : /^border-(?:t|y)-(?:0|none)$/

  return Array.from(element.classList).some((token) => {
    const utility = tailwindUtilityName(token)
    return edgePattern.test(utility) && !zeroPattern.test(utility)
  })
}

function hasInlineBorder(element: Element, edge: 'top' | 'bottom'): boolean {
  const style = element.getAttribute('style')?.toLowerCase() ?? ''
  const property = edge === 'bottom' ? '(?:border-bottom|border-block-end)' : '(?:border-top|border-block-start)'
  return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(?!0(?:px)?(?:\\s|;|$)|none(?:\\s|;|$))[^;]+`).test(style)
}

function hasTailwindDivideYUtility(element: Element): boolean {
  return Array.from(element.classList).some((token) => {
    const utility = tailwindUtilityName(token)
    return /^divide-y(?:-|$)/.test(utility) && !/^divide-y-(?:0|none)$/.test(utility)
  })
}

/**
 * 原站的 utility CSS 不会随正文进入 srcdoc。这里把 HTML 本身能表达的
 * 分组边界转换成 Montree 自己的语义类，避免依赖某个站点的 CSS 文件。
 * 只处理明确的边框语义，不猜测普通布局类，降低跨站误伤。
 */
function normalizeWebDocDividers(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[class], [style], hr').forEach((element) => {
    if (element.tagName === 'HR') {
      element.classList.add('web-doc-divider')
    }

    if (hasTailwindBorderUtility(element, 'bottom') || hasInlineBorder(element, 'bottom')) {
      element.classList.add('web-doc-divider-after')
      if (DIVIDER_SPACING_TAGS.has(element.tagName)) {
        element.classList.add('web-doc-divider-block')
      }
    }
    if (hasTailwindBorderUtility(element, 'top') || hasInlineBorder(element, 'top')) {
      element.classList.add('web-doc-divider-before')
      if (DIVIDER_SPACING_TAGS.has(element.tagName)) {
        element.classList.add('web-doc-divider-block')
      }
    }
    if (hasTailwindDivideYUtility(element)) {
      element.classList.add('web-doc-divider-group')
    }
  })
}

function isDocChromeButton(button: HTMLButtonElement): boolean {
  if (button.closest('header, nav, [role="navigation"]')) return true

  const label = [
    button.getAttribute('aria-label'),
    button.getAttribute('title'),
    button.textContent,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const className = String(button.className ?? '')

  return DOC_CHROME_BUTTON_LABEL.test(label) || /(?:^|[-_\s])(copy|edit|menu|search)(?:[-_\s]|$)/i.test(className)
}

/**
 * MDX 组件（例如 Mintlify 的 ResponseField）可能把字段名输出成 button。
 * 站点脚本不会随正文一起运行，因此保留交互元素没有意义，但不能丢掉其中的字段文本。
 * 已知页面工具按钮直接移除，其余 button 降级成普通 inline 元素。
 */
function preserveSemanticButtonText(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (isDocChromeButton(button)) {
      button.remove()
      return
    }

    const text = button.textContent?.replace(/\s+/g, ' ').trim()
    if (!text) {
      button.remove()
      return
    }

    const replacement = root.ownerDocument.createElement('span')
    replacement.className = 'web-doc-semantic-control'
    const componentPart = button.getAttribute('data-component-part')
    if (componentPart) {
      replacement.setAttribute('data-component-part', componentPart)
    }
    while (button.firstChild) {
      replacement.appendChild(button.firstChild)
    }
    button.replaceWith(replacement)
  })
}

function isHeaderPermalink(anchor: HTMLAnchorElement): boolean {
  const ariaLabel = anchor.getAttribute('aria-label')?.trim().toLowerCase() ?? ''
  return ariaLabel.startsWith('navigate to header')
}

/**
 * 保留站点的标题/字段锚点，但把它们变成阅读器自己的悬停控件。
 * Mintlify 的锚点并不只出现在 h1-h6 中，ResponseField 也会在字段名旁生成一份。
 */
function normalizeWebDocPermalinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLAnchorElement>('a[aria-label]').forEach((anchor) => {
    const ariaLabel = anchor.getAttribute('aria-label')?.toLowerCase() ?? ''
    const isLegacyHeadingAnchor = ariaLabel.includes('link for') || ariaLabel.includes('heading')

    if (isLegacyHeadingAnchor && !isHeaderPermalink(anchor)) {
      anchor.remove()
      return
    }
    if (!isHeaderPermalink(anchor)) return

    const heading = anchor.closest<HTMLElement>(HEADING_SELECTOR)
    if (heading) {
      heading.classList.add('web-doc-heading-with-anchor')
      anchor.classList.add('web-doc-heading-anchor')
      anchor.parentElement?.classList.add('web-doc-heading-anchor-wrap')
      return
    }

    const fieldHead = anchor.closest<HTMLElement>('.param-head')
    if (fieldHead) {
      fieldHead.classList.add('web-doc-param-head')
      anchor.classList.add('web-doc-field-anchor')
      anchor.parentElement?.classList.add('web-doc-field-anchor-wrap')
      anchor.parentElement?.parentElement?.classList.add('web-doc-field-row', 'web-doc-field-with-anchor')
      return
    }

    // 不能判断归属的站点锚点只会产生孤立图标，不保留到正文流中。
    anchor.remove()
  })
}

/** Mintlify Card：移除站点 CSS 仍保留语义，让阅读器重新控制卡片布局。 */
export function normalizeWebDocCards(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-component-part="card-content"]').forEach((content) => {
    const link = content.closest('a')
    if (!(link instanceof HTMLAnchorElement)) return

    // Mintlify 的实际结构是：div[role="link"] > div[card-content-container] >
    // a[aria-hidden][style="display: contents"]。旧实现把样式施加到内层 a，
    // 其 display:contents 被覆盖后就会出现大块空白和脱离卡片的箭头。
    const contentContainer = link.closest<HTMLElement>(
      '[data-component-part="card-content-container"]',
    )
    const card =
      link.closest<HTMLElement>('[role="link"], .card') ?? contentContainer?.parentElement ?? link

    card.classList.add('web-doc-card')
    card.removeAttribute('aria-hidden')
    if (card !== link) {
      const href = link.getAttribute('href')?.trim()
      if (href) card.setAttribute(MONTREE_SOURCE_HREF_ATTR, href)
      link.classList.add('web-doc-card-inner-link')
      link.setAttribute('aria-hidden', 'true')
      link.setAttribute('tabindex', '-1')
    }

    const cardContentContainer =
      card.querySelector<HTMLElement>('[data-component-part="card-content-container"]') ??
      (contentContainer?.parentElement === card ? contentContainer : null)
    if (cardContentContainer && cardContentContainer !== card) {
      card.classList.add('web-doc-card-with-container')
      cardContentContainer.classList.add('web-doc-card-content-container')
    }

    content.classList.add('web-doc-card-content')
    if (content.parentElement && content.parentElement !== link) {
      content.parentElement.classList.add('web-doc-card-content-wrap')
    }

    const icon = card.querySelector<HTMLElement>('[data-component-part="card-icon"]')
    icon?.classList.add('web-doc-card-icon')

    for (const arrow of Array.from(card.querySelectorAll<HTMLElement>('.absolute'))) {
      if (arrow.querySelector('svg')) arrow.classList.add('web-doc-card-arrow')
    }
  })
}

/** MkDocs Material / 常见 docs：「编辑此页」等站点控件，非正文插图 */
function stripDocsEditChrome(root: HTMLElement): void {
  root.querySelectorAll('a.md-content__button, .md-content__button, a.md-source').forEach((node) => {
    node.remove()
  })

  root.querySelectorAll('a[title], a[aria-label]').forEach((anchor) => {
    const label = `${anchor.getAttribute('title') ?? ''} ${anchor.getAttribute('aria-label') ?? ''}`
    if (EDIT_PAGE_LABEL.test(label)) {
      anchor.remove()
    }
  })

  // GitHub 源码/编辑链且几乎只有图标（无尺寸 SVG 会撑满阅读区）
  root.querySelectorAll('a[href*="github.com"]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? ''
    if (!/\/(edit|blob|tree)\//.test(href)) return
    const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim()
    const hasIcon = Boolean(anchor.querySelector('svg, img'))
    if (hasIcon && text.length < 12) {
      anchor.remove()
    }
  })
}

function stripGenericChrome(root: HTMLElement): void {
  root.querySelectorAll('form, [role="navigation"], nav').forEach((node) => node.remove())
  stripDisallowedWebDocEmbeds(root)

  stripDocsEditChrome(root)
  preserveSemanticButtonText(root)

  // 常见 docs 主题：面包屑工具条、标题旁「复制链接」图标（不绑域名）
  root.querySelectorAll('div').forEach((div) => {
    const className = div.className ?? ''
    if (!className.includes('justify-between') || !className.includes('items-start')) return
    const hasBreadcrumb = div.querySelector('a[href^="/"]')
    if (hasBreadcrumb && div.querySelectorAll('a').length <= 4) {
      div.remove()
    }
  })

  normalizeWebDocDividers(root)
  normalizeWebDocPermalinks(root)
  normalizeWebDocCards(root)
}

function stripPeopleDailyChrome(root: HTMLElement): void {
  root.querySelectorAll('style, map, area, img[usemap]').forEach((node) => node.remove())
  root.querySelectorAll('h2:empty, h3:empty').forEach((node) => node.remove())
}

export function stripWebDocChrome(root: HTMLElement, siteId: WebDocSiteId): void {
  stripGenericChrome(root)

  if (siteId === 'people-daily-paper') {
    stripPeopleDailyChrome(root)
  }
  if (siteId === 'hrtt-news') {
    stripHrttChrome(root)
  }
}
