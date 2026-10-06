import { liveSelectionCss } from './reading-mark-colors'
import { DEFAULT_READER_TYPOGRAPHY, type ReaderTypography } from './reader-typography'

/** 正文左右留白（百分比）：两侧各 5%，正文占中间 90% */
export const EPUB_CONTENT_HORIZONTAL_PADDING = '5%'

const EPUB_CONTENT_VERTICAL_PADDING = '1.75rem'

const READER_LAYOUT_STYLE_ID = 'reader-layout-styles'

const EPUB_PALETTE = {
  dark: {
    pageBackground: '#26272b',
    text: '#ece9e2',
    link: '#a8a69f',
    linkHover: '#ffffff',
    h1: '#ece9e2',
    h2: '#e2dfd7',
    h3: '#d5d1c8',
  },
  light: {
    pageBackground: '#ffffff',
    text: '#1f1e1b',
    link: '#524f48',
    linkHover: '#244638',
    h1: '#1f1e1b',
    h2: '#2c2a26',
    h3: '#3d3a34',
  },
  sepia: {
    pageBackground: '#faf6ed',
    text: '#2c241b',
    link: '#5e5142',
    linkHover: '#2a4e3f',
    h1: '#2c241b',
    h2: '#3d3327',
    h3: '#4e4233',
  },
} as const

export type EpubThemeMode = keyof typeof EPUB_PALETTE

export { EPUB_PALETTE as READER_PALETTE }

/** epub.js themes 规则：覆盖书内默认蓝链与字体 */
export function getEpubThemeRules(
  mode: EpubThemeMode,
  typography: ReaderTypography = DEFAULT_READER_TYPOGRAPHY,
): Record<string, Record<string, string>> {
  const serif = '"Source Han Serif SC", "Noto Serif SC", "Songti SC", Georgia, serif'
  const sans = '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  const horizontalPadding = EPUB_CONTENT_HORIZONTAL_PADDING
  const palette = EPUB_PALETTE[mode]

  const sharedBody = {
    background: `${palette.pageBackground} !important`,
    'font-family': serif,
    'font-size': `${typography.fontSize}px`,
    'line-height': String(typography.lineHeight),
    'padding-top': `${EPUB_CONTENT_VERTICAL_PADDING} !important`,
    'padding-bottom': `${EPUB_CONTENT_VERTICAL_PADDING} !important`,
    'padding-left': '0 !important',
    'padding-right': '0 !important',
    'letter-spacing': '0.02em',
    'overflow-y': 'visible',
    'min-height': '100%',
    width: '100% !important',
    'max-width': '100% !important',
    'box-sizing': 'border-box',
    margin: '0 !important',
    color: `${palette.text} !important`,
  }

  const sharedHtml = {
    background: `${palette.pageBackground} !important`,
    'overflow-y': 'auto !important',
    'overflow-x': 'hidden !important',
    height: '100%',
    width: '100% !important',
    'scrollbar-gutter': 'stable',
    'padding-left': `${horizontalPadding} !important`,
    'padding-right': `${horizontalPadding} !important`,
    'box-sizing': 'border-box',
  }

  return {
    body: sharedBody,
    html: sharedHtml,
    p: {
      color: `${palette.text} !important`,
      'margin-bottom': '1em',
      'text-align': 'justify',
    },
    span: {
      color: `${palette.text} !important`,
    },
    div: {
      color: `${palette.text} !important`,
    },
    li: {
      color: `${palette.text} !important`,
      'margin-bottom': '0.35em',
    },
    td: {
      color: `${palette.text} !important`,
    },
    th: {
      color: `${palette.text} !important`,
    },
    blockquote: {
      color: `${palette.text} !important`,
    },
    a: {
      color: `${palette.link} !important`,
      'text-decoration': 'none !important',
      border: 'none !important',
    },
    'a:hover': {
      color: `${palette.linkHover} !important`,
    },
    h1: {
      color: `${palette.h1} !important`,
      'font-family': sans,
      'font-size': '1.6em',
      'font-weight': '600',
      'margin-bottom': '0.75em',
    },
    h2: {
      color: `${palette.h2} !important`,
      'font-family': sans,
      'font-size': '1.35em',
      'font-weight': '600',
    },
    h3: {
      color: `${palette.h3} !important`,
      'font-family': sans,
      'font-size': '1.15em',
      'font-weight': '600',
    },
    h4: {
      color: `${palette.h3} !important`,
      'font-family': sans,
      'font-weight': '600',
    },
    nav: {
      display: 'none !important',
    },
  }
}

