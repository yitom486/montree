// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { detectDiscussionLink, identifyDiscussionProvider } from './discussion-link'

const ARTICLE_URL = 'https://example.com/blog/cpp26'

describe('discussion-link', () => {
  it('识别已知讨论站并忽略普通页面', () => {
    expect(identifyDiscussionProvider('https://news.ycombinator.com/item?id=42')).toEqual({
      source: 'Hacker News',
      url: 'https://news.ycombinator.com/item?id=42',
    })
    expect(identifyDiscussionProvider('https://www.reddit.com/r/cpp/comments/abc/title/')).toMatchObject({
      source: 'Reddit',
    })
    expect(identifyDiscussionProvider('https://lobste.rs/s/abc/title')).toMatchObject({
      source: 'Lobsters',
    })
    expect(identifyDiscussionProvider('https://github.com/org/repo/discussions/12')).toMatchObject({
      source: 'GitHub Discussions',
    })
    expect(identifyDiscussionProvider('https://news.ycombinator.com/news')).toBeNull()
    expect(identifyDiscussionProvider('https://example.com/comments')).toBeNull()
  })

  it('从文章 HTML 中发现 HN 讨论链接，并解析相对地址', () => {
    const html = `
      <article>正文</article>
      <footer>
        <a href="https://news.ycombinator.com/item?id=50360164">Discuss on HN</a>
      </footer>`
    expect(detectDiscussionLink(html, ARTICLE_URL)).toEqual({
      source: 'Hacker News',
      url: 'https://news.ycombinator.com/item?id=50360164',
    })
  })

  it('跳过指向当前页自身的讨论链接', () => {
    const self = 'https://news.ycombinator.com/item?id=42'
    const html = '<a href="https://news.ycombinator.com/item?id=42">comments</a>'
    expect(detectDiscussionLink(html, self)).toBeNull()
  })

  it('没有讨论链接时返回 null', () => {
    expect(detectDiscussionLink('<a href="/about">About</a>', ARTICLE_URL)).toBeNull()
    expect(detectDiscussionLink('', ARTICLE_URL)).toBeNull()
  })
})
