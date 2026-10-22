import { buildWebDocPlaygroundRuntimeScript } from './web-doc-runtime-scripts'
import DOMPurify from 'dompurify'
import { Readability } from '@mozilla/readability'
import { renderMarkdown } from '@/lib/editor/markdown'
import type { WebDocPageContent, WebDocSiteId } from '@yitom/contracts'
import {
  normalizeWebDocBaselineIndicators,
  normalizeWebDocCallouts,
  normalizeWebDocCardGrids,
  normalizeWebDocCards,
  normalizeWebDocFigureRows,
  normalizeWebDocSandpackPlaygrounds,
  normalizeWebDocStandaloneFigures,
  backfillWebDocCardHrefs,
  extractNextFlightCardHrefs,
  stripCodeBlockLineNumbers,
  stripWebDocChrome,
} from '@/lib/reader/web-doc/web-doc-chrome'
import { buildReaderLayoutCss, READER_PALETTE, type EpubThemeMode } from '@yitom/reader-core'
import { DEFAULT_READER_TYPOGRAPHY, type ReaderTypography } from '@yitom/reader-core'
import { buildWebDocCodeBlockCss, buildWebDocTabsRuntimeScript, enhanceWebDocCodeBlocks } from '@/lib/reader/web-doc/web-doc-code-blocks'
import { buildWebDocCompatTableCss } from '@/lib/reader/web-doc/web-doc-compat'
import {
  buildWebDocEmbedCss,
  normalizeAllowedWebDocEmbeds,
  normalizeWebDocImageObjects,
  stripDisallowedWebDocEmbeds,
} from '@/lib/reader/web-doc/web-doc-embeds'
import {
  buildWebDocKatexStyles,
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
    body .web-doc-reader-content .web-doc-card.web-doc-card-with-container {
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
    /* Mintlify 用 span[data-as="p"] 表达段落（ hydration 占位），原站 prose 按块
       渲染；阅读模式默认 inline 会导致相邻两段粘成一行（如 Cursor 卡的
       描述与版本号）。注意 p 内若出现则浏览器自动断段，与原站行为一致。 */
    body .web-doc-card span[data-as="p"] {
      display: block !important;
      margin: 0.375rem 0 !important;
    }
    body .web-doc-card span[data-as="p"]:first-child {
      margin-top: 0 !important;
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

export function buildWebDocCalloutCss(theme: EpubThemeMode): string {
  const isDark = theme === 'dark'
  const isSepia = theme === 'sepia'

  const calloutThemes = {
    info: {
      border: isDark ? 'rgba(59, 130, 246, 0.35)' : 'rgba(59, 130, 246, 0.25)',
      accent: isDark ? '#60a5fa' : isSepia ? '#1d4ed8' : '#2563eb',
      bg: isDark ? 'rgba(37, 99, 235, 0.12)' : isSepia ? 'rgba(219, 234, 254, 0.5)' : '#f0f7ff',
    },
    tip: {
      border: isDark ? 'rgba(34, 197, 94, 0.35)' : 'rgba(34, 197, 94, 0.25)',
      accent: isDark ? '#4ade80' : isSepia ? '#15803d' : '#16a34a',
      bg: isDark ? 'rgba(34, 197, 94, 0.12)' : isSepia ? 'rgba(220, 252, 231, 0.5)' : '#f0fdf4',
    },
    warning: {
      border: isDark ? 'rgba(234, 179, 8, 0.35)' : 'rgba(234, 179, 8, 0.28)',
      accent: isDark ? '#facc15' : isSepia ? '#b45309' : '#ca8a04',
      bg: isDark ? 'rgba(234, 179, 8, 0.12)' : isSepia ? 'rgba(254, 243, 199, 0.5)' : '#fefce8',
    },
    danger: {
      border: isDark ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.25)',
      accent: isDark ? '#f87171' : isSepia ? '#b91c1c' : '#dc2626',
      bg: isDark ? 'rgba(239, 68, 68, 0.12)' : isSepia ? 'rgba(254, 226, 226, 0.5)' : '#fef2f2',
    },
    note: {
      border: isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(168, 85, 247, 0.25)',
      accent: isDark ? '#c084fc' : isSepia ? '#7e22ce' : '#9333ea',
      bg: isDark ? 'rgba(168, 85, 247, 0.12)' : isSepia ? 'rgba(243, 232, 255, 0.5)' : '#faf5ff',
    },
  }

  const typeRules = (Object.keys(calloutThemes) as Array<keyof typeof calloutThemes>)
    .map((type) => {
      const cfg = calloutThemes[type]
      return `
    body .web-doc-callout.web-doc-callout-${type} {
      border-color: ${cfg.border} !important;
      border-left-color: ${cfg.accent} !important;
      background-color: ${cfg.bg} !important;
    }
    body .web-doc-callout.web-doc-callout-${type} .web-doc-callout-icon {
      color: ${cfg.accent} !important;
    }
    body .web-doc-callout.web-doc-callout-${type} .web-doc-callout-title {
      color: ${cfg.accent} !important;
    }
      `
    })
    .join('\n')

  return `
    body .web-doc-callout {
      position: relative !important;
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
      box-sizing: border-box !important;
      margin: 1.25rem 0 !important;
      padding: 0.875rem 1.125rem !important;
      border-width: 1px !important;
      border-style: solid !important;
      border-left-width: 4px !important;
      border-radius: 0.5rem !important;
      font-size: 0.95em !important;
      line-height: 1.6 !important;
    }
    body .web-doc-callout.web-doc-callout-with-icon {
      flex-direction: row !important;
      align-items: flex-start !important;
      gap: 0.75rem !important;
    }
    body .web-doc-callout-icon {
      display: flex !important;
      flex: 0 0 auto !important;
      align-items: center !important;
      justify-content: center !important;
      width: 1.25rem !important;
      height: 1.25rem !important;
      margin-top: 0.18rem !important;
    }
    body .web-doc-callout-icon svg {
      display: block !important;
      width: 1.25rem !important;
      height: 1.25rem !important;
      max-width: 1.25rem !important;
      max-height: 1.25rem !important;
    }
    body .web-doc-callout-content {
      flex: 1 1 auto !important;
      min-width: 0 !important;
    }
    body .web-doc-callout-title {
      display: block !important;
      font-weight: 600 !important;
      font-size: 0.95em !important;
      margin-bottom: 0.35rem !important;
    }
    body .web-doc-callout-content p,
    body .web-doc-callout > p {
      margin: 0 !important;
    }
    body .web-doc-callout-content p + p,
    body .web-doc-callout > p + p {
      margin-top: 0.5rem !important;
    }
    ${typeRules}
  `
}

/**
 * MDN Baseline 指示器卡片（`normalizeWebDocBaselineIndicators`）：
 * 原站靠 CSS 背景图绘制图标，抽取后重建成阅读器自己的状态卡片。
 * 颜色按状态取蓝/绿/琥珀/灰/红，使用主题 palette 保持深浅色一致。
 */
export function buildWebDocBaselineCss(theme: EpubThemeMode): string {
  const isDark = theme === 'dark'
  const isSepia = theme === 'sepia'
  const palette = READER_PALETTE[theme]
  const muted = isDark ? '#a1a1aa' : isSepia ? '#6b5d4c' : '#71717a'
  const chipBg = isDark ? 'rgba(255, 255, 255, 0.04)' : isSepia ? 'rgba(120, 100, 70, 0.06)' : 'rgba(24, 24, 27, 0.04)'
  const chipBorder = isDark ? 'rgba(255, 255, 255, 0.1)' : isSepia ? 'rgba(120, 100, 70, 0.16)' : 'rgba(24, 24, 27, 0.1)'
  const extraBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : isSepia ? 'rgba(120, 100, 70, 0.14)' : 'rgba(24, 24, 27, 0.08)'
  const extraBg = isDark ? 'rgba(0, 0, 0, 0.12)' : isSepia ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.5)'
  const hoverBg = isDark ? 'rgba(255, 255, 255, 0.04)' : isSepia ? 'rgba(120, 100, 70, 0.05)' : 'rgba(24, 24, 27, 0.03)'
  const unsupportedColor = isDark ? '#f87171' : isSepia ? '#b91c1c' : '#dc2626'

  const statusThemes = {
    high: {
      accent: isDark ? '#4ade80' : isSepia ? '#15803d' : '#16a34a',
      border: isDark ? 'rgba(74, 222, 128, 0.28)' : 'rgba(22, 163, 74, 0.22)',
      bg: isDark ? 'rgba(34, 197, 94, 0.1)' : isSepia ? 'rgba(220, 252, 231, 0.55)' : '#f0fdf4',
      iconBg: isDark ? 'rgba(34, 197, 94, 0.18)' : 'rgba(34, 197, 94, 0.1)',
      pillBg: isDark ? '#166534' : '#15803d',
    },
    low: {
      accent: isDark ? '#60a5fa' : isSepia ? '#1d4ed8' : '#2563eb',
      border: isDark ? 'rgba(96, 165, 250, 0.3)' : 'rgba(37, 99, 235, 0.2)',
      bg: isDark ? 'rgba(37, 99, 235, 0.12)' : isSepia ? 'rgba(219, 234, 254, 0.55)' : '#f0f7ff',
      iconBg: isDark ? 'rgba(37, 99, 235, 0.2)' : 'rgba(37, 99, 235, 0.08)',
      pillBg: isDark ? '#1d4ed8' : '#1b6ef3',
    },
    limited: {
      accent: isDark ? '#fbbf24' : isSepia ? '#b45309' : '#d97706',
      border: isDark ? 'rgba(251, 191, 36, 0.28)' : 'rgba(217, 119, 6, 0.22)',
      bg: isDark ? 'rgba(217, 119, 6, 0.1)' : isSepia ? 'rgba(254, 243, 199, 0.55)' : '#fffbeb',
      iconBg: isDark ? 'rgba(217, 119, 6, 0.18)' : 'rgba(217, 119, 6, 0.1)',
      pillBg: isDark ? '#b45309' : '#b45309',
    },
    discouraged: {
      accent: isDark ? '#a1a1aa' : '#71717a',
      border: isDark ? 'rgba(161, 161, 170, 0.28)' : 'rgba(113, 113, 122, 0.2)',
      bg: isDark ? 'rgba(113, 113, 122, 0.1)' : isSepia ? 'rgba(231, 229, 228, 0.5)' : '#f4f4f5',
      iconBg: isDark ? 'rgba(113, 113, 122, 0.18)' : 'rgba(113, 113, 122, 0.1)',
      pillBg: isDark ? '#52525b' : '#71717a',
    },
    removing: {
      accent: isDark ? '#f87171' : isSepia ? '#b91c1c' : '#dc2626',
      border: isDark ? 'rgba(248, 113, 113, 0.3)' : 'rgba(220, 38, 38, 0.22)',
      bg: isDark ? 'rgba(220, 38, 38, 0.1)' : isSepia ? 'rgba(254, 226, 226, 0.55)' : '#fef2f2',
      iconBg: isDark ? 'rgba(220, 38, 38, 0.18)' : 'rgba(220, 38, 38, 0.1)',
      pillBg: isDark ? '#b91c1c' : '#b91c1c',
    },
  }

  const statusRules = Object.entries(statusThemes)
    .map(([status, cfg]) => `
    body .web-doc-baseline.web-doc-baseline-${status} {
      --web-doc-baseline-accent: ${cfg.accent};
      --web-doc-baseline-border: ${cfg.border};
      --web-doc-baseline-bg: ${cfg.bg};
      --web-doc-baseline-icon-bg: ${cfg.iconBg};
      --web-doc-baseline-pill-bg: ${cfg.pillBg};
    }
    `)
    .join('\n')

  return `
    body .web-doc-baseline {
      position: relative !important;
      display: block !important;
      box-sizing: border-box !important;
      margin: 0.75rem 0 1.25rem !important;
      overflow: hidden !important;
      border: 1px solid var(--web-doc-baseline-border, ${chipBorder}) !important;
      border-radius: 0.75rem !important;
      background: var(--web-doc-baseline-bg, ${chipBg}) !important;
      color: ${palette.text} !important;
      font-family: inherit !important;
      font-size: 0.9rem !important;
      line-height: 1.6 !important;
    }
    body .web-doc-baseline > summary {
      position: relative !important;
      display: flex !important;
      align-items: center !important;
      flex-wrap: wrap !important;
      gap: 0.5rem 0.65rem !important;
      min-height: 3rem !important;
      padding: 0.8rem 2.75rem 0.8rem 1rem !important;
      list-style: none !important;
      cursor: pointer !important;
      user-select: none !important;
      font-size: 0.95rem !important;
      line-height: 1.45 !important;
    }
    body .web-doc-baseline > summary::-webkit-details-marker {
      display: none !important;
    }
    body .web-doc-baseline > summary::marker {
      content: "" !important;
    }
    body .web-doc-baseline > summary:hover {
      background: ${hoverBg} !important;
    }
    body .web-doc-baseline > summary:focus-visible {
      outline: 2px solid var(--web-doc-baseline-accent, ${muted}) !important;
      outline-offset: -2px !important;
    }
    body .web-doc-baseline-icon {
      display: inline-flex !important;
      flex: 0 0 auto !important;
      align-items: center !important;
      justify-content: center !important;
      width: 1.75rem !important;
      height: 1.75rem !important;
      border-radius: 999px !important;
      background: var(--web-doc-baseline-icon-bg, ${chipBg}) !important;
      color: var(--web-doc-baseline-accent, ${muted}) !important;
      font-size: 0.95rem !important;
      font-weight: 700 !important;
      line-height: 1 !important;
    }
    body .web-doc-baseline-title {
      margin: 0 !important;
      color: ${palette.text} !important;
      font-weight: 600 !important;
    }
    body .web-doc-baseline-pill {
      display: inline-flex !important;
      align-items: center !important;
      padding: 0.14rem 0.45rem !important;
      border-radius: 999px !important;
      background: var(--web-doc-baseline-pill-bg, ${muted}) !important;
      color: #ffffff !important;
      font-size: 0.64rem !important;
      font-weight: 700 !important;
      letter-spacing: 0.045em !important;
      line-height: 1.4 !important;
      text-transform: uppercase !important;
      white-space: nowrap !important;
    }
    body .web-doc-baseline-browsers {
      display: flex !important;
      flex-wrap: wrap !important;
      align-items: center !important;
      gap: 0.35rem !important;
      margin-left: auto !important;
    }
    body .web-doc-baseline-browser {
      display: inline-flex !important;
      align-items: center !important;
      gap: 0.28rem !important;
      padding: 0.18rem 0.48rem !important;
      border: 1px solid ${chipBorder} !important;
      border-radius: 999px !important;
      background: ${chipBg} !important;
      color: ${muted} !important;
      font-size: 0.72rem !important;
      line-height: 1.35 !important;
      white-space: nowrap !important;
    }
    body .web-doc-baseline-browser-name {
      font-weight: 500 !important;
    }
    body .web-doc-baseline-browser-state {
      color: var(--web-doc-baseline-accent, ${muted}) !important;
      font-size: 0.78rem !important;
      font-weight: 700 !important;
      line-height: 1 !important;
    }
    body .web-doc-baseline-browser-unsupported {
      opacity: 0.72 !important;
    }
    body .web-doc-baseline-browser-unsupported .web-doc-baseline-browser-state {
      color: ${unsupportedColor} !important;
    }
    body .web-doc-baseline-chevron {
      position: absolute !important;
      top: 50% !important;
      right: 1rem !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 1rem !important;
      height: 1rem !important;
      color: ${muted} !important;
      pointer-events: none !important;
      transform: translateY(-50%) !important;
    }
    body .web-doc-baseline-chevron::before {
      content: "" !important;
      display: block !important;
      width: 0.42rem !important;
      height: 0.42rem !important;
      border-right: 2px solid currentColor !important;
      border-bottom: 2px solid currentColor !important;
      transform: rotate(45deg) !important;
      transition: transform 0.18s ease !important;
    }
    body .web-doc-baseline[open] .web-doc-baseline-chevron::before {
      transform: rotate(225deg) !important;
    }
    body .web-doc-baseline-extra {
      padding: 0.8rem 1rem 0.95rem !important;
      border-top: 1px solid ${extraBorder} !important;
      background: ${extraBg} !important;
      color: ${muted} !important;
      font-size: 0.9rem !important;
      line-height: 1.6 !important;
    }
    body .web-doc-baseline-extra p {
      margin: 0 !important;
    }
    body .web-doc-baseline-extra > p + p {
      margin-top: 0.5rem !important;
    }
    body .web-doc-baseline-extra ul {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 0.5rem 1.1rem !important;
      margin: 0.7rem 0 0 !important;
      padding: 0 !important;
      list-style: none !important;
    }
    body .web-doc-baseline-extra li {
      margin: 0 !important;
    }
    body .web-doc-baseline-extra a {
      color: ${palette.link} !important;
      font-weight: 500 !important;
      text-decoration: none !important;
      border-bottom: 1px solid transparent !important;
    }
    body .web-doc-baseline-extra a:hover {
      color: ${palette.linkHover} !important;
      border-bottom-color: currentColor !important;
    }
    @media (max-width: 560px) {
      body .web-doc-baseline-browsers {
        margin-left: 0 !important;
      }
    }
    ${statusRules}
  `
}

/** 文档底部元信息卡（`normalizeWebDocArticleFooters`）：更新时间、贡献与原文反馈入口。 */
export function buildWebDocDocMetaCss(theme: EpubThemeMode): string {
  const isDark = theme === 'dark'
  const isSepia = theme === 'sepia'
  const palette = READER_PALETTE[theme]
  const muted = isDark ? '#a1a1aa' : isSepia ? '#6b5d4c' : '#71717a'
  const border = isDark ? 'rgba(255, 255, 255, 0.1)' : isSepia ? 'rgba(120, 100, 70, 0.16)' : 'rgba(24, 24, 27, 0.1)'
  const surface = isDark ? 'rgba(255, 255, 255, 0.03)' : isSepia ? 'rgba(255, 255, 255, 0.3)' : '#f8fafc'
  const hover = isDark ? 'rgba(255, 255, 255, 0.05)' : isSepia ? 'rgba(120, 100, 70, 0.06)' : 'rgba(24, 24, 27, 0.04)'

  return `
    body .web-doc-doc-meta {
      margin: 1.5rem 0 0.5rem !important;
      padding: 1rem 1.1rem !important;
      border: 1px solid ${border} !important;
      border-radius: 0.75rem !important;
      background: ${surface} !important;
      color: ${palette.text} !important;
      font-size: 0.9rem !important;
      line-height: 1.55 !important;
    }
    body .web-doc-doc-meta-header {
      display: flex !important;
      align-items: flex-start !important;
      justify-content: space-between !important;
      flex-wrap: wrap !important;
      gap: 0.6rem 1rem !important;
    }
    body .web-doc-doc-meta-title {
      color: ${palette.text} !important;
      font-size: 1rem !important;
      font-weight: 600 !important;
      line-height: 1.4 !important;
    }
    body .web-doc-doc-meta-feedback {
      display: inline-flex !important;
      flex: 0 0 auto !important;
      align-items: center !important;
      padding: 0.3rem 0.7rem !important;
      border: 1px solid ${border} !important;
      border-radius: 999px !important;
      color: ${palette.link} !important;
      font-size: 0.78rem !important;
      font-weight: 500 !important;
      line-height: 1.4 !important;
      text-decoration: none !important;
    }
    body .web-doc-doc-meta-feedback:hover {
      background: ${hover} !important;
      border-color: ${palette.link} !important;
      color: ${palette.linkHover} !important;
    }
    body .web-doc-doc-meta-modified {
      margin: 0.7rem 0 0 !important;
      color: ${muted} !important;
      font-size: 0.8rem !important;
      line-height: 1.5 !important;
    }
    body .web-doc-doc-meta-modified a {
      color: ${palette.link} !important;
    }
    body .web-doc-doc-meta-links {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 0.45rem 0.95rem !important;
      margin-top: 0.75rem !important;
      padding-top: 0.75rem !important;
      border-top: 1px solid ${border} !important;
    }
    body .web-doc-doc-meta-links a {
      color: ${palette.link} !important;
      font-size: 0.82rem !important;
      font-weight: 500 !important;
      line-height: 1.4 !important;
      text-decoration: none !important;
      border-bottom: 1px solid transparent !important;
    }
    body .web-doc-doc-meta-links a:hover {
      color: ${palette.linkHover} !important;
      border-bottom-color: currentColor !important;
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
  const isHijacked = winner && (winner.textContent?.trim().length ?? 0) < TINY_WINNER_TEXT && bodyText.length >= DENSE_BODY_TEXT
  const noSelectorMatch = !winner && body instanceof HTMLElement && bodyText.length >= 50

  if (isHijacked || noSelectorMatch) {
    // 优先调用工业级 Mozilla Readability 算法自适应抽取正文
    try {
      const cloneDoc = doc.cloneNode(true) as Document
      if (pageUrl && cloneDoc.head) {
        const baseEl = cloneDoc.createElement('base')
        baseEl.href = pageUrl
        cloneDoc.head.appendChild(baseEl)
      }
      // Readability 会按 class 权重删掉 h1/h2（`scroll-my-20` 之类的工具类命中其 /scroll/ 负权重），
      // 导致正文大纲只剩 h3。标题本身就是正文结构，这里先去掉标题的 class 再交给它。
      cloneDoc.querySelectorAll('h1[class],h2[class],h3[class]').forEach((h) => h.removeAttribute('class'))
      const reader = new Readability(cloneDoc)
      const parsed = reader.parse()
      if (parsed?.content) {
        const tempDiv = doc.createElement('div')
        tempDiv.innerHTML = parsed.content
        if (tempDiv.firstElementChild instanceof HTMLElement && (tempDiv.textContent?.trim().length ?? 0) >= 50) {
          return tempDiv.firstElementChild
        }
      }
    } catch {
      // Readability 容错降级
    }

    if (bodyText.length >= DENSE_BODY_TEXT && body instanceof HTMLElement) {
      // 无块可选再退密度兜底
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
function rewriteSrcset(srcset: string, base: URL): string {
  return srcset
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim()
      if (!trimmed) return ''
      const parts = trimmed.split(/\s+/)
      const rawUrl = parts[0]
      if (!rawUrl) return trimmed
      try {
        parts[0] = new URL(rawUrl, base).toString()
        return parts.join(' ')
      } catch {
        return trimmed
      }
    })
    .filter(Boolean)
    .join(', ')
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

  root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const src = img.getAttribute('src')?.trim()
    if (src) {
      try {
        img.setAttribute('src', new URL(src, base).toString())
      } catch {
        img.removeAttribute('src')
      }
    }

    const srcset = img.getAttribute('srcset')
    if (srcset?.trim()) {
      img.setAttribute('srcset', rewriteSrcset(srcset, base))
    }
  })

  root.querySelectorAll<HTMLSourceElement>('source').forEach((source) => {
    const src = source.getAttribute('src')?.trim()
    if (src) {
      try {
        source.setAttribute('src', new URL(src, base).toString())
      } catch {
        source.removeAttribute('src')
      }
    }

    const srcset = source.getAttribute('srcset')
    if (srcset?.trim()) {
      source.setAttribute('srcset', rewriteSrcset(srcset, base))
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
      'srcset',
      'sizes',
      'alt',
      'title',
      'target',
      'rel',
      'width',
      'height',
      'loading',
      'decoding',
      'aria-hidden',
      'role',
      'tabindex',
      'data-montree-href',
      MONTREE_SOURCE_HREF_ATTR,
      'referrerpolicy',
      'allow',
      'allowfullscreen',
      'open',
      'srcdoc',
      'data-filename',
      'sandbox',
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
  normalizeWebDocImageObjects(clone, pageUrl)
  stripWebDocChrome(clone, siteId, pageUrl)
  // flight 回填必须在消毒（扔 script）之前从原始 HTML 提取，在归一化之后落到卡上
  backfillWebDocCardHrefs(clone, extractNextFlightCardHrefs(html))
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

/**
 * 卡片网格排版（配 `normalizeWebDocCardGrids`）：还原文档站的链接卡片矩阵
 * （Mintlify Card、Docusaurus 特性块）。列数不读站点的自定义属性，
 * 用 auto-fill 自适应列（窄栏自动单列）；卡面取中性面色，与主题 palette 对齐。
 */
export function buildWebDocCardGridCss(theme: EpubThemeMode): string {
  const palette = READER_PALETTE[theme]
  const isDark = theme === 'dark'
  const surface = isDark ? '#27272a' : '#f4f4f5'
  const border = isDark ? '#3f3f46' : '#e4e4e7'

  return `
    /* 卡片矩阵（通用模式归一化产出，见 normalizeWebDocCardGrids） */
    body .web-doc-reader-content .web-doc-card-grid {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)) !important;
      gap: 1rem !important;
      margin: 1.25em 0 !important;
    }
    body .web-doc-reader-content .web-doc-card {
      display: flex !important;
      flex-direction: column !important;
      border: 1px solid ${border} !important;
      border-radius: 0.75rem !important;
      background: ${surface} !important;
      padding: 1rem 1.25rem !important;
      color: ${palette.text} !important;
      text-decoration: none !important;
    }
    body .web-doc-reader-content a.web-doc-card:hover {
      border-color: ${palette.link} !important;
    }
    body .web-doc-reader-content .web-doc-card h1,
    body .web-doc-reader-content .web-doc-card h2,
    body .web-doc-reader-content .web-doc-card h3,
    body .web-doc-reader-content .web-doc-card h4,
    body .web-doc-reader-content .web-doc-card h5,
    body .web-doc-reader-content .web-doc-card h6 {
      margin-top: 0 !important;
      margin-bottom: 0.375rem !important;
      font-size: 1.05em !important;
    }
    body .web-doc-reader-content .web-doc-card p {
      margin-block: 0.375rem !important;
    }
    body .web-doc-reader-content .web-doc-card img {
      display: block !important;
      margin-inline: auto !important;
      max-width: 100% !important;
      height: auto !important;
    }
  `
}

export function buildWebDocStaticTabsCss(theme: EpubThemeMode): string {
  const palette = READER_PALETTE[theme]
  const isDark = theme === 'dark'
  const surface = isDark ? '#27272a' : '#f4f4f5'
  const border = isDark ? '#3f3f46' : '#e4e4e7'

  return `
    /* 站点 Tabs 在静态阅读中的只读降级（见 normalizeWebDocStaticTabs） */
    body .web-doc-static-tabs {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 0.4rem 0.5rem !important;
      margin: 0.9rem 0 !important;
    }
    body .web-doc-static-tab {
      display: inline-flex !important;
      align-items: center !important;
      max-width: 100% !important;
      padding: 0.2rem 0.65rem !important;
      border: 1px solid ${border} !important;
      border-radius: 999px !important;
      background: ${surface} !important;
      color: ${palette.text} !important;
      font-size: 0.82em !important;
      line-height: 1.5 !important;
      overflow-wrap: anywhere !important;
    }
    body .web-doc-semantic-control + .web-doc-semantic-control {
      margin-left: 0.4rem !important;
    }
  `
}

export function buildWebDocPlaygroundCss(theme: EpubThemeMode): string {
  const palette = READER_PALETTE[theme]
  const isDark = theme === 'dark'
  const border = isDark ? '#3f3f46' : '#e4e4e7'
  const surface = isDark ? '#27272a' : '#f4f4f5'
  const headerBg = isDark ? '#1f1f23' : '#f9fafb'
  const previewBg = isDark ? '#18181b' : '#ffffff'

  return `
    /* 多图横向对照行排版（还原 React.dev / Vite / Docusaurus 响应式 Flex 行） */
    body .web-doc-figure-row {
      display: flex !important;
      flex-direction: row !important;
      flex-wrap: wrap !important;
      justify-content: center !important;
      align-items: flex-start !important;
      gap: 2rem !important;
      margin: 2rem 0 !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    body .web-doc-figure-row > figure,
    body .web-doc-figure-row > .web-doc-figure-item {
      flex: 1 1 280px !important;
      max-width: min(100%, 520px) !important;
      margin: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: flex-start !important;
      box-sizing: border-box !important;
    }
    body .web-doc-figure-row figure img {
      display: block !important;
      margin: 0 auto !important;
      max-width: 100% !important;
      height: auto !important;
    }
    body .web-doc-figure-row figcaption {
      text-align: center !important;
      margin-top: 0.75rem !important;
      font-size: 0.9em !important;
      line-height: 1.5 !important;
      opacity: 0.85 !important;
    }
    body .web-doc-figure-row figcaption p {
      margin: 0.25rem 0 !important;
      text-align: center !important;
    }

    /* 现代交互式代码沙箱组件（Playground） */
    body .web-doc-playground {
      position: relative !important;
      margin: 1.75rem 0 !important;
      border: 1px solid ${border} !important;
      border-radius: 0.75rem !important;
      overflow: hidden !important;
      background: ${surface} !important;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.06) !important;
    }
    body .web-doc-playground-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 0.5rem 1rem !important;
      border-bottom: 1px solid ${border} !important;
      background: ${headerBg} !important;
      font-size: 0.88rem !important;
    }
    body .web-doc-playground-tab {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-weight: 600 !important;
      color: ${palette.link} !important;
      padding: 0.2rem 0.5rem !important;
      border-radius: 0.3rem !important;
      background: ${surface} !important;
    }
    body .web-doc-playground-actions {
      display: flex !important;
      align-items: center !important;
      gap: 0.5rem !important;
    }
    body .web-doc-playground-btn {
      display: inline-flex !important;
      align-items: center !important;
      gap: 0.25rem !important;
      padding: 0.25rem 0.65rem !important;
      font-size: 0.8rem !important;
      font-weight: 500 !important;
      border-radius: 0.35rem !important;
      border: 1px solid ${border} !important;
      background: ${surface} !important;
      color: ${palette.text} !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
    }
    body .web-doc-playground-btn:hover {
      border-color: ${palette.link} !important;
      color: ${palette.link} !important;
    }
    body .web-doc-playground-body {
      display: flex !important;
      flex-direction: row !important;
      min-height: 280px !important;
    }
    @media (max-width: 768px) {
      body .web-doc-playground-body {
        flex-direction: column !important;
      }
    }
    body .web-doc-playground-editor {
      flex: 1 1 50% !important;
      min-width: 0 !important;
      border-right: 1px solid ${border} !important;
      overflow: auto !important;
      max-height: 480px !important;
    }
    @media (max-width: 768px) {
      body .web-doc-playground-editor {
        border-right: 0 !important;
        border-bottom: 1px solid ${border} !important;
      }
    }
    body .web-doc-playground-editor pre {
      margin: 0 !important;
      padding: 1rem !important;
      border-radius: 0 !important;
      border: 0 !important;
      background: transparent !important;
    }
    body .web-doc-playground-preview {
      flex: 1 1 50% !important;
      min-width: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      background: ${previewBg} !important;
      min-height: 240px !important;
    }
    body .web-doc-playground-preview-header {
      padding: 0.4rem 0.75rem !important;
      font-size: 0.78rem !important;
      font-weight: 600 !important;
      opacity: 0.75 !important;
      border-bottom: 1px solid ${border} !important;
      background: ${headerBg} !important;
    }
    body .web-doc-playground-frame-wrap {
      flex: 1 1 auto !important;
      position: relative !important;
      min-height: 220px !important;
    }
    body .web-doc-playground-iframe {
      width: 100% !important;
      height: 100% !important;
      min-height: 220px !important;
      border: 0 !important;
      display: block !important;
    }
  `
}

/**
 * 游乐场外层运行时脚本（iframe srcdoc 内执行）。
 *
 * ⚠️ 三层转义，缺一即整页 SyntaxError（曾致 about:srcdoc:1076 全页脚本死亡）：
 *   文件反引号层 → 外层单引号 JS 字符串层 → runner 脚本层。
 * 每向内一层多吃一层反斜杠：runner 要 2 字符的反斜杠加引号，文件须写 5 字符；
 * runner 要 `\n` 转义文件须写 `\\\\n`；正则 `\s` 文件须写 `\\\\s`。
 * `\'`、`\\n`、`\\"` 在文件里看起来“已经转了”，实际到 runner 全塌。
 * 改动本函数后必跑单测「游乐场外层运行时脚本可解析 / 恶意代码…」（new Function 门）。
 */