/** 阅读区布局 CSS（EPUB iframe 与 MOBI 章节文档共用） */
export function buildReaderLayoutCss(
  mode: EpubThemeMode,
  typography: ReaderTypography = DEFAULT_READER_TYPOGRAPHY,
): string {
  const h = EPUB_CONTENT_HORIZONTAL_PADDING
  const v = EPUB_CONTENT_VERTICAL_PADDING
  const palette = EPUB_PALETTE[mode]

  return `
    ${liveSelectionCss()}
    html {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding-top: 0 !important;
      padding-bottom: 0 !important;
      padding-left: ${h} !important;
      padding-right: ${h} !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      scrollbar-gutter: stable;
      box-sizing: border-box !important;
      background-color: ${palette.pageBackground} !important;
    }
    body {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding-top: ${v} !important;
      padding-bottom: ${v} !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      box-sizing: border-box !important;
      position: relative !important;
      background-color: ${palette.pageBackground} !important;
      color: ${palette.text} !important;
      font-size: ${typography.fontSize}px !important;
      line-height: ${typography.lineHeight} !important;
    }
    body p,
    body span:not(.mobi-mark-highlight):not(.mobi-mark-note):not(.reader-mark-highlight):not(.reader-mark-note),
    body div:not(.mobi-mark-highlight):not(.mobi-mark-note):not(#reader-mark-layer):not([data-montree-flag]),
    body li,
    body td,
    body th,
    body blockquote,
    body em,
    body strong,
    body i,
    body b,
    body figcaption {
      color: ${palette.text} !important;
      background-color: transparent !important;
      font-size: inherit !important;
      line-height: inherit !important;
    }
    body h1 { color: ${palette.h1} !important; background-color: transparent !important; }
    body h2 { color: ${palette.h2} !important; background-color: transparent !important; }
    body h3, body h4, body h5, body h6 {
      color: ${palette.h3} !important;
      background-color: transparent !important;
    }
    body h1, body h2, body h3, body h4, body h5, body h6 {
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif !important;
      font-weight: 600 !important;
      line-height: 1.4 !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin-top: 1.1em !important;
      margin-bottom: 0.65em !important;
      word-break: break-word !important;
      overflow-wrap: anywhere !important;
    }
    body h1 {
      font-size: 1.6em !important;
      line-height: 1.35 !important;
    }
    body h2 {
      font-size: 1.35em !important;
      line-height: 1.38 !important;
    }
    body h3 {
      font-size: 1.15em !important;
    }
    body p[class*="calibre"],
    body div[class*="calibre"] {
      font-size: inherit !important;
      line-height: inherit !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
    }
    body a {
      color: ${palette.link} !important;
    }
    body a:hover {
      color: ${palette.linkHover} !important;
    }
    body > div:not(.mobi-mark-highlight):not(.mobi-mark-note):not(#reader-mark-layer):not([data-montree-flag]),
    body > section,
    body > article,
    body > main,
    [class*="calibre"] {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      float: none !important;
      position: static !important;
      left: auto !important;
      right: auto !important;
      inset: auto !important;
      box-sizing: border-box !important;
      background-color: transparent !important;
    }
    body * {
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    img, svg, video {
      max-width: 100% !important;
      height: auto !important;
    }
    pre, code {
      color: ${palette.text} !important;
      background-color: transparent !important;
      white-space: pre-wrap !important;
      word-break: break-word !important;
    }
    nav {
      display: none !important;
    }
  `
}

