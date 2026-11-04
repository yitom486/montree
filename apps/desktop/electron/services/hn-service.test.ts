import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearHnDiscussionCache,
  clearHnFeedCache,
  fetchHnFeed,
  findHnDiscussion,
  hnDomainFromUrl,
  mapHnItem,
} from './hn-service'

const API = 'https://hacker-news.firebaseio.com/v0'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('hn-service', () => {
  beforeEach(() => {
    clearHnFeedCache()
    clearHnDiscussionCache()
  })

  it('域名去掉 www，非法 URL 返回 null', () => {
    expect(hnDomainFromUrl('https://www.example.com/a')).toBe('example.com')
    expect(hnDomainFromUrl('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com')
    expect(hnDomainFromUrl(null)).toBeNull()
    expect(hnDomainFromUrl('not a url')).toBeNull()
  })

  it('映射条目并丢弃删除/死亡/无标题条目', () => {
    expect(
      mapHnItem({
        id: 42,
        title: 'Real story',
        url: 'https://www.example.com/post',
        score: 120,
        by: 'alice',
        time: 1_700_000_000,
        descendants: 33,
      }),
    ).toEqual({
      id: 42,
      title: 'Real story',
      url: 'https://www.example.com/post',
      domain: 'example.com',
      points: 120,
      author: 'alice',
      createdAt: 1_700_000_000,
      comments: 33,
      commentUrl: 'https://news.ycombinator.com/item?id=42',
      text: null,
    })

    expect(mapHnItem({ id: 1, title: 'gone', deleted: true })).toBeNull()
    expect(mapHnItem({ id: 2, title: 'dead', dead: true })).toBeNull()
    expect(mapHnItem({ id: 3 })).toBeNull()
    expect(mapHnItem(null)).toBeNull()
  })

  it('Ask HN 文本帖没有外链时 url 为空但保留正文与讨论地址', () => {
    const story = mapHnItem({
      id: 7,
      title: 'Ask HN: How do you test this?',
      text: '<p>body</p>',
      by: 'bob',
    })
    expect(story).toMatchObject({
      url: null,
      domain: null,
      text: '<p>body</p>',
      commentUrl: 'https://news.ycombinator.com/item?id=7',
    })
  })

  it('按频道 id 列表并发取 item，并在 TTL 内复用缓存', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target === `${API}/topstories.json`) return jsonResponse([1, 2, 3])
      if (target === `${API}/item/1.json`) return jsonResponse({ id: 1, title: 'One', score: 10 })
      if (target === `${API}/item/2.json`) return jsonResponse({ id: 2, title: 'Two', score: 20 })
      if (target === `${API}/item/3.json`) return jsonResponse({ id: 3, title: 'Three', score: 30 })
      throw new Error(`unexpected ${target}`)
    })

    const first = await fetchHnFeed(
      { channel: 'top', limit: 3 },
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 1_000 },
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.cached).toBe(false)
    expect(first.value.stories.map((story) => story.title)).toEqual(['One', 'Two', 'Three'])

    const second = await fetchHnFeed(
      { channel: 'top', limit: 2 },
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 2_000 },
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.cached).toBe(true)
    expect(second.value.stories.map((story) => story.title)).toEqual(['One', 'Two'])
    // 只回源了一次频道列表 + 三条 item
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('force 跳过缓存；单条失败不影响其余条目', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target === `${API}/newstories.json`) return jsonResponse([11, 12])
      if (target === `${API}/item/11.json`) return jsonResponse({ id: 11, title: 'Kept' })
      if (target === `${API}/item/12.json`) return jsonResponse({}, false, 500)
      throw new Error(`unexpected ${target}`)
    }) as unknown as typeof fetch

    const first = await fetchHnFeed({ channel: 'new', limit: 2 }, { fetchImpl })
    const second = await fetchHnFeed({ channel: 'new', limit: 2, force: true }, { fetchImpl })

    expect(first.ok && first.value.stories.map((s) => s.id)).toEqual([11])
    expect(second.ok && second.value.cached).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })

  it('超过 60 分钟缓存后才重新回源', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target === `${API}/askstories.json`) return jsonResponse([21])
      if (target === `${API}/item/21.json`) return jsonResponse({ id: 21, title: 'Cached' })
      throw new Error(`unexpected ${target}`)
    }) as unknown as typeof fetch

    await fetchHnFeed({ channel: 'ask', limit: 1 }, { fetchImpl, now: () => 0 })
    const stillFresh = await fetchHnFeed(
      { channel: 'ask', limit: 1 },
      { fetchImpl, now: () => 60 * 60_000 - 1 },
    )
    expect(stillFresh.ok && stillFresh.value.cached).toBe(true)

    const expired = await fetchHnFeed(
      { channel: 'ask', limit: 1 },
      { fetchImpl, now: () => 60 * 60_000 + 1 },
    )
    expect(expired.ok && expired.value.cached).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('按文章 URL 反查 HN 讨论并缓存结果', async () => {
    const articleUrl = 'https://example.com/post'
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('hn.algolia.com/api/v1/search')
      return jsonResponse({
        hits: [
          { objectID: '999', title: 'Similar but different', url: 'https://example.com/other', num_comments: 3 },
          { objectID: '42', title: 'Example post', url: articleUrl, num_comments: 120 },
        ],
      })
    }) as unknown as typeof fetch

    const first = await findHnDiscussion({ url: articleUrl }, { fetchImpl, now: () => 1_000 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value).toEqual({
      id: 42,
      url: 'https://news.ycombinator.com/item?id=42',
      comments: 120,
      title: 'Example post',
    })

    const second = await findHnDiscussion({ url: articleUrl }, { fetchImpl, now: () => 2_000 })
    expect(second.ok && second.value?.id).toBe(42)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('反查没有命中时缓存空结果，非法 URL 直接报错', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ hits: [{ objectID: '1', url: 'https://example.com/other' }] }),
    ) as unknown as typeof fetch

    const miss = await findHnDiscussion({ url: 'https://example.com/post' }, { fetchImpl })
    expect(miss.ok && miss.value).toBeNull()
    const again = await findHnDiscussion({ url: 'https://example.com/post' }, { fetchImpl })
    expect(again.ok && again.value).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const invalid = await findHnDiscussion({ url: 'not a url' }, { fetchImpl })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_ARGUMENT')
  })

  it('反查网络失败返回 NETWORK_ERROR', async () => {
    const failing = await findHnDiscussion(
      { url: 'https://example.com/post' },
      {
        fetchImpl: (async () => {
          throw new Error('offline')
        }) as unknown as typeof fetch,
      },
    )
    expect(failing.ok).toBe(false)
    if (!failing.ok) expect(failing.error.code).toBe('NETWORK_ERROR')
  })

  it('频道非法返回 INVALID_ARGUMENT，网络失败返回 NETWORK_ERROR', async () => {
    const invalid = await fetchHnFeed({ channel: 'unknown' as never })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_ARGUMENT')

    const failing = await fetchHnFeed(
      { channel: 'ask', force: true },
      {
        fetchImpl: (async () => {
          throw new Error('offline')
        }) as unknown as typeof fetch,
      },
    )
    expect(failing.ok).toBe(false)
    if (!failing.ok) {
      expect(failing.error.code).toBe('NETWORK_ERROR')
      expect(failing.error.message).toContain('offline')
    }
  })
})
