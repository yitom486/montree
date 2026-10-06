// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { resolveWebDocSiteId } from '@montree/web-doc'
import { extractWebDocArticle } from '@/lib/reader/web-doc/web-doc-html'

describe('hrtt-news 华人头条资讯正文', () => {
  const pageUrl = 'https://www.52hrtt.com/klln/n/w/info/F1702965842341'

  // 真实版面骨架：导航碎片 div.content（无 id）会截胡通用 .content 选择器；
  // 真正文在 .news_section 内，同级 .comment / .recommended-column-box 须剥离。
  const html = `<!DOCTYPE html><html><head><title>掼蛋规则_卡罗莱纳_新闻_华人头条</title></head><body>
    <div id="app">
      <div class="content">华人号登录更多 关于我们联系方式下载App</div>
      <div class="content clearfloat" id="index_content">
        <div class="detail_left">分享 QQ空间 微信 微博</div>
        <div id="content_area">
          <div class="news_section copy-right">
            <div class="news_title"><h1>竞技掼蛋竞赛规则（试行）</h1><p>智媒新闻华人号2024-01-05</p></div>
            <div class="news-content info-content">
              <section><p>掼蛋是起源于中国江苏淮安的一种扑克牌游戏</p></section>
              <section><p>第二段正文内容<img src="https://picture01.52hrttpic.com/x.jpeg" /></p></section>
            </div>
          </div>
          <div class="comment">评论 (0条) 您需要登录后才能评论</div>
          <div class="recommended-column-box">推荐阅读某某新闻</div>
        </div>
        <div id="side_right">最新资讯某某标题</div>
      </div>
    </div>
  </body></html>`

  it('host 识别为 hrtt-news', () => {
    expect(resolveWebDocSiteId(pageUrl)).toBe('hrtt-news')
    expect(resolveWebDocSiteId('https://52hrtt.com/klln')).toBe('hrtt-news')
    expect(resolveWebDocSiteId('https://react.dev/learn')).toBe('generic-ssr')
  })

  it('取 .news_section 正文，不被导航碎片截胡', () => {
    const result = extractWebDocArticle(html, pageUrl, 'hrtt-news')

    expect(result.title).toBe('竞技掼蛋竞赛规则（试行）')
    expect(result.bodyHtml).toContain('掼蛋是起源于中国江苏淮安')
    expect(result.bodyHtml).toContain('第二段正文内容')
    expect(result.bodyHtml).not.toContain('关于我们联系方式')
    expect(result.bodyHtml).not.toContain('您需要登录后才能评论')
    expect(result.bodyHtml).not.toContain('推荐阅读')
    expect(result.bodyHtml).not.toContain('最新资讯')
  })

  it('.news_section 缺失时退到 .news-content', () => {
    const minimal = `<!DOCTYPE html><html><head><title>t</title></head><body>
      <div class="news-content info-content"><p>只有正文块</p></div>
    </body></html>`
    const result = extractWebDocArticle(minimal, pageUrl, 'hrtt-news')
    expect(result.bodyHtml).toContain('只有正文块')
  })
})
