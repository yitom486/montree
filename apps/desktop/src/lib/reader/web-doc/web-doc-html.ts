import DOMPurify from 'dompurify'
import type { WebDocPageContent, WebDocSiteId } from '@montree/contracts'
import { normalizeWebDocCards, stripWebDocChrome } from '@/lib/reader/web-doc/web-doc-chrome'
import { buildReaderLayoutCss, READER_PALETTE, type EpubThemeMode } from '@montree/reader-core'
import { DEFAULT_READER_TYPOGRAPHY, type ReaderTypography } from '@montree/reader-core'
import { buildWebDocCodeBlockCss, buildWebDocTabsRuntimeScript, enhanceWebDocCodeBlocks } from '@/lib/reader/web-doc/web-doc-code-blocks'
import {
  buildWebDocEmbedCss,
  normalizeAllowedWebDocEmbeds,
  stripDisallowedWebDocEmbeds,
} from '@/lib/reader/web-doc/web-doc-embeds'
import {
  buildWebDocKatexStylesheetLink,
  buildWebDocMathCss,
  enhanceWebDocMath,
} from '@/lib/reader/web-doc/web-doc-math'
import {
  MONTREE_SOURCE_HREF_ATTR,
  neutralizeWebDocNavigationLinks,
  WEB_DOC_READER_MARKER_ATTR,
  WEB_DOC_READER_MARKER_VALUE,
} from '@/lib/reader/web-doc/web-doc-link'
import { ensureWebDocHeadingIds } from '@/lib/reader/web-doc/web-doc-outline'
import {
  extractPeopleDailyTitle,
  pickPeopleDailyArticleRoot,
} from '@/lib/reader/web-doc/people-daily-extract'
import { pickHrttArticleRoot } from '@/lib/reader/web-doc/hrtt-extract'

const GENERIC_ARTICLE_SELECTORS = [
  'article.md-content__inner',
  '.md-content__inner.md-typeset',
  '.md-content__inner',
  'article',
  'main',
  '[role="main"]',
  '.markdown',
  '#__next main',
  '.docs-content',
  '.doc-content',
  '.md-typeset',
  '.md-content',
  '.content',
]

const SITE_ARTICLE_SELECTORS: Partial<Record<WebDocSiteId, string[]>> = {}

