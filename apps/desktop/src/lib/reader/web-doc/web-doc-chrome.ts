import type { WebDocSiteId } from '@montree/contracts'
import { stripDisallowedWebDocEmbeds } from '@/lib/reader/web-doc/web-doc-embeds'
import { stripHrttChrome } from '@/lib/reader/web-doc/hrtt-extract'
import { MONTREE_SOURCE_HREF_ATTR } from '@/lib/reader/web-doc/web-doc-link'

const EDIT_PAGE_LABEL =
  /编辑此页|编辑本页|在\s*github\s*上编辑|edit this page|edit this file|edit on github|improve this page/i

const DOC_CHROME_BUTTON_LABEL =
  /copy(?:\s+(?:page|link|code))?|edit(?:\s+(?:this\s+)?(?:page|file))?|open\s+menu|search|toggle\s+(?:menu|navigation)|previous|next|ask(?:\s+a\s+question)?/i

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

/**
 * 文档站底部常见噪音：打分反馈（feedback）、上下页导航（pagination）、
 * 全局页脚（footer，含 Powered by Mintlify / GitBook 等超大矢量 Logo）。
 * 保留 blockquote 内部的引用来源 footer。
 */
function stripDocsFooterAndFeedbackChrome(root: HTMLElement): void {
  // 1. 页脚与 contentinfo（保留 blockquote 内部正文引用）
  root.querySelectorAll('footer, [role="contentinfo"], #footer, .footer, [class*="doc-footer"], [class*="page-footer"]').forEach((node) => {
    if (node.closest('blockquote')) return
    node.remove()
  })

  // 2. 打分、反馈与互动搜索挂件（如 Mintlify 的 feedback-toolbar / "Was this page helpful?"）
  root.querySelectorAll(
    '.feedback-toolbar, [class*="feedback-toolbar"], [data-component-part*="feedback"], [class*="page-feedback"], [class*="feedback-prompt"], [class*="feedback-widget"], [class*="rating-widget"]',
  ).forEach((node) => {
    node.remove()
  })

  // 3. 常见文档站 Powered-by 外部平台推广引流条
  root.querySelectorAll('[class*="powered-by"], a[href*="mintlify.com/preview"], a[href="https://mintlify.com"]').forEach((node) => {
    node.remove()
  })

  // 4. 上下页翻页链接容器（已抽取为独立阅读导航，正文末尾无需重复展示站点卡片）
  root.querySelectorAll('#pagination, .pagination-nav, [class*="pagination-nav"], .prev-next, [class*="prev-next"]').forEach((node) => {
    node.remove()
  })

  // 5. 语义文本匹配兜底：若包含 "Was this page helpful" 等反馈文本且含有操作按钮
  root.querySelectorAll('div, section').forEach((element) => {
    const text = element.textContent ?? ''
    if (/was this page helpful|此页面是否有帮助|页面是否有帮助/i.test(text) && element.querySelectorAll('button, a').length >= 1) {
      element.remove()
    }
  })

  // 6. 剥离无 form 包裹的遗留搜索输入框、AI 问答框（如 Ask a question...）等表单交互控件（保留任务复选框）
  root.querySelectorAll('input:not([type="checkbox"]), textarea, select, [role="search"]').forEach((node) => {
    const searchWrapper = node.closest<HTMLElement>(
      '[class*="search"], [class*="query"], [class*="ask"], [data-component-part*="search"], [class*="assistant"], .feedback-toolbar',
    )
    if (searchWrapper && searchWrapper !== root) {
      searchWrapper.remove()
    } else {
      const parent = node.parentElement
      node.remove()
      if (parent && parent.children.length === 0 && !parent.textContent?.trim()) {
        parent.remove()
      }
    }
  })
}

const CALLOUT_SELECTOR = [
  '[data-callout-type]',
  '[data-callout]',
  '.callout',
  'div[role="note"]',
  'aside[role="note"]',
  'section[role="note"]',
  '[class*="theme-admonition"]',
  '.custom-block.info, .custom-block.tip, .custom-block.warning, .custom-block.danger, .custom-block.details, .custom-block.caution, .custom-block.note',
  '.starlight-aside',
  '[class*="markdown-alert-"]',
].join(', ')

export type WebDocCalloutType = 'info' | 'tip' | 'warning' | 'danger' | 'note'

