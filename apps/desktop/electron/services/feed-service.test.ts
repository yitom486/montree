import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearFeedCache,
  fetchFeed,
  mapLobstersStory,
  parseFeedXml,
} from './feed-service'

function textResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Response
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

describe('feed-service', () => {
  beforeEach(() => {
    clearFeedCache()
  })

  it('映射 Lobsters 条目（外链/文本帖/域名）', () => {
    expect(
      mapLobstersStory({
        short_id: 'abc',
        title: 'Death comes for XSLT',
        url: 'https://www.example.com/post',
        score: 76,
        submitter_user: 'nytpu',
        created_at: '2026-11-03T23:19:50.214+08:00',
        comment_count: 65,
        comments_url: 'https://lobste.rs/s/abc/death_comes_for_xslt',
      }),
    ).toMatchObject({
      id: 'abc',
      source: 'lobsters',
      title: 'Death comes for XSLT',
      domain: 'example.com',
      points: 76,
      comments: 65,
      discussionUrl: 'https://lobste.rs/s/abc/death_comes_for_xslt',
    })

    expect(
      mapLobstersStory({ short_id: 'xyz', title: 'Text post', submitter_user: 'alice' }),
    ).toMatchObject({
      url: null,
      discussionUrl: 'https://lobste.rs/s/xyz',
    })
    expect(mapLobstersStory({ short_id: 'no-title' })).toBeNull()
  })

  it('解析 RSS 2.0：相对链接、作者、时间', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
        <item>
          <title>RSS post</title>
          <link>/posts/1</link>
          <guid>post-1</guid>
          <dc:creator>alice</dc:creator>
          <pubDate>Wed, 04 Nov 2026 10:41:10 +0800</pubDate>
        </item>
      </channel></rss>`
    const items = parseFeedXml(xml, 'https://example.com/feed', 10)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'post-1',
      source: 'rss',
      title: 'RSS post',
      url: 'https://example.com/posts/1',
      domain: 'example.com',
      author: 'alice',
      comments: 0,
    })
    expect(items[0]!.createdAt).toBeGreaterThan(0)
  })

  it('解析 Atom：alternate link 与 author/name', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Atom post</title>
          <link rel="alternate" href="https://example.com/atom-post" />
          <id>tag:example.com,2026:1</id>
          <author><name>bob</name></author>
          <updated>2026-11-04T10:00:00Z</updated>
        </entry>
      </feed>`
    const items = parseFeedXml(xml, 'https://example.com/feed.xml', 10)
    expect(items[0]).toMatchObject({
      title: 'Atom post',
      url: 'https://example.com/atom-post',
      author: 'bob',
      id: 'tag:example.com,2026:1',
    })
  })

  it('Lobsters 频道缓存 60 分钟，force 强制回源', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          short_id: 'abc',
          title: 'Story',
          url: 'https://example.com/post',
          score: 1,
          submitter_user: 'alice',
          created_at: '2026-11-04T10:00:00Z',
          comment_count: 2,
          comments_url: 'https://lobste.rs/s/abc',
        },
      ]),
    ) as unknown as typeof fetch

    const first = await fetchFeed(
      { source: 'lobsters', channel: 'hottest', limit: 5 },
      { fetchImpl, now: () => 1_000 },
    )
    expect(first.ok && first.value.cached).toBe(false)
    const second = await fetchFeed(
      { source: 'lobsters', channel: 'hottest', limit: 5 },
      { fetchImpl, now: () => 2_000 },
    )
    expect(second.ok && second.value.cached).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const forced = await fetchFeed(
      { source: 'lobsters', channel: 'hottest', limit: 5, force: true },
      { fetchImpl, now: () => 3_000 },
    )
    expect(forced.ok && forced.value.cached).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('未知频道与网络错误返回明确错误', async () => {
    const bad = await fetchFeed({ source: 'lobsters', channel: 'top' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('INVALID_ARGUMENT')

    const failing = await fetchFeed(
      { source: 'lobsters', channel: 'newest' },
      {
        fetchImpl: (async () => {
          throw new Error('offline')
        }) as unknown as typeof fetch,
      },
    )
    expect(failing.ok).toBe(false)
    if (!failing.ok) expect(failing.error.code).toBe('NETWORK_ERROR')
  })

  it('RSS 频道按订阅地址抓取并解析', async () => {
    const fetchImpl = vi.fn(async () =>
      textResponse(
        `<rss version="2.0"><channel><item><title>Hello</title><link>https://example.com/hello</link></item></channel></rss>`,
      ),
    ) as unknown as typeof fetch
    const result = await fetchFeed(
      { source: 'rss', channel: 'sspai', limit: 5 },
      { fetchImpl },
    )
    expect(result.ok && result.value.items[0]?.title).toBe('Hello')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://sspai.com/feed',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })
})
