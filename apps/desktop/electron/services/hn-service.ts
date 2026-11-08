import { err, ok, type AppError, type Result } from '@yitom/contracts'
import type {
  HnDiscussionRef,
  HnFeedChannel,
  HnFeedPayload,
  HnFeedResult,
  HnFindDiscussionPayload,
  HnStory,
} from '../../contracts/hn'

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0'
const HN_SITE_BASE = 'https://news.ycombinator.com/item?id='
const HN_ALGOLIA_SEARCH = 'https://hn.algolia.com/api/v1/search'
const REQUEST_TIMEOUT_MS = 10_000
const FEED_TTL_MS = 60 * 60_000
/** 文章 URL → HN 讨论的反查结果缓存（含“没有讨论”的空结果） */
const DISCUSSION_LOOKUP_TTL_MS = 24 * 60 * 60_000
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 60
/** 同时回源的单条 item 请求上限，避免一次打满 HN API */
const ITEM_CONCURRENCY = 10

const CHANNEL_ENDPOINT: Record<HnFeedChannel, string> = {
  top: 'topstories',
  new: 'newstories',
  ask: 'askstories',
  show: 'showstories',
}

interface HnItemJson {
  id?: number
  type?: string
  by?: string
  time?: number
  title?: string
  url?: string
  score?: number
  descendants?: number
  text?: string
  deleted?: boolean
  dead?: boolean
}

interface CachedIds {
  ids: number[]
  fetchedAt: number
}

interface CachedItem {
  story: HnStory
  fetchedAt: number
}

const idCache = new Map<HnFeedChannel, CachedIds>()
const itemCache = new Map<number, CachedItem>()
const discussionCache = new Map<string, { value: HnDiscussionRef | null; expires: number }>()

/** 仅测试使用：清空进程内频道与条目缓存 */
export function clearHnFeedCache(): void {
  idCache.clear()
  itemCache.clear()
}

/** 仅测试使用：清空文章 URL → 讨论反查缓存 */
export function clearHnDiscussionCache(): void {
  discussionCache.clear()
}

export function normalizeHnChannel(value: unknown): HnFeedChannel | null {
  if (value === 'top' || value === 'new' || value === 'ask' || value === 'show') return value
  return null
}

export function hnDomainFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/**
 * HN item → 列表行。删除/死亡条目与没有标题的条目直接丢弃；
 * 文本帖（Ask/Show）保留正文，但外链仍为 null，由阅读器直接打开讨论页。
 */
