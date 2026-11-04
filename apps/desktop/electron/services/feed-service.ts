import { DOMParser } from '@xmldom/xmldom'
import { err, ok, type AppError, type Result } from '@yitom/contracts'
import type {
  FeedFetchPayload,
  FeedItem,
  FeedResult,
  FeedSourceId,
} from '../../contracts/feed'
import { fetchHnFeed } from './hn-service'

const FEED_TIMEOUT_MS = 15_000
const RSS_MAX_BYTES = 4 * 1024 * 1024
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 60
const AGGREGATOR_TTL_MS = 60 * 60_000
const RSS_TTL_MS = 30 * 60_000

const RSS_FEEDS: Record<string, string> = {
  sspai: 'https://sspai.com/feed',
  ruanyifeng: 'https://www.ruanyifeng.com/blog/atom.xml',
  ars: 'https://feeds.arstechnica.com/arstechnica/index',
  cloudflare: 'https://blog.cloudflare.com/rss/',
}

interface CachedFeed {
  items: FeedItem[]
  limit: number
  fetchedAt: number
}

const feedCache = new Map<string, CachedFeed>()

/** 仅测试使用 */
export function clearFeedCache(): void {
  feedCache.clear()
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

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Montree/0.4.30',
    },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > RSS_MAX_BYTES) throw new Error('订阅内容超过 4MB 限制')
  const text = await response.text()
  if (text.length > RSS_MAX_BYTES) throw new Error('订阅内容超过 4MB 限制')
  return text
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
export function parseFeedXml(xml: string, feedUrl: string, limit = DEFAULT_LIMIT): FeedItem[] {
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
      const title = elementText(entry, ['title'])
      const url = entryLink(entry, feedUrl)
      if (!title || !url) return null
      const guid = elementText(entry, ['guid', 'id']) || url
      const author =
        elementText(entry, ['dc:creator', 'creator', 'author', 'name']) || 'unknown'
      const published =
        elementText(entry, ['pubDate', 'published', 'updated', 'dc:date']) || ''
      return {
        id: guid,
        source: 'rss',
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

async function fetchSourceItems(
  source: FeedSourceId,
  channel: string,
  limit: number,
  force: boolean,
  deps: FeedFetchDeps,
): Promise<Result<FeedItem[], AppError>> {
  const now = deps.now ?? Date.now
  if (source === 'hacker-news') {
    const result = await fetchHnFeed({ channel: channel as never, limit, force }, deps)
    if (!result.ok) return result
    return ok(result.value.stories.map(hnItemToFeedItem))
  }

  if (source === 'lobsters') {
    if (channel !== 'hottest' && channel !== 'newest') {
      return err({ code: 'INVALID_ARGUMENT', message: `未知的 Lobsters 频道：${channel}` })
    }
    const payload = await fetchJson(`https://lobste.rs/${channel}.json`, deps.fetchImpl ?? fetch)
    if (!Array.isArray(payload)) throw new Error('Lobsters 响应不是数组')
    const items = payload
      .map((story) => mapLobstersStory(story as LobstersStory, now()))
      .filter((item): item is FeedItem => item !== null)
      .slice(0, limit)
    return ok(items)
  }

  const feedUrl = RSS_FEEDS[channel]
  if (!feedUrl) {
    return err({ code: 'INVALID_ARGUMENT', message: `未知的订阅源：${channel}` })
  }
  const xml = await fetchText(feedUrl, deps.fetchImpl ?? fetch)
  return ok(parseFeedXml(xml, feedUrl, limit))
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
  const now = deps.now ?? Date.now
  const ttl = source === 'rss' ? RSS_TTL_MS : AGGREGATOR_TTL_MS
  const cacheKey = `${source}:${channel}`

  const cached = feedCache.get(cacheKey)
  if (!payload.force && cached && cached.limit >= limit && now() - cached.fetchedAt < ttl) {
    return ok({
      source,
      channel,
      items: cached.items.slice(0, limit),
      fetchedAt: cached.fetchedAt,
      cached: true,
    })
  }

  try {
    const items = await fetchSourceItems(source, channel, limit, Boolean(payload.force), deps)
    if (!items.ok) return items
    const fetchedAt = now()
    feedCache.set(cacheKey, { items: items.value, limit, fetchedAt })
    return ok({
      source,
      channel,
      items: items.value.slice(0, limit),
      fetchedAt,
      cached: false,
    })
  } catch (cause) {
    return err({
      code: 'NETWORK_ERROR',
      message: `拉取 ${source} / ${channel} 失败：${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    })
  }
}