function resolveCalloutType(element: HTMLElement): WebDocCalloutType {
  const rawType = (
    element.getAttribute('data-callout-type') ||
    element.getAttribute('data-callout') ||
    ''
  ).toLowerCase().trim()

  if (/warn|caution/.test(rawType)) return 'warning'
  if (/danger|error|critical|alert/.test(rawType)) return 'danger'
  if (/tip|success|check/.test(rawType)) return 'tip'
  if (/note|important/.test(rawType)) return 'note'
  if (/info/.test(rawType)) return 'info'

  const className = String(element.className ?? '').toLowerCase()
  if (/warning|caution/.test(className)) return 'warning'
  if (/danger|error|alert/.test(className)) return 'danger'
  if (/tip|success|check/.test(className)) return 'tip'
  if (/note|important/.test(className)) return 'note'
  return 'info'
}

/**
 * Mintlify / Docusaurus / VitePress / Starlight Callout 提示卡片：
 * 统一转化为 Montree 语义类 .web-doc-callout 及类型修饰类，
 * 保留卡片图标与正文结构，注入统一阅读器卡片排版。
 */
export function normalizeWebDocCallouts(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(CALLOUT_SELECTOR).forEach((callout) => {
    const type = resolveCalloutType(callout)
    callout.classList.add('web-doc-callout', `web-doc-callout-${type}`)

    // 寻找或标记图标容器
    let icon = callout.querySelector<Element>(
      '[data-component-part="callout-icon"], [class*="callout-icon"], [class*="admonition-icon"]',
    )
    if (!icon) {
      const firstChild = callout.firstElementChild
      if (
        firstChild instanceof Element &&
        (firstChild.tagName.toUpperCase() === 'SVG' ||
          (Boolean(firstChild.querySelector('svg')) && !firstChild.textContent?.trim()))
      ) {
        icon = firstChild
      }
    }
    if (icon) {
      icon.classList.add('web-doc-callout-icon')
      callout.classList.add('web-doc-callout-with-icon')
    }

    // 寻找或标记正文容器
    const content = callout.querySelector<Element>(
      '[data-component-part="callout-content"], [class*="callout-content"], [class*="admonition-content"]',
    )
    if (content) {
      content.classList.add('web-doc-callout-content')
    } else if (icon) {
      // 若有图标但子元素未被容器包裹，归集非图标子节点到内容容器以保证横向并列排版
      const wrapper = callout.ownerDocument.createElement('div')
      wrapper.className = 'web-doc-callout-content'
      const siblings = Array.from(callout.childNodes).filter((node) => node !== icon)
      if (siblings.length > 0) {
        for (const sib of siblings) {
          wrapper.appendChild(sib)
        }
        callout.appendChild(wrapper)
      }
    }

    // 标记标题（如有）
    const title = callout.querySelector<HTMLElement>(
      '[data-component-part="callout-title"], .custom-block-title, [class*="admonitionHeading"], [class*="markdown-alert-title"]',
    )
    if (title) {
      title.classList.add('web-doc-callout-title')
    }
  })
}

/**
 * 独立插图归一化：现代文档站（Mintlify 的 span.contents/picture.contents 链、
 * MDX 裸图）常把单图放在透明内联包装里，原站靠 `display:contents` + prose
 * 图片块样式撑成独立图块。阅读模式没有这些站点样式，图会退化成行内元素、
 * 与正文缠在一起（如 ACP 架构图的 server-client.svg）。
 * 这里把“实质独占一块”的图片链提升为 <figure class="web-doc-figure">；
 * 行内小图（表情、图标、文内配图）、已有 figure、交互容器内的图原样不动。
 */
const STANDALONE_FIGURE_WRAPPERS = new Set(['SPAN', 'PICTURE', 'A'])
/** figure 可直接落位的块容器（P 单独处理：替换而非内嵌，避免 p>figure 非法嵌套） */
const STANDALONE_FIGURE_PARENTS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'LI', 'TD', 'TH',
  'BLOCKQUOTE', 'DD', 'HEADER', 'FOOTER', 'DETAILS',
])

function nodeHasSignificantContent(node: Element, except: Element | null): boolean {
  for (const child of Array.from(node.childNodes)) {
    if (child === except) continue
    if (child.nodeType === 3) {
      if ((child.textContent ?? '').trim()) return true
    } else if (child.nodeType === 1 && (child as Element).tagName !== 'SOURCE') {
      // picture 内 <source> 无文本无盒，不计入
      return true
    }
  }
  return false
}