function buildWebDocInlineCodeCss(theme: EpubThemeMode): string {
  const palette = READER_PALETTE[theme]
  const surface = theme === 'dark' ? '#27272a' : '#f4f4f5'
  const border = theme === 'dark' ? '#3f3f46' : '#e4e4e7'

  return `
    /* MDX 的反引号最终会变成 inline <code>，不能和代码块共用透明背景规则。 */
    body code {
      display: inline !important;
      padding: 0.12em 0.35em !important;
      border: 1px solid ${border} !important;
      border-radius: 0.3em !important;
      background: ${surface} !important;
      color: ${palette.text} !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 0.9em !important;
      line-height: 1.35 !important;
      white-space: break-spaces !important;
      word-break: break-word !important;
    }
    body pre code,
    body .code-block code {
      display: inline !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      font-size: inherit !important;
      white-space: inherit !important;
    }
    /* 从 ResponseField 降级而来的字段名保留文字，但不再伪装成可交互按钮。 */
    body .web-doc-semantic-control {
      display: inline !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      color: ${palette.link} !important;
      font: inherit !important;
    }
    /* ResponseField 的字段名与类型徽章应保持同一行。 */
    body .web-doc-param-head {
      position: relative !important;
    }
    body .web-doc-param-head [data-component-part="field-name"] {
      display: inline !important;
      color: ${palette.link} !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-weight: 600 !important;
    }
    body .web-doc-param-head [data-component-part="field-meta"] {
      display: inline !important;
      margin-left: 0.35em !important;
    }
    body .web-doc-param-head [data-component-part="field-info-pill"] {
      display: inline-block !important;
      padding: 0.12em 0.5em !important;
      border: 0 !important;
      border-radius: 0.35em !important;
      background: ${surface} !important;
      color: ${palette.text} !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 0.9em !important;
      font-weight: 600 !important;
      line-height: 1.35 !important;
    }
    /* 标题与字段 permalink 默认隐藏，只在对应区域悬停/聚焦时出现。 */
    body h1, body h2, body h3, body h4, body h5, body h6,
    body .web-doc-param-head {
      position: relative !important;
    }
    body .web-doc-field-row {
      position: relative !important;
    }
    body .web-doc-heading-anchor-wrap,
    body .web-doc-field-anchor-wrap {
      position: absolute !important;
      top: 50% !important;
      left: -1.75rem !important;
      z-index: 1 !important;
      display: block !important;
      width: 1.25rem !important;
      height: 1.25rem !important;
      margin: 0 !important;
      padding: 0 !important;
      opacity: 0 !important;
      pointer-events: auto !important;
      transform: translateY(-50%) !important;
    }
    body .web-doc-heading-anchor,
    body .web-doc-field-anchor {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 100% !important;
      height: 100% !important;
      color: ${palette.link} !important;
      text-decoration: none !important;
    }
    body .web-doc-heading-anchor-wrap svg,
    body .web-doc-field-anchor-wrap svg {
      display: block !important;
      width: 1rem !important;
      height: 1rem !important;
      max-width: 1rem !important;
      max-height: 1rem !important;
    }
    body .web-doc-heading-with-anchor:hover .web-doc-heading-anchor-wrap,
    body .web-doc-heading-with-anchor:focus-within .web-doc-heading-anchor-wrap,
    body .web-doc-field-with-anchor:hover .web-doc-field-anchor-wrap,
    body .web-doc-field-with-anchor:focus-within .web-doc-field-anchor-wrap,
    body .web-doc-heading-anchor-wrap:hover,
    body .web-doc-heading-anchor-wrap:focus-within,
    body .web-doc-field-anchor-wrap:hover,
    body .web-doc-field-anchor-wrap:focus-within {
      opacity: 1 !important;
    }
    /* 通用分组边界：原站常用 Tailwind border-b/divide-y，正文抽取后由阅读器重建。 */
    body .web-doc-divider-after {
      border-bottom: 1px solid ${border} !important;
    }
    /* 块级分割线通常同时承担字段组的上下留白；避免只画线而挤压正文。 */
    body .web-doc-divider-block.web-doc-divider-after {
      margin-top: 0.625rem !important;
      margin-bottom: 0.625rem !important;
      padding-top: 0.625rem !important;
      padding-bottom: 1.25rem !important;
    }
    body .web-doc-divider-before {
      border-top: 1px solid ${border} !important;
    }
    body .web-doc-divider-block.web-doc-divider-before {
      margin-top: 0.625rem !important;
      padding-top: 0.625rem !important;
    }
    body .web-doc-divider-group > * + * {
      border-top: 1px solid ${border} !important;
    }
    body hr.web-doc-divider {
      height: 0 !important;
      margin: 1.25rem 0 !important;
      border: 0 !important;
      border-top: 1px solid ${border} !important;
    }
    /* Mintlify Card：站点的 display: contents/absolute 工具类被剥离后重新布局。 */
    body .web-doc-card {
      position: relative !important;
      display: flex !important;
      align-items: flex-start !important;
      gap: 0.75rem !important;
      width: 100% !important;
      min-width: 0 !important;
      margin: 1.25rem 0 !important;
      padding: 1rem 3rem 1rem 1rem !important;
      border: 1px solid ${border} !important;
      border-radius: 0.75rem !important;
      background: transparent !important;
      color: ${palette.text} !important;
      text-decoration: none !important;
      box-sizing: border-box !important;
    }
    /* reader-core 对 body 直属 div 有更高优先级的 position: static；卡片必须
       保留自己的定位上下文，否则内部绝对定位箭头会跑到正文左上角。 */
    /* Mintlify 的真实卡片还有一层 content-container；卡片边框/点击区域
       应在外层，内部容器只负责承载图标、正文和悬停箭头。 */
    body .web-doc-card.web-doc-card-with-container {
      display: block !important;
      padding: 0 !important;
    }
    body .web-doc-card-content-container {
      display: flex !important;
      align-items: flex-start !important;
      gap: 0.75rem !important;
      width: 100% !important;
      min-width: 0 !important;
      padding: 1rem 3rem 1rem 1rem !important;
      box-sizing: border-box !important;
    }

    body .web-doc-card-inner-link {
      display: contents !important;
      color: inherit !important;
      text-decoration: none !important;
    }

    body .web-doc-card:hover,
    body .web-doc-card:focus-visible,
    body .web-doc-card:focus-within {
      border-color: ${palette.link} !important;
    }
    body .web-doc-card-icon {
      display: flex !important;
      flex: 0 0 auto !important;
      align-items: center !important;
      justify-content: center !important;
      width: 1.5rem !important;
      height: 1.5rem !important;
    }
    body .web-doc-card-icon svg {
      width: 1.5rem !important;
      height: 1.5rem !important;
      max-width: 1.5rem !important;
      max-height: 1.5rem !important;
    }
    body .web-doc-card-content {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      margin: 0 !important;
    }
    body .web-doc-card-content-wrap {
      flex: 1 1 auto !important;
      min-width: 0 !important;
    }
    body .web-doc-card-arrow {
      position: absolute !important;
      top: 1rem !important;
      right: 1rem !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 1rem !important;
      height: 1rem !important;
      margin: 0 !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    body .web-doc-card-arrow svg {
      display: block !important;
      width: 1rem !important;
      height: 1rem !important;
      max-width: 1rem !important;
      max-height: 1rem !important;
    }
    body .web-doc-card:hover .web-doc-card-arrow,
    body .web-doc-card:focus-visible .web-doc-card-arrow,
    body .web-doc-card:focus-within .web-doc-card-arrow {
      opacity: 1 !important;
    }
  `
}

