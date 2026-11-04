import { DOMParser } from '@xmldom/xmldom'
import { err, ok, type AppError, type Result } from '@yitom/contracts'
import type {
  FeedFetchPayload,
  FeedItem,
  FeedResult,
  FeedSourceId,
} from '../../contracts/feed'
import { feedAuthPartition, FEED_BROWSER_UA } from '../../contracts/feed'
import { fetchHnFeed } from './hn-service'
import { assertWebDocUrlAllowed } from './web-doc/url-policy'

const FEED_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
const RSS_MAX_BYTES = 4 * 1024 * 1024
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 60
const AGGREGATOR_TTL_MS = 60 * 60_000
const RSS_TTL_MS = 30 * 60_000
const ARXIV_TTL_MS = 6 * 60 * 60_000

const RSS_FEEDS: Record<string, string> = {
  sspai: 'https://sspai.com/feed',
  ruanyifeng: 'https://www.ruanyifeng.com/blog/atom.xml',
  ars: 'https://feeds.arstechnica.com/arstechnica/index',
  cloudflare: 'https://blog.cloudflare.com/rss/',
}

const AI_FEEDS: Record<string, string> = {
  claude: 'https://claude.dev/rss.xml',
  huggingface: 'https://huggingface.co/blog/feed.xml',
  openai: 'https://openai.com/news/rss.xml',
  deepmind: 'https://deepmind.google/blog/rss.xml',
  'google-ai': 'https://blog.google/technology/ai/rss/',
  bair: 'https://bair.berkeley.edu/blog/feed.xml',
  'import-ai': 'https://importai.substack.com/feed',
}

const LINUX_DO_FEEDS: Record<string, string> = {
  latest: 'https://linux.do/latest.rss',
  top: 'https://linux.do/top.rss?period=weekly',
}

class FeedHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'FeedHttpError'
  }
}

interface FeedPageState {
  kind: 'next-link' | 'substack'
  /** page → 该页文档的 next 地址 */
  nextByPage: Map<number, string>
}

const feedPageState = new Map<string, FeedPageState>()

function pageStateKey(source: FeedSourceId, channel: string): string {
  return `${source}:${channel}`
}

export function clearFeedPageState(): void {
  feedPageState.clear()
}

function isSubstackFeed(feedUrl: string): boolean {
  try {
    const url = new URL(feedUrl)
    return url.hostname.endsWith('.substack.com') && /\/feed\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}

function substackArchiveUrl(feedUrl: string, page: number, pageSize = 20): string {
  const url = new URL(feedUrl)
  return `${url.origin}/api/v1/archive?sort=new&offset=${page * pageSize}&limit=${pageSize}`
}

/** RSS/Atom 的 rel="next"（RFC 5005 或 RSS 的 atom:link） */
export function parseFeedNextUrl(xml: string, baseUrl: string): string | null {
  for (const match of xml.matchAll(/<(?:[a-z0-9]+:)?link\b[^>]*>/gi)) {
    const tag = match[0]
    if (!/rel\s*=\s*["']next["']/i.test(tag)) continue
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]?.trim()
    if (!href) continue
    try {
      return new URL(href, baseUrl).toString()
    } catch {
      continue
    }
  }
  return null
}

interface SubstackPost {
  title?: string
  canonical_url?: string
  post_date?: string
  publishedBylines?: Array<{ name?: string }>
}

function mapSubstackPost(post: SubstackPost, source: FeedSourceId): FeedItem | null {
  const url = post.canonical_url?.trim()
  const title = post.title?.trim()
  if (!url || !title) return null
  return {
    id: url,
    source,
    title,
    url,
    domain: domainOf(url),
    points: 0,
    author: post.publishedBylines?.[0]?.name?.trim() || 'unknown',
    createdAt: toUnixSeconds(post.post_date, Math.floor(Date.now() / 1000)),
    comments: 0,
    discussionUrl: url,
    text: null,
  }
}

const ARXIV_CATEGORIES: Record<string, string> = {
  'cs-ai': 'cs.AI',
  'cs-lg': 'cs.LG',
  'cs-pl': 'cs.PL',
  'cs-dc': 'cs.DC',
}

function ttlFor(source: FeedSourceId): number {
  if (source === 'rss' || source === 'ai' || source === 'linux-do') return RSS_TTL_MS
  if (source === 'arxiv') return ARXIV_TTL_MS
  return AGGREGATOR_TTL_MS
}

interface CachedFeed {
  items: FeedItem[]
  limit: number
  fetchedAt: number
  hasMore: boolean
  feedTitle?: string
}

const feedCache = new Map<string, CachedFeed>()

/** 仅测试使用 */
export function clearFeedCache(): void {
  feedCache.clear()
  feedPageState.clear()
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(limit ?? DEFAULT_LIMIT)))
}