function stripPublisherInlineColors(doc: Document): void {
  if (!doc.body) return

  doc.body.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    element.style.removeProperty('color')
    const bg = element.style.backgroundColor
    if (bg && (bg === 'white' || bg === '#fff' || bg === '#ffffff' || bg === 'rgb(255, 255, 255)')) {
      element.style.removeProperty('background-color')
    }
  })
}

/** 去掉书内全宽/绝对定位等会破坏左右边距的内联布局 */
function stripPublisherLayoutOverrides(doc: Document): void {
  if (!doc.body) return

  for (const element of doc.body.querySelectorAll<HTMLElement>('[style]')) {
    if (element === doc.body || element === doc.documentElement) continue

    element.style.removeProperty('width')
    element.style.removeProperty('max-width')
    element.style.removeProperty('min-width')
    element.style.removeProperty('margin-left')
    element.style.removeProperty('margin-right')
    element.style.removeProperty('padding-left')
    element.style.removeProperty('padding-right')
    element.style.removeProperty('position')
    element.style.removeProperty('left')
    element.style.removeProperty('right')
    element.style.removeProperty('inset')
  }
}

function syncEpubReadingInlineStyles(
  doc: Document,
  mode: EpubThemeMode,
  typography: ReaderTypography,
): void {
  const html = doc.documentElement
  const body = doc.body
  if (!body) return

  const palette = EPUB_PALETTE[mode]
  const important = (el: HTMLElement, prop: string, value: string) => {
    el.style.setProperty(prop, value, 'important')
  }

  important(html, 'width', '100%')
  important(html, 'max-width', '100%')
  important(html, 'margin', '0')
  important(html, 'overflow-x', 'hidden')
  important(html, 'overflow-y', 'auto')
  important(html, 'scrollbar-gutter', 'stable')
  important(html, 'background-color', palette.pageBackground)
  important(html, 'box-sizing', 'border-box')
  important(html, 'padding-left', EPUB_CONTENT_HORIZONTAL_PADDING)
  important(html, 'padding-right', EPUB_CONTENT_HORIZONTAL_PADDING)

  important(body, 'width', '100%')
  important(body, 'max-width', '100%')
  important(body, 'margin', '0')
  important(body, 'box-sizing', 'border-box')
  important(body, 'position', 'relative')
  important(body, 'padding-top', EPUB_CONTENT_VERTICAL_PADDING)
  important(body, 'padding-bottom', EPUB_CONTENT_VERTICAL_PADDING)
  important(body, 'padding-left', '0')
  important(body, 'padding-right', '0')
  important(body, 'background-color', palette.pageBackground)
  important(body, 'color', palette.text)
  important(body, 'font-size', `${typography.fontSize}px`)
  important(body, 'line-height', String(typography.lineHeight))

  stripPublisherLayoutOverrides(doc)
  stripPublisherInlineColors(doc)
}

/** 覆盖 epub.js / 书内样式，强制左右各 5% 对称边距与主题色 */
export function applyEpubReadingLayout(
  doc: Document,
  mode: EpubThemeMode,
  typography: ReaderTypography = DEFAULT_READER_TYPOGRAPHY,
): void {
  let style = doc.getElementById(READER_LAYOUT_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = READER_LAYOUT_STYLE_ID
    doc.head.appendChild(style)
  }
  style.textContent = buildReaderLayoutCss(mode, typography)
  syncEpubReadingInlineStyles(doc, mode, typography)
}

interface EpubContentsLike {
  document?: Document
}

/** 对 rendition 内所有章节 iframe 重新应用阅读布局 */
export function applyEpubReadingLayoutToRendition(
  rendition: { getContents: () => unknown },
  mode: EpubThemeMode,
  typography: ReaderTypography = DEFAULT_READER_TYPOGRAPHY,
): void {
  const raw = rendition.getContents()
  const contentsList = (Array.isArray(raw) ? raw : raw ? [raw] : []) as EpubContentsLike[]
  for (const contents of contentsList) {
    if (contents?.document) {
      applyEpubReadingLayout(contents.document, mode, typography)
    }
  }
}