export function normalizeWebDocStandaloneFigures(root: HTMLElement): void {
  const doc = root.ownerDocument
  for (const img of Array.from(root.querySelectorAll('img'))) {
    if (img.closest('figure')) continue
    // 追踪像素跳过（宽高俱全且 ≤2px）
    const w = Number(img.getAttribute('width') ?? NaN)
    const h = Number(img.getAttribute('height') ?? NaN)
    if (Number.isFinite(w) && Number.isFinite(h) && w <= 2 && h <= 2) continue
    // 向上穿过透明包装（span/picture/纯图链接），要求每层除本链外无实质内容
    let top: Element = img
    let parent = img.parentElement
    while (
      parent && parent !== root &&
      STANDALONE_FIGURE_WRAPPERS.has(parent.tagName) &&
      !nodeHasSignificantContent(parent, top)
    ) {
      top = parent
      parent = parent.parentElement
    }
    const figure = doc.createElement('figure')
    figure.className = 'web-doc-figure'
    if (top !== img) {
      // 链顶在交互容器内（a/button）则不动，避免拆散链接与按钮
      if (!parent || parent === root || (parent.tagName !== 'A' && parent.tagName !== 'BUTTON')) {
        top.replaceWith(figure)
        figure.appendChild(top)
      }
      continue
    }
    // img 直挂非透明容器：仅独占且父为块容器时提升；P 则整体替换（保留 id，不断站内锚点）
    if (!parent || parent === root) {
      img.replaceWith(figure)
      figure.appendChild(img)
    } else if (parent.tagName === 'P' && !nodeHasSignificantContent(parent, img)) {
      if (parent.id) figure.id = parent.id
      parent.replaceWith(figure)
      figure.appendChild(img)
    } else if (STANDALONE_FIGURE_PARENTS.has(parent.tagName) && !nodeHasSignificantContent(parent, img)) {
      img.replaceWith(figure)
      figure.appendChild(img)
    }
    // 其余（行内文图等）保持原样
  }
}
/**
 * 现代技术文档（如 React.dev、Vite、Docusaurus）常使用 Flex/Grid 将多张对比插图并排展示。
 * 原站依赖 Tailwind 的 `flex-row` / `grid-cols-2` 等类；若不加处理在阅读模式下会退化为纵向堆叠。
 * 这里识别包含 2 个及以上 figure 的行级容器，归一化为 `.web-doc-figure-row`。
 */
export function normalizeWebDocFigureRows(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('div, section').forEach((container) => {
    const figures = Array.from(container.children).filter((child) => child.tagName === 'FIGURE')
    if (figures.length < 2) return

    const className = String(container.className || '')
    const isRowLayout =
      /(?:^|\s)(?:[a-z0-9_-]+:)?(?:flex-row|grid-cols-[2-9]|grid)(?:$|\s)/i.test(className) ||
      figures.length === container.children.length

    if (isRowLayout) {
      container.classList.add('web-doc-figure-row')
      figures.forEach((fig) => {
        fig.classList.add('web-doc-figure-item')
      })
    }
  })
}

/**
 * 识别并归一化 React.dev 等站点的 Sandpack 交互代码沙箱。
 * 将原站残缺的 SSR 占位结构重构为包含源码视图与实时执行预览的现代化 Playground。
 */
export function normalizeWebDocSandpackPlaygrounds(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.sandpack.sandpack--playground, [class*="sandpack--playground"]').forEach((container) => {
    if (container.classList.contains('web-doc-playground')) return

    const doc = container.ownerDocument
    const tab =
      container.querySelector('.sp-tab-button')?.textContent?.trim() ||
      container.querySelector('[title$=".js"], [title$=".jsx"], [title$=".tsx"], [title$=".ts"]')?.textContent?.trim() ||
      'App.js'

    const pre = container.querySelector<HTMLPreElement>('.sp-code-editor pre, .sp-cm pre, pre')
    const rawCode = pre?.textContent?.replace(/\u00a0/g, ' ').trim() || ''
    if (!rawCode) return

    const playground = doc.createElement('div')
    playground.className = 'web-doc-playground'
    playground.setAttribute('data-filename', tab)

    const header = doc.createElement('div')
    header.className = 'web-doc-playground-header'

    const tabsWrap = doc.createElement('div')
    tabsWrap.className = 'web-doc-playground-tabs'
    const tabEl = doc.createElement('span')
    tabEl.className = 'web-doc-playground-tab'
    tabEl.textContent = tab
    tabsWrap.appendChild(tabEl)

    const actions = doc.createElement('div')
    actions.className = 'web-doc-playground-actions'
    const runBtn = doc.createElement('button')
    runBtn.type = 'button'
    runBtn.className = 'web-doc-playground-btn web-doc-playground-run-btn'
    runBtn.setAttribute('title', '重新运行沙箱示例')
    runBtn.textContent = '⚡ 重新运行'
    actions.appendChild(runBtn)

    header.appendChild(tabsWrap)
    header.appendChild(actions)

    const body = doc.createElement('div')
    body.className = 'web-doc-playground-body'

    const editorPane = doc.createElement('div')
    editorPane.className = 'web-doc-playground-editor'
    const newPre = doc.createElement('pre')
    newPre.className = 'language-jsx'
    const newCode = doc.createElement('code')
    newCode.className = 'language-jsx'
    newCode.textContent = rawCode
    newPre.appendChild(newCode)
    editorPane.appendChild(newPre)

    const previewPane = doc.createElement('div')
    previewPane.className = 'web-doc-playground-preview'

    const previewHead = doc.createElement('div')
    previewHead.className = 'web-doc-playground-preview-header'
    previewHead.textContent = '实时交互预览 (Live Preview)'

    const frameWrap = doc.createElement('div')
    frameWrap.className = 'web-doc-playground-frame-wrap'

    const iframe = doc.createElement('iframe')
    iframe.className = 'web-doc-playground-iframe'
    iframe.setAttribute('title', `${tab} Preview`)
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')

    frameWrap.appendChild(iframe)
    previewPane.appendChild(previewHead)
    previewPane.appendChild(frameWrap)

    body.appendChild(editorPane)
    body.appendChild(previewPane)

    const sourceData = doc.createElement('div')
    sourceData.className = 'web-doc-playground-source'
    sourceData.style.display = 'none'
    sourceData.setAttribute('aria-hidden', 'true')
    sourceData.textContent = rawCode

    playground.appendChild(header)
    playground.appendChild(body)
    playground.appendChild(sourceData)

    container.replaceWith(playground)
  })
}