function domainOf(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

function toUnixSeconds(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback
}

function decodeCustomFeedChannel(channel: string): string | null {
  if (!channel.startsWith('custom:')) return null
  try {
    const url = Buffer.from(channel.slice('custom:'.length), 'base64url').toString('utf8').trim()
    return url || null
  } catch {
    return null
  }
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

/**
 * 抓取订阅内容：自定义 URL 必须逐跳做 SSRF 校验，禁止跳转到内网/本机。
 * 内置订阅同样走这条路径，规则一致。
 */
async function fetchFeedText(
  rawUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ text: string; finalUrl: string }> {
  let current = assertWebDocUrlAllowed(rawUrl).toString()

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(current, {
      headers: {
        Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Montree/0.4.30',
      },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      redirect: 'manual',
    })

    if (REDIRECT_STATUS.has(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('重定向缺少 Location')
      current = assertWebDocUrlAllowed(new URL(location, current).toString()).toString()
      continue
    }
    if (!response.ok) throw new FeedHttpError(response.status, `HTTP ${response.status}`)

    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > RSS_MAX_BYTES) throw new Error('订阅内容超过 4MB 限制')
    const text = await response.text()
    if (text.length > RSS_MAX_BYTES) throw new Error('订阅内容超过 4MB 限制')
    return { text, finalUrl: response.url || current }
  }

  throw new Error('重定向次数过多')
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Montree/0.4.30',
    },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

interface LobstersStory {
  short_id?: string
  title?: string
  url?: string
  score?: number
  submitter_user?: string
  created_at?: string
  comment_count?: number
  comments_url?: string
  description_plain?: string
}

/** Lobsters JSON → 统一 FeedItem；无外链文本帖保留讨论页地址 */
export function mapLobstersStory(story: LobstersStory, now = Date.now()): FeedItem | null {
  const id = story.short_id?.trim()
  const title = story.title?.trim()
  if (!id || !title) return null
  const articleUrl = story.url?.trim() || null
  const discussionUrl = story.comments_url?.trim() || `https://lobste.rs/s/${id}`
  return {
    id,
    source: 'lobsters',
    title,
    url: articleUrl,
    domain: domainOf(articleUrl ?? discussionUrl),
    points: typeof story.score === 'number' ? story.score : 0,
    author: story.submitter_user?.trim() || 'unknown',
    createdAt: toUnixSeconds(story.created_at, Math.floor(now / 1000)),
    comments: typeof story.comment_count === 'number' ? story.comment_count : 0,
    discussionUrl,
    text: story.description_plain?.trim() || null,
  }
}

interface XmlNode {
  textContent: string | null
  getAttribute(name: string): string | null
  getElementsByTagName(name: string): {
    length: number
    item(index: number): XmlNode | null
  }
}

function elementText(parent: XmlNode, names: string[]): string {
  for (const name of names) {
    const nodes = parent.getElementsByTagName(name)
    for (let index = 0; index < nodes.length; index += 1) {
      const value = nodes.item(index)?.textContent?.trim()
      if (value) return value
    }
  }
  return ''
}

function entryLink(entry: XmlNode, baseUrl: string): string {
  const links = entry.getElementsByTagName('link')
  for (let index = 0; index < links.length; index += 1) {
    const link = links.item(index)
    if (!link) continue
    const href = link.getAttribute('href')?.trim()
    if (href && (link.getAttribute('rel') ?? 'alternate') === 'alternate') {
      return new URL(href, baseUrl).toString()
    }
  }
  for (let index = 0; index < links.length; index += 1) {
    const text = links.item(index)?.textContent?.trim()
    if (text) return new URL(text, baseUrl).toString()
  }
  return ''
}

/**
 * 解析 RSS 2.0 / Atom。只提取列表需要的字段，不注入正文 HTML；
 * 相对链接按订阅地址解析，方便阅读器直接抓原文。
 */
export function parseFeedXml(
  xml: string,
  feedUrl: string,
  limit = DEFAULT_LIMIT,
  source: FeedSourceId = 'rss',
): FeedItem[] {
  if (!xml.trim()) return []
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('订阅内容不是合法 XML')
  }
  const entries = [
    ...Array.from(doc.getElementsByTagName('item')),
    ...Array.from(doc.getElementsByTagName('entry')),
  ].slice(0, normalizeLimit(limit))

  return entries
    .map((entry): FeedItem | null => {
      const title = elementText(entry, ['title']).replace(/\s+/g, ' ')
      const url = entryLink(entry, feedUrl)
      if (!title || !url) return null
      const guid = elementText(entry, ['guid', 'id']) || url
      const author =
        elementText(entry, ['name', 'dc:creator', 'creator', 'author']) || 'unknown'
      const published =
        elementText(entry, ['pubDate', 'published', 'updated', 'dc:date']) || ''
      return {
        id: guid,
        source,
        title,
        url,
        domain: domainOf(url),
        points: 0,
        author,
        createdAt: toUnixSeconds(published, Math.floor(Date.now() / 1000)),
        comments: 0,
        discussionUrl: url,
        text: null,
      }
    })
    .filter((item): item is FeedItem => item !== null)
}