/** 选择器赢家小于此字符数、且 body 远大于此 → 视为被导航碎片截胡，进密度兜底 */
const TINY_WINNER_TEXT = 500
const DENSE_BODY_TEXT = 2000

/** 计分时直接丢弃的子树：脚本样式与站点头尾导航（正文不可能住里面） */
const NON_CONTENT_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'HEADER',
  'FOOTER',
  'NAV',
  'ASIDE',
  'FORM',
])
const NON_CONTENT_ROLES = new Set([
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'search',
])

function isNonContentElement(el: Element): boolean {
  if (NON_CONTENT_TAGS.has(el.tagName)) return true
  const role = el.getAttribute('role')?.toLowerCase()
  return role ? NON_CONTENT_ROLES.has(role) : false
}

/**
 * 密度兜底：在 body 内单遍统计每块的可见文本量与其中链接文本量，
 * 取"非链接文本最多"的 div/section/article/main。
 * body 本人不参选（它是"放弃治疗"选项，由调用方在无块可选时再退）；
 * 调用方可把原选择器赢家也送进来（不过滤长度下限，避免短正文被链接农场反超）。
 * 只解决"赢家是导航碎片"类问题；短页面不进此路径（见 pickArticleRoot）。
 */
function pickDensestContentRoot(
  body: HTMLElement,
  keepWinner?: HTMLElement | null,
): HTMLElement | null {
  const totals = new Map<Element, number>()
  const linkText = new Map<Element, number>()
  const bump = (map: Map<Element, number>, el: Element, n: number): void => {
    map.set(el, (map.get(el) ?? 0) + n)
  }

  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? ''
    if (!text.trim()) continue
    const chain: Element[] = []
    let el: Element | null = node.parentElement
    let blocked = false
    let inLink = false
    while (el) {
      if (isNonContentElement(el)) {
        blocked = true
        break
      }
      chain.push(el)
      if (el.tagName === 'A') inLink = true
      if (el === body) break
      el = el.parentElement
    }
    if (blocked) continue
    for (const ancestor of chain) {
      bump(totals, ancestor, text.length)
      if (inLink) bump(linkText, ancestor, text.length)
    }
  }

  let best: HTMLElement | null = null
  let bestScore = 0
  let bestText = 0
  const consider = (el: HTMLElement, ignoreFloor = false): void => {
    if (isNonContentElement(el)) return
    const text = totals.get(el) ?? 0
    if (!ignoreFloor && text < TINY_WINNER_TEXT) return
    const score = text - (linkText.get(el) ?? 0)
    if (score > bestScore || (score === bestScore && text > bestText)) {
      best = el
      bestScore = score
      bestText = text
    }
  }
  body.querySelectorAll('div, section, article, main').forEach((el) => {
    if (el instanceof HTMLElement) consider(el)
  })
  if (keepWinner) consider(keepWinner, true)
  return best
}

