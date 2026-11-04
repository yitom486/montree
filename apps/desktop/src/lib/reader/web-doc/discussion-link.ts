import type { WebDocPageContent } from '@yitom/contracts'

/**
 * 正文 ↔ 讨论页的通用连接。
 *
 * 阅读器不假设讨论一定在 HN：任何来源只要能提供讨论页 URL，都由同一套
 * 顶栏 / 底部入口呈现。来源名只用于文案，不参与逻辑。
 */
export interface WebDocDiscussionLink {
  /** 展示用来源名，如 Hacker News / Reddit / Lobsters */
  source: string
  url: string
  /** 评论数；未知时省略 */
  count?: number
}

export type WebDocPageContentWithDiscussion = WebDocPageContent & {
  /** 文章 HTML 中自动发现的讨论链接 */
  discussion?: WebDocDiscussionLink
}

interface DiscussionProvider {
  source: string
  matches: (url: URL) => boolean
}

const DISCUSSION_PROVIDERS: DiscussionProvider[] = [
  {
    source: 'Hacker News',
    matches: (url) =>
      url.hostname === 'news.ycombinator.com' &&
      url.pathname === '/item' &&
      url.searchParams.has('id'),
  },
  {
    source: 'Reddit',
    matches: (url) =>
      /(^|\.)reddit\.com$/i.test(url.hostname) && /\/comments\//i.test(url.pathname),
  },
  {
    source: 'Lobsters',
    matches: (url) => url.hostname === 'lobste.rs' && /^\/s\/[^/]+(?:\/[^/]+)?\/?$/i.test(url.pathname),
  },
  {
    source: 'GitHub Discussions',
    matches: (url) => /(^|\.)github\.com$/i.test(url.hostname) && /\/discussions\/\d+/i.test(url.pathname),
  },
]

function stripHash(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.toString()
  } catch {
    return rawUrl
  }
}

/** 识别某个 URL 属于哪个讨论站；不是讨论页返回 null */
export function identifyDiscussionProvider(rawUrl: string): WebDocDiscussionLink | null {
  try {
    const url = new URL(rawUrl)
    const provider = DISCUSSION_PROVIDERS.find((item) => item.matches(url))
    return provider ? { source: provider.source, url: url.toString() } : null
  } catch {
    return null
  }
}

/**
 * 从文章 HTML 中找讨论入口：博客常在页脚放 “Discuss on Hacker News” 之类的链接。
 * 只认已知讨论站的规范 URL，避免把普通“评论区”锚点误判成讨论页。
 */
export function detectDiscussionLink(
  html: string,
  pageUrl: string,
): WebDocDiscussionLink | null {
  if (!html.trim()) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const self = stripHash(pageUrl)

  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = anchor.getAttribute('href')?.trim()
    if (!href || href.startsWith('javascript:')) continue
    let resolved: URL
    try {
      resolved = new URL(href, pageUrl)
    } catch {
      continue
    }
    const candidate = identifyDiscussionProvider(resolved.toString())
    if (!candidate) continue
    if (stripHash(candidate.url) === self) continue
    return candidate
  }
  return null
}