export function parseFeedTitle(xml: string): string | null {
  if (!xml.trim()) return null
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return null
    const root =
      doc.getElementsByTagName('channel').item(0) ??
      doc.getElementsByTagName('feed').item(0)
    const title = root ? elementText(root, ['title']) : ''
    return title.replace(/\s+/g, ' ').trim() || null
  } catch {
    return null
  }
}

function hnItemToFeedItem(story: {
  id: number
  title: string
  url: string | null
  domain: string | null
  points: number
  author: string
  createdAt: number
  comments: number
  commentUrl: string
  text: string | null
}): FeedItem {
  return {
    id: String(story.id),
    source: 'hacker-news',
    title: story.title,
    url: story.url,
    domain: story.domain,
    points: story.points,
    author: story.author,
    createdAt: story.createdAt,
    comments: story.comments,
    discussionUrl: story.commentUrl,
    text: story.text,
  }
}

export interface FeedFetchDeps {
  fetchImpl?: typeof fetch
  now?: () => number
}

async function fetchRssLikePage(
  source: FeedSourceId,
  channel: string,
  feedUrl: string,
  page: number,
  limit: number,
  fetchImpl: typeof fetch,
): Promise<Result<{ items: FeedItem[]; hasMore: boolean; feedTitle?: string }, AppError>> {
  const key = pageStateKey(source, channel)
  let state = feedPageState.get(key)
  if (!state || page === 0) {
    state = {
      kind: isSubstackFeed(feedUrl) ? 'substack' : 'next-link',
      nextByPage: new Map(),
    }
    feedPageState.set(key, state)
  }

  let pageUrl: string | null
  if (page === 0) pageUrl = feedUrl
  else if (state.kind === 'substack') pageUrl = substackArchiveUrl(feedUrl, page)
  else pageUrl = state.nextByPage.get(page - 1) ?? null
  if (!pageUrl) return ok({ items: [], hasMore: false })

  // Substack 没有 rel=next，归档接口才是真正的分页游标
  if (state.kind === 'substack' && page > 0) {
    const payload = await fetchJson(pageUrl, fetchImpl)
    const posts = Array.isArray(payload) ? payload : []
    const items = posts
      .map((post) => mapSubstackPost(post as SubstackPost, source))
      .filter((item): item is FeedItem => item !== null)
    return ok({ items, hasMore: posts.length >= 20 })
  }

  const { text, finalUrl } = await fetchFeedText(pageUrl, fetchImpl)
  const next = parseFeedNextUrl(text, finalUrl)
  if (next) state.nextByPage.set(page, next)
  const items = parseFeedXml(text, finalUrl, limit, source)
  return ok({
    items,
    hasMore:
      Boolean(next) || (state.kind === 'substack' && page === 0 && items.length >= 20),
    feedTitle: parseFeedTitle(text) ?? undefined,
  })
}