export function pickArticleRoot(
  doc: Document,
  siteId: WebDocSiteId = 'generic-ssr',
  pageUrl?: string,
): HTMLElement {
  if (siteId === 'people-daily-paper' && pageUrl) {
    return pickPeopleDailyArticleRoot(doc, pageUrl)
  }
  if (siteId === 'hrtt-news') {
    return pickHrttArticleRoot(doc)
  }

  const selectors = SITE_ARTICLE_SELECTORS[siteId] ?? GENERIC_ARTICLE_SELECTORS
  let winner: HTMLElement | null = null
  for (const selector of selectors) {
    const node = doc.querySelector(selector)
    if (node instanceof HTMLElement && node.textContent?.trim()) {
      winner = node
      break
    }
  }

  const body = doc.body
  const bodyText = body?.textContent?.trim() ?? ''
  // 仅当赢家缺失或过小（如 37 字导航碎片）且页面文本很长时进密度兜底；
  // 正常命中的大正文块原样返回，零回归面。短页面保持原行为。
  if (bodyText.length >= DENSE_BODY_TEXT && body instanceof HTMLElement) {
    const winnerTiny = !winner || (winner.textContent?.trim().length ?? 0) < TINY_WINNER_TEXT
    if (winnerTiny) {
      // 无块可选再退整 body（下游 chrome 清洗），也好过碎片
      return pickDensestContentRoot(body, winner) ?? body
    }
  }
  if (winner) return winner

  if (body instanceof HTMLElement && bodyText) {
    return body
  }

  const fallback = doc.createElement('div')
  fallback.textContent = '未能提取正文'
  return fallback
}

function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

export function extractDocumentTitle(doc: Document): string {
  const h1 = doc.querySelector('article h1, main h1, .article h1, h1')
  const h1Text = h1?.textContent?.replace(/\s+/g, ' ').trim()
  if (h1Text) return h1Text

  const title = doc.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim()
  if (title) return title

  return '未命名页面'
}
export function rewriteRelativeUrls(root: HTMLElement, baseUrl: string): void {
  const base = new URL(baseUrl)

  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href')?.trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return
    }
    try {
      anchor.setAttribute('href', new URL(href, base).toString())
    } catch {
      anchor.removeAttribute('href')
    }
  })

  root.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src')?.trim()
    if (!src) return
    try {
      img.setAttribute('src', new URL(src, base).toString())
    } catch {
      img.removeAttribute('src')
    }
  })

  root.querySelectorAll<HTMLSourceElement>('source[src]').forEach((source) => {
    const src = source.getAttribute('src')?.trim()
    if (!src) return
    try {
      source.setAttribute('src', new URL(src, base).toString())
    } catch {
      source.removeAttribute('src')
    }
  })
}

export function sanitizeWebDocBodyHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="web-doc-root">${html}</div>`, 'text/html')
  doc.querySelectorAll('form, map, area').forEach((node) => node.remove())
  stripDisallowedWebDocEmbeds(doc)
  normalizeAllowedWebDocEmbeds(doc)
  const root = doc.getElementById('web-doc-root')
  const inner = root?.innerHTML ?? html

  const cleaned = DOMPurify.sanitize(inner, {
    ADD_TAGS: [
      'img',
      'svg',
      'video',
      'audio',
      'picture',
      'source',
      'pre',
      'code',
      'h1',
      'h2',
      'h3',
      'section',
      'nav',
      'iframe',
      'details',
      'summary',
    ],
    ADD_ATTR: [
      'href',
      'class',
      'id',
      'style',
      'src',
      'alt',
      'title',
      'target',
      'rel',
      'width',
      'height',
      'loading',
      'aria-hidden',
      'role',
      'tabindex',
      'data-montree-href',
      MONTREE_SOURCE_HREF_ATTR,
      'referrerpolicy',
      'allow',
      'allowfullscreen',
      'open',
    ],
  })

  // DOMPurify 放行 iframe 标签后，再按白名单收紧
  const gated = new DOMParser().parseFromString(`<div id="web-doc-root">${cleaned}</div>`, 'text/html')
  stripDisallowedWebDocEmbeds(gated)
  normalizeAllowedWebDocEmbeds(gated)
  return gated.getElementById('web-doc-root')?.innerHTML ?? cleaned
}

export function extractWebDocArticle(
  html: string,
  pageUrl: string,
  siteId: WebDocSiteId = 'generic-ssr',
): { title: string; bodyHtml: string } {
  const doc = parseHtmlDocument(html)
  const root = pickArticleRoot(doc, siteId, pageUrl)
  const clone = root.cloneNode(true) as HTMLElement
  stripWebDocChrome(clone, siteId)
  rewriteRelativeUrls(clone, pageUrl)
  const sanitized = sanitizeWebDocBodyHtml(clone.innerHTML)
  const { bodyHtml } = ensureWebDocHeadingIds(sanitized)
  const title =
    (siteId === 'people-daily-paper' ? extractPeopleDailyTitle(doc, pageUrl) : null) ??
    extractDocumentTitle(doc)
  return {
    title,
    bodyHtml,
  }
}

export function buildWebDocReaderDocument(
  content: Pick<WebDocPageContent, 'title' | 'bodyHtml' | 'baseUrl'>,
  theme: EpubThemeMode,
  typography: ReaderTypography = DEFAULT_READER_TYPOGRAPHY,
): string {
  const layoutCss = buildReaderLayoutCss(theme, typography)
  const codeBlockCss = buildWebDocCodeBlockCss(theme)
  const inlineCodeCss = buildWebDocInlineCodeCss(theme)
  const mathCss = buildWebDocMathCss()
  const embedCss = buildWebDocEmbedCss()
  const safeTitle = DOMPurify.sanitize(content.title)
  // Query cache/HMR 可能让旧版 bodyHtml 在一次会话内继续存在；在最终生成
  // srcdoc 前再归一化一次，确保旧片段也不会把 display:contents 卡片撑坏。
  const normalizedBodyHtml = (() => {
    const doc = new DOMParser().parseFromString(
      `<div id="montree-reader-body">${content.bodyHtml}</div>`,
      'text/html',
    )
    const root = doc.getElementById('montree-reader-body')
    if (!root) return content.bodyHtml
    normalizeWebDocCards(root)
    return root.innerHTML
  })()
  const body = neutralizeWebDocNavigationLinks(
    enhanceWebDocCodeBlocks(enhanceWebDocMath(normalizedBodyHtml)),
    content.baseUrl,
  )

  return `<!DOCTYPE html>
<html lang="zh-CN" ${WEB_DOC_READER_MARKER_ATTR}="${WEB_DOC_READER_MARKER_VALUE}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  ${buildWebDocKatexStylesheetLink()}
  <style>${layoutCss}</style>
  <style>${codeBlockCss}</style>
  <style>${inlineCodeCss}</style>
  <style>${mathCss}</style>
  <style>${embedCss}</style>
  <style>
    body { margin: 0; padding: 1.25rem 1.5rem 2rem; }
    a { word-break: break-word; }
    [data-montree-href] { cursor: pointer; }
    pre { overflow-x: auto; }
    img { max-width: 100%; height: auto; }
    /* 无宽高的图标 SVG（如「编辑此页」）否则会按 viewBox 撑满版面 */
    svg { max-width: 100%; height: auto; max-height: min(70vh, 28rem); }
    .people-daily-edition-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 0.75rem;
      list-style: none;
      padding: 0;
      margin: 0 0 1.25rem;
    }
    .people-daily-edition-nav a {
      text-decoration: none;
      opacity: 0.85;
    }
    .people-daily-edition-nav a:hover {
      text-decoration: underline;
      opacity: 1;
    }
  </style>
</head>
<body><main class="web-doc-reader-content">${body}</main>${buildWebDocTabsRuntimeScript()}</body>
</html>`
}

export function buildWebDocPageContent(
  html: string,
  pageUrl: string,
  siteId: WebDocSiteId,
): WebDocPageContent {
  const article = extractWebDocArticle(html, pageUrl, siteId)
  return {
    ...article,
    baseUrl: pageUrl,
    siteId,
  }
}