/**
 * 剥离代码块中内嵌的装饰性行号栏（Line Numbers Gutter）。
 * 现代文档站（如 Shiki / Astro / Prism / Highlight.js / Pygments）常在 SSR 代码块内部嵌入独立的行号 DOM 节点；
 * 在阅读模式或纯净排版中缺少原站定位 CSS 时，会导致行号作为普通文本被拼接到代码正文首部，严重破坏可读性、复制与导出。
 */
export function stripCodeBlockLineNumbers(root: ParentNode): void {
  const gutterSelectors = [
    '.syntax-highlighter-line-numbers',
    '.syntax-highlighter-line-number',
    '.line-numbers-rows',
    '.line-numbers-wrapper',
    '.linenodiv',
    'td.linenos',
    '.linenos',
    '.hljs-ln-numbers',
    '.blob-num',
    '.diff-line-num',
  ]

  root.querySelectorAll(gutterSelectors.join(',')).forEach((el) => {
    if (el.tagName === 'PRE' || el.tagName === 'CODE') return
    if (el.closest('pre, code, .highlight, .code-sample, table')) {
      el.remove()
    }
  })

  // 行号容器：仅清理 pre / code 内部带有 line-numbers 类的子级辅助节点（避免误伤 pre.line-numbers 自身）
  root.querySelectorAll('pre .line-numbers, code .line-numbers').forEach((el) => {
    if (el.tagName === 'PRE' || el.tagName === 'CODE') return
    const text = (el.textContent ?? '').trim()
    if (!text || /^(\d+[\s\n]*)+$/.test(text)) {
      el.remove()
    }
  })

  // 针对 pre / code 内带有 aria-hidden="true" 且文本全为纯数字/换行符的预格式内节点进行语义剥离
  root.querySelectorAll('pre [aria-hidden="true"], code [aria-hidden="true"]').forEach((el) => {
    if (el.tagName === 'PRE' || el.tagName === 'CODE') return
    const text = (el.textContent ?? '').trim()
    if (text && /^(\d+[\s\n]*)+$/.test(text)) {
      el.remove()
    }
  })

  // 解构 Pygments / MkDocs 等基于 table.highlighttable 的双栏代码块，保留纯净代码 pre
  root.querySelectorAll('table.highlighttable, table.hljs-ln').forEach((table) => {
    const codeCell = table.querySelector('td.code, td.hljs-ln-code, td:last-child')
    const pre = codeCell?.querySelector('pre')
    if (pre) {
      table.replaceWith(pre)
    }
  })
}

function stripGenericChrome(root: HTMLElement): void {
  root.querySelectorAll('form, [role="navigation"], nav').forEach((node) => node.remove())
  stripDisallowedWebDocEmbeds(root)

  stripDocsEditChrome(root)
  stripDocsFooterAndFeedbackChrome(root)
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
  normalizeWebDocCallouts(root)
  normalizeWebDocFigureRows(root)
  normalizeWebDocStandaloneFigures(root)
  normalizeWebDocSandpackPlaygrounds(root)
  stripCodeBlockLineNumbers(root)
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