export { buildWebDocPlaygroundRuntimeScript } from './web-doc-runtime-scripts'

export function buildWebDocReaderDocument(
  content: Pick<WebDocPageContent, 'title' | 'bodyHtml' | 'baseUrl'>,
  theme: EpubThemeMode,
  typography: ReaderTypography = DEFAULT_READER_TYPOGRAPHY,
): string {
  const layoutCss = buildReaderLayoutCss(theme, typography)
  const codeBlockCss = buildWebDocCodeBlockCss(theme)
  const inlineCodeCss = buildWebDocInlineCodeCss(theme)
  const calloutCss = buildWebDocCalloutCss(theme)
  const baselineCss = buildWebDocBaselineCss(theme)
  const compatTableCss = buildWebDocCompatTableCss(theme)
  const docMetaCss = buildWebDocDocMetaCss(theme)
  const cardGridCss = buildWebDocCardGridCss(theme)
  const staticTabsCss = buildWebDocStaticTabsCss(theme)
  const mathCss = buildWebDocMathCss()
  const embedCss = buildWebDocEmbedCss(theme)
  const playgroundCss = buildWebDocPlaygroundCss(theme)
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
    stripCodeBlockLineNumbers(root)
    normalizeWebDocCards(root)
    normalizeWebDocCallouts(root)
    normalizeWebDocBaselineIndicators(root)
    normalizeWebDocFigureRows(root)
    normalizeWebDocCardGrids(root)
    normalizeWebDocStandaloneFigures(root)
    normalizeWebDocSandpackPlaygrounds(root)
    root.querySelectorAll('table').forEach((table) => {
      if (table.parentElement?.classList.contains('web-doc-table-scroll') || table.parentElement?.closest('table')) return
      const wrapper = doc.createElement('div')
      wrapper.className = 'web-doc-table-scroll'
      wrapper.setAttribute('role', 'region')
      wrapper.setAttribute('aria-label', table.querySelector('caption')?.textContent?.trim() ||
        table.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || '文档表格')
      wrapper.setAttribute('tabindex', '0')
      table.replaceWith(wrapper)
      wrapper.appendChild(table)
    })
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
  ${buildWebDocKatexStyles()}
  <style>${layoutCss}</style>
  <style>${codeBlockCss}</style>
  <style>${inlineCodeCss}</style>
  <style>${calloutCss}</style>
  <style>${baselineCss}</style>
  <style>${compatTableCss}</style>
  <style>${docMetaCss}</style>
  <style>${cardGridCss}</style>
  <style>${staticTabsCss}</style>
  <style>${mathCss}</style>
  <style>${embedCss}</style>
  <style>${playgroundCss}</style>
  <style>
    body { margin: 0; padding: 1.25rem 1.5rem 2rem; }
    a { word-break: break-word; }
    [data-montree-href] { cursor: pointer; }
    pre { overflow-x: auto; }
    img { max-width: 100%; height: auto; }
    .web-doc-object-image { display: block; width: 100%; margin: 0 auto; }
    /* 自适应现代文档（如 React.dev / Next.js / GitHub）的深浅色模式图片切换 */
    ${theme === 'dark' ? `
      body .light-image,
      body .only-light,
      body .light-only,
      body [data-theme="light"]:not(html):not(body),
      body img[src*=".light."] {
        display: none !important;
      }
    ` : `
      body .dark-image,
      body .only-dark,
      body .dark-only,
      body [data-theme="dark"]:not(html):not(body),
      body img[src*=".dark."] {
        display: none !important;
      }
    `}
    body .web-doc-reader-content figure { margin: 1.5em 0; max-width: 100%; }
    body .web-doc-reader-content figure.web-doc-figure img,
    body .web-doc-reader-content figure.web-doc-figure picture {
      display: block !important;
      margin-inline: auto !important;
      max-width: 100% !important;
    }
    body .web-doc-reader-content figure.web-doc-figure img { height: auto !important; }
    body .web-doc-reader-content figcaption,
    body .web-doc-reader-content caption,
    body .web-doc-reader-content .ltx_figure_panel,
    body .web-doc-reader-content .ltx_caption {
      font-size: 0.88em !important;
      line-height: 1.55 !important;
      text-align: left;
      margin: 0.8em 0;
      opacity: 0.85;
    }
    body .web-doc-table-scroll {
      max-width: 100%;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      margin: 1em 0;
      line-height: 1.5 !important;
    }
    .web-doc-table-scroll > table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9em;
    }
    body .web-doc-table-scroll th,
    body .web-doc-table-scroll td {
      padding: 0.6em 0.85em !important;
      vertical-align: top;
      text-align: left;
      border-bottom: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    }
    body .web-doc-table-scroll thead th,
    body .web-doc-table-scroll .ltx_font_bold { font-weight: 600; }
    body .web-doc-table-scroll .ltx_font_italic { font-style: italic; }
    body .web-doc-table-scroll .ltx_align_center { text-align: center; }
    body .web-doc-table-scroll .ltx_align_right { text-align: right; }
    body .web-doc-table-scroll .ltx_align_left { text-align: left; }
    body .web-doc-table-scroll .ltx_align_middle { vertical-align: middle; }
    body .web-doc-table-scroll .ltx_border_t { border-top: 1px solid currentColor; }
    body .web-doc-table-scroll .ltx_border_tt { border-top: 2px solid currentColor; }
    body .web-doc-table-scroll .ltx_border_b { border-bottom: 1px solid currentColor; }
    body .web-doc-table-scroll .ltx_border_bb { border-bottom: 2px solid currentColor; }
    body .web-doc-table-scroll .ltx_border_l { border-left: 1px solid currentColor; }
    body .web-doc-table-scroll .ltx_border_r { border-right: 1px solid currentColor; }
    /* 无宽高的图标 SVG（如「编辑此页」）否则会按 viewBox 撑满版面 */
    svg { max-width: 100%; height: auto; max-height: min(70vh, 28rem); }
    .web-doc-mermaid { margin: 1.25em 0; }
    .web-doc-mermaid > .mermaid,
    .web-doc-mermaid > .mermaid-hydrating { display: flex; justify-content: center; overflow-x: auto; padding: 1rem; }
    .web-doc-mermaid > div > svg { max-height: none; flex-shrink: 0; }
    .web-doc-mermaid > details > summary { cursor: pointer; font-size: 0.85em; opacity: 0.75; }
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
<body><main id="montree-web-doc-content" class="web-doc-reader-content">${body}</main>${buildWebDocTabsRuntimeScript()}${buildWebDocPlaygroundRuntimeScript()}</body>
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