async function fetchSourceItems(
  source: FeedSourceId,
  channel: string,
  limit: number,
  page: number,
  force: boolean,
  deps: FeedFetchDeps,
): Promise<Result<{ items: FeedItem[]; hasMore: boolean; feedTitle?: string }, AppError>> {
  const now = deps.now ?? Date.now
  if (source === 'hacker-news') {
    const result = await fetchHnFeed(
      { channel: channel as never, limit, offset: page * limit, force },
      deps,
    )
    if (!result.ok) return result
    return ok({
      items: result.value.stories.map(hnItemToFeedItem),
      hasMore: result.value.hasMore,
    })
  }

  if (source === 'lobsters') {
    if (channel !== 'hottest' && channel !== 'newest') {
      return err({ code: 'INVALID_ARGUMENT', message: `未知的 Lobsters 频道：${channel}` })
    }
    // Lobsters JSON 的分页路径不是 ?page=N：
    // 热门第 2 页是 /page/2.json，最新第 2 页是 /newest/page/2.json。
    const pageUrl =
      page === 0
        ? `https://lobste.rs/${channel}.json`
        : channel === 'newest'
          ? `https://lobste.rs/newest/page/${page + 1}.json`
          : `https://lobste.rs/page/${page + 1}.json`
    const payload = await fetchJson(pageUrl, deps.fetchImpl ?? fetch)
    if (!Array.isArray(payload)) throw new Error('Lobsters 响应不是数组')
    const items = payload
      .map((story) => mapLobstersStory(story as LobstersStory, now()))
      .filter((item): item is FeedItem => item !== null)
      .slice(0, limit)
    // Lobsters 每页固定 25 条；满页就认为还有下一页
    return ok({ items, hasMore: payload.length >= 25 })
  }

  if (source === 'arxiv') {
    const category = ARXIV_CATEGORIES[channel]
    if (!category) {
      return err({ code: 'INVALID_ARGUMENT', message: `未知的 arXiv 分类：${channel}` })
    }
    const queryUrl = `https://export.arxiv.org/api/query?search_query=cat:${encodeURIComponent(category)}&sortBy=submittedDate&sortOrder=descending&start=${page * limit}&max_results=${limit}`
    const { text } = await fetchFeedText(queryUrl, deps.fetchImpl ?? fetch)
    const items = parseFeedXml(text, queryUrl, limit, 'arxiv')
    return ok({ items, hasMore: items.length >= limit })
  }

  if (source === 'ai') {
    const feedUrl = AI_FEEDS[channel]
    if (!feedUrl) {
      return err({ code: 'INVALID_ARGUMENT', message: `未知的 AI 资讯源：${channel}` })
    }
    return fetchRssLikePage(source, channel, feedUrl, page, limit, deps.fetchImpl ?? fetch)
  }

  if (source === 'linux-do') {
    const feedUrl = LINUX_DO_FEEDS[channel]
    if (!feedUrl) {
      return err({ code: 'INVALID_ARGUMENT', message: `未知的 Linux.do 频道：${channel}` })
    }
    if (page > 0) return ok({ items: [], hasMore: false })
    // 登录 Cookie 在该来源的持久化分区里；session.fetch 会自动携带
    const { session } = await import('electron')
    const ses = session.fromPartition(feedAuthPartition(source))
    ses.setUserAgent(FEED_BROWSER_UA)
    const { text, finalUrl } = await fetchFeedText(
      feedUrl,
      ses.fetch.bind(ses) as unknown as typeof fetch,
    )
    return ok({
      items: parseFeedXml(text, finalUrl, limit, 'linux-do'),
      hasMore: false,
      feedTitle: parseFeedTitle(text) ?? undefined,
    })
  }

  // 自定义订阅：channel 形如 custom:<base64url(feedUrl)>
  const customUrl = decodeCustomFeedChannel(channel)
  const feedUrl = customUrl ?? RSS_FEEDS[channel]
  if (!feedUrl) {
    return err({ code: 'INVALID_ARGUMENT', message: `未知的订阅源：${channel}` })
  }
  return fetchRssLikePage(source, channel, feedUrl, page, limit, deps.fetchImpl ?? fetch)
}

/**
 * 统一拉取入口：按 source + channel 分发适配器，并按源设置缓存时长。
 * 手动刷新通过 `force` 跳过缓存。
 */
export async function fetchFeed(
  payload: FeedFetchPayload,
  deps: FeedFetchDeps = {},
): Promise<Result<FeedResult, AppError>> {
  const { source, channel } = payload
  if (!source || !channel) {
    return err({ code: 'INVALID_ARGUMENT', message: '缺少资讯源或频道' })
  }
  const limit = normalizeLimit(payload.limit)
  const page = Math.max(0, Math.round(payload.page ?? 0))
  const now = deps.now ?? Date.now
  const ttl = ttlFor(source)
  const cacheKey = `${source}:${channel}:${page}`

  const cached = feedCache.get(cacheKey)
  if (!payload.force && cached && cached.limit >= limit && now() - cached.fetchedAt < ttl) {
    return ok({
      source,
      channel,
      page,
      items: cached.items.slice(0, limit),
      fetchedAt: cached.fetchedAt,
      cached: true,
      hasMore: cached.hasMore,
      feedTitle: cached.feedTitle,
    })
  }

  try {
    const result = await fetchSourceItems(
      source,
      channel,
      limit,
      page,
      Boolean(payload.force),
      deps,
    )
    if (!result.ok) return result
    const fetchedAt = now()
    feedCache.set(cacheKey, {
      items: result.value.items,
      limit,
      fetchedAt,
      hasMore: result.value.hasMore,
      feedTitle: result.value.feedTitle,
    })
    return ok({
      source,
      channel,
      page,
      items: result.value.items.slice(0, limit),
      fetchedAt,
      cached: false,
      hasMore: result.value.hasMore,
      feedTitle: result.value.feedTitle,
    })
  } catch (cause) {
    if (
      cause instanceof FeedHttpError &&
      (cause.status === 401 || cause.status === 403) &&
      source === 'linux-do'
    ) {
      return err({ code: 'UNAUTHORIZED', message: '需要登录 Linux.do 后才能读取该频道' })
    }
    return err({
      code: 'NETWORK_ERROR',
      message: `拉取 ${source} / ${channel} 失败：${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    })
  }
}
