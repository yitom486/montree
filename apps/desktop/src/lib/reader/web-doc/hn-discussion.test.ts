// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { extractWebDocArticle } from './web-doc-html'
import { isHackerNewsItemUrl } from './hn-discussion'

const HN_URL = 'https://news.ycombinator.com/item?id=1'

const HN_FIXTURE = `<!DOCTYPE html><html><head><title>C++26 Disapproved | Hacker News</title></head><body>
<center><table id="hnmain"><tr id="bigbox"><td>
  <table class="fatitem">
    <tr class="athing" id="1"><td class="votelinks"><div class="votearrow"></div></td>
      <td class="title"><span class="titleline"><a href="https://andreasfertig.com/blog/cpp26/">C++26 Disapproved</a><span class="sitebit"> (<a href="from?site=andreasfertig.com"><span class="sitestr">andreasfertig.com</span></a>)</span></span></td></tr>
    <tr><td colspan="2"></td><td class="subtext"><span class="score">176 points</span> by <a href="user?id=thatxliner" class="hnuser">thatxliner</a> <span class="age"><a href="item?id=1">5 hours ago</a></span> | <a href="item?id=1">77&nbsp;comments</a></td></tr>
  </table>
  <table border="0" class="comment-tree">
    <tr class="athing comtr" id="2"><td><table><tr>
      <td class="ind" indent="0"><img src="s.gif" height="1" width="0"></td>
      <td class="default"><div><span class="comhead"><a href="user?id=alice" class="hnuser">alice</a> <span class="age"><a href="item?id=2">1 hour ago</a></span></span></div>
      <div class="comment"><div class="commtext">first comment isn’t broken</div><div class="reply">reply</div></div></td>
    </tr></table></td></tr>
    <tr class="athing comtr" id="3"><td><table><tr>
      <td class="ind" indent="1"><img src="s.gif" height="1" width="40"></td>
      <td class="default"><div><span class="comhead"><a href="user?id=bob" class="hnuser">bob</a> <span class="age"><a href="item?id=3">30 minutes ago</a></span></span></div>
      <div class="comment"><div class="commtext">nested reply</div></div></td>
    </tr></table></td></tr>
    <tr class="athing comtr" id="4"><td><table><tr>
      <td class="ind" indent="0"><img src="s.gif" height="1" width="0"></td>
      <td class="default"><div><span class="comhead"><a href="user?id=carol" class="hnuser">carol</a></span></div>
      <div class="comment"><div class="commtext">second root</div></div></td>
    </tr></table></td></tr>
  </table>
</td></tr></table></center>
</body></html>`

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('Hacker News 讨论页抽取', () => {
  it('只识别 item 页', () => {
    expect(isHackerNewsItemUrl(HN_URL)).toBe(true)
    expect(isHackerNewsItemUrl('https://news.ycombinator.com/news')).toBe(false)
    expect(isHackerNewsItemUrl('https://example.com/item?id=1')).toBe(false)
    expect(isHackerNewsItemUrl(undefined)).toBe(false)
  })

  it('移除 s.gif 占位图并保留标题、分数与原文链接', () => {
    const result = extractWebDocArticle(HN_FIXTURE, HN_URL)
    expect(result.title).toBe('C++26 Disapproved')
    expect(result.bodyHtml).not.toContain('s.gif')
    expect(result.bodyHtml).not.toContain('<img')
    expect(result.bodyHtml).not.toContain('y18.svg')
    expect(result.bodyHtml).toContain('https://andreasfertig.com/blog/cpp26/')

    const doc = parse(result.bodyHtml)
    expect(doc.querySelector('.hn-story-title')?.textContent).toBe('C++26 Disapproved')
    expect(doc.querySelector('.hn-story-meta')?.textContent).toContain('176 points')
  })

  it('按 indent 还原评论层级，而不是压平成一串', () => {
    const result = extractWebDocArticle(HN_FIXTURE, HN_URL)
    const doc = parse(result.bodyHtml)

    expect(doc.querySelectorAll('.hn-comment')).toHaveLength(3)
    expect(doc.querySelectorAll('.hn-comments > .hn-comment')).toHaveLength(2)

    const first = doc.querySelectorAll('.hn-comment')[0]!
    expect(first.querySelector('.hn-comment-author')?.textContent).toBe('alice')
    expect(first.querySelector('.hn-comment-body')?.textContent).toContain("first comment isn't broken")
    expect(first.querySelector('.hn-comment-body')?.firstElementChild?.tagName).toBe('P')
    expect(first.querySelectorAll(':scope > .hn-comment-children > .hn-comment')).toHaveLength(1)
    expect(first.querySelector('.hn-comment-children')?.textContent).toContain('nested reply')
    expect(doc.querySelector('.reply')).toBeNull()

    // 顶层评论生成带锚点的大纲标题，嵌套回复不进入目录
    const roots = doc.querySelectorAll('.hn-comments > .hn-comment')
    expect(roots[0]!.querySelector('h3.hn-comment-heading')?.id).toBe('hn-comment-2')
    expect(roots[0]!.querySelector('h3.hn-comment-heading')?.textContent).toBe('alice 1 hour ago')
    expect(roots[1]!.querySelector('h3.hn-comment-heading')?.id).toBe('hn-comment-4')
    expect(first.querySelector('.hn-comment-children .hn-comment h3')).toBeNull()
  })
})