/** 站点导出的原始 Markdown 可能带 YAML frontmatter，正文渲染前剥离。 */
function stripMarkdownFrontmatter(markdown: string): string {
  return markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
}

function markdownTitle(markdown: string, pageUrl: string): string {
  const heading = /^ {0,3}#\s+(.+?)\s*#*\s*$/m.exec(markdown)?.[1]?.trim()
  if (heading) return heading
  try {
    const segment = new URL(pageUrl).pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : pageUrl
  } catch {
    return pageUrl
  }
}

/**
 * 文档站提供 Markdown 源时优先走这里：复用编辑器同一套 Markdown 渲染，
 * 再按阅读器的相对链接/消毒/标题锚点规则收口。交互组件仍不会执行。
 */
export function buildWebDocPageContentFromMarkdown(
  markdown: string,
  pageUrl: string,
  siteId: WebDocSiteId,
): WebDocPageContent {
  const source = stripMarkdownFrontmatter(markdown)
  const rendered = renderMarkdown(source)
  const doc = new DOMParser().parseFromString(
    `<div id="montree-markdown-root">${rendered}</div>`,
    'text/html',
  )
  const root = doc.getElementById('montree-markdown-root')
  if (!root) {
    return { title: markdownTitle(source, pageUrl), bodyHtml: '', baseUrl: pageUrl, siteId }
  }
  rewriteRelativeUrls(root, pageUrl)
  stripCodeBlockLineNumbers(root)
  const sanitized = sanitizeWebDocBodyHtml(root.innerHTML)
  const { bodyHtml } = ensureWebDocHeadingIds(sanitized)
  return {
    title: markdownTitle(source, pageUrl),
    bodyHtml,
    baseUrl: pageUrl,
    siteId,
  }
}