export function mapHnItem(item: HnItemJson | null | undefined): HnStory | null {
  if (!item || item.deleted || item.dead) return null
  if (typeof item.id !== 'number' || !item.title) return null
  const url = typeof item.url === 'string' && item.url.trim() ? item.url : null
  return {
    id: item.id,
    title: item.title,
    url,
    domain: hnDomainFromUrl(url),
    points: typeof item.score === 'number' ? item.score : 0,
    author: item.by ?? 'unknown',
    createdAt: typeof item.time === 'number' ? item.time : 0,
    comments: typeof item.descendants === 'number' ? item.descendants : 0,
    commentUrl: `${HN_SITE_BASE}${item.id}`,
    text: typeof item.text === 'string' ? item.text : null,
  }
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

export interface HnFeedDeps {
  fetchImpl?: typeof fetch
  now?: () => number
}

function normalizeArticleUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

interface AlgoliaHit {
  objectID?: string
  title?: string
  url?: string
  num_comments?: number
}

/**
 * 按文章 URL 反查 HN 讨论（Algolia HN Search）。
 * 命中结果按 URL 缓存 24 小时，空结果同样缓存，避免每次打开文章都打一次搜索 API。
 */
export async function findHnDiscussion(
  payload: HnFindDiscussionPayload,
  deps: HnFeedDeps = {},
): Promise<Result<HnDiscussionRef | null, AppError>> {
  const articleUrl = normalizeArticleUrl(payload?.url ?? '')
  if (!articleUrl) {
    return err({ code: 'INVALID_ARGUMENT', message: '无法识别的文章 URL' })
  }

  const now = deps.now ?? Date.now
  const cached = discussionCache.get(articleUrl)
  if (cached && cached.expires > now()) return ok(cached.value)

  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    const endpoint = `${HN_ALGOLIA_SEARCH}?query=${encodeURIComponent(articleUrl)}&restrictSearchableAttributes=url&tags=story`
    const response = await fetchImpl(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { hits?: AlgoliaHit[] }

    // Algolia 是模糊搜索，必须再校验一次 url 完全一致，避免把相似文章当成同一篇。
    const hit = (data.hits ?? []).find((item) => {
      if (!item.objectID || !/^\d+$/.test(item.objectID)) return false
      return normalizeArticleUrl(item.url ?? '') === articleUrl
    })
    const value: HnDiscussionRef | null = hit
      ? {
          id: Number(hit.objectID),
          url: `${HN_SITE_BASE}${hit.objectID}`,
          comments: typeof hit.num_comments === 'number' ? hit.num_comments : 0,
          title: hit.title ?? '',
        }
      : null

    discussionCache.set(articleUrl, { value, expires: now() + DISCUSSION_LOOKUP_TTL_MS })
    return ok(value)
  } catch (cause) {
    return err({
      code: 'NETWORK_ERROR',
      message: `HN 讨论反查失败：${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
}

/**
 * 拉取真实 Hacker News 列表：频道 id 序列单独缓存，条目按 id 缓存。
 * 分页只取 id 列表的一段，不会因为加载下一页而重复拉取前面的条目。
 */
export async function fetchHnFeed(
  payload: HnFeedPayload,
  deps: HnFeedDeps = {},
): Promise<Result<HnFeedResult, AppError>> {
  const channel = normalizeHnChannel(payload?.channel)
  if (!channel) {
    return err({ code: 'INVALID_ARGUMENT', message: `未知的 Hacker News 频道：${String(payload?.channel)}` })
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(payload.limit ?? DEFAULT_LIMIT)))
  const offset = Math.max(0, Math.round(payload.offset ?? 0))
  const now = deps.now ?? Date.now
  const fetchImpl = deps.fetchImpl ?? fetch

  try {
    let idsEntry = idCache.get(channel)
    const idsFromCache =
      !payload.force && Boolean(idsEntry && now() - idsEntry.fetchedAt < FEED_TTL_MS)
    if (!idsFromCache) {
      const ids = await fetchJson<unknown>(
        `${HN_API_BASE}/${CHANNEL_ENDPOINT[channel]}.json`,
        fetchImpl,
      )
      if (!Array.isArray(ids)) throw new Error('频道响应不是数组')
      idsEntry = {
        ids: ids.filter((id): id is number => typeof id === 'number'),
        fetchedAt: now(),
      }
      idCache.set(channel, idsEntry)
    }

    const ids = idsEntry!.ids
    const pageIds = ids.slice(offset, offset + limit)
    let allItemsCached = true
    const items = await mapWithConcurrency(pageIds, ITEM_CONCURRENCY, async (id) => {
      const cached = payload.force ? undefined : itemCache.get(id)
      if (cached && now() - cached.fetchedAt < FEED_TTL_MS) return cached.story
      allItemsCached = false
      try {
        const item = await fetchJson<HnItemJson>(`${HN_API_BASE}/item/${id}.json`, fetchImpl)
        const story = mapHnItem(item)
        if (story) itemCache.set(id, { story, fetchedAt: now() })
        return story
      } catch {
        // 单条失败不应拖垮整页；跳过该条，其余照常展示。
        return null
      }
    })

    const stories = items.filter((story): story is HnStory => story !== null)
    return ok({
      channel,
      stories,
      fetchedAt: now(),
      cached: idsFromCache && allItemsCached,
      hasMore: ids.length > offset + limit,
    })
  } catch (cause) {
    return err({
      code: 'NETWORK_ERROR',
      message: `无法连接 Hacker News：${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
}
