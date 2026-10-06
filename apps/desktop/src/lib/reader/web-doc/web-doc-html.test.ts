// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  buildWebDocReaderDocument,
  extractDocumentTitle,
  extractWebDocArticle,
  rewriteRelativeUrls,
  sanitizeWebDocBodyHtml,
} from './web-doc-html'

describe('web-doc-html', () => {
  it('优先从 article 提取正文并改写相对链接', () => {
    const html = `<!DOCTYPE html><html><head><title>Site</title></head><body>
      <nav>skip</nav>
      <article>
        <h1>Hello React</h1>
        <p>See <a href="/learn">learn</a> and <img src="/icon.png" alt="icon" /></p>
      </article>
    </body></html>`

    const result = extractWebDocArticle(html, 'https://react.dev/learn')
    expect(result.title).toBe('Hello React')
    expect(result.bodyHtml).toContain('https://react.dev/learn')
    expect(result.bodyHtml).toContain('https://react.dev/icon.png')
    expect(result.bodyHtml).not.toContain('<nav')
  })

  it('无 article 时回退 main 或 body', () => {
    const html = `<html><head><title>Fallback</title></head><body><main><p>Body text</p></main></body></html>`
    const result = extractWebDocArticle(html, 'https://example.com/docs')
    expect(extractDocumentTitle(new DOMParser().parseFromString(html, 'text/html'))).toBe('Fallback')
    expect(result.bodyHtml).toContain('Body text')
  })

  it('消毒时移除 script', () => {
    const sanitized = sanitizeWebDocBodyHtml('<p>ok</p><script>alert(1)</script>')
    expect(sanitized).toContain('ok')
    expect(sanitized).not.toContain('script')
  })

  it('剥离表单与插件标签（我方门控逻辑，与 DOM 无关）', () => {
    // 说明：happy-dom 下 DOMPurify 属性级行为失真（连正常 https 链接都会被整标签剥离），
    // 属性级 javascript:/on* 断言只在真实 Chromium（e2e）中有效；此处锁定标签级门控。
    const sanitized = sanitizeWebDocBodyHtml(
      '<form action="https://evil.example/submit"><input type="text" /></form>' +
        '<object data="evil.swf"></object><embed src="evil.swf" /><p>正文</p>',
    )
    expect(sanitized).not.toContain('<form')
    expect(sanitized).not.toContain('<object')
    expect(sanitized).not.toContain('<embed')
    expect(sanitized).toContain('正文')
  })

  it('rewriteRelativeUrls 保留 hash 链接', () => {
    const root = document.createElement('div')
    root.innerHTML = '<a href="#intro">intro</a>'
    rewriteRelativeUrls(root, 'https://react.dev/learn')
    expect(root.querySelector('a')?.getAttribute('href')).toBe('#intro')
  })

  it('剥离 MkDocs「编辑此页」图标按钮', () => {
    const html = `<!DOCTYPE html><html><body>
      <article class="md-content__inner md-typeset">
        <a href="https://github.com/krahets/hello-algo/tree/main/docs/x.md"
           title="编辑此页" class="md-content__button md-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M1"/></svg>
        </a>
        <h1>14.1 初探动态规划</h1>
        <p>正文段落</p>
        <p><img src="/assets/dp.png" alt="动态规划示意图" /></p>
      </article>
    </body></html>`

    const result = extractWebDocArticle(
      html,
      'https://www.hello-algo.com/chapter_dynamic_programming/intro_to_dynamic_programming/',
      'generic-ssr',
    )
    expect(result.bodyHtml).toContain('14.1 初探动态规划')
    expect(result.bodyHtml).toContain('正文段落')
    expect(result.bodyHtml).toContain('动态规划示意图')
    expect(result.bodyHtml).not.toContain('编辑此页')
    expect(result.bodyHtml).not.toContain('md-content__button')
    expect(result.bodyHtml).not.toContain('viewBox="0 0 512 512"')
  })

  it('react.dev 页头控件会被剥离', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <div class="flex justify-between items-start">
        <div class="flex-1">
          <a href="/learn">Learn React</a>
        </div>
        <button><span>Copy page</span><span>Copy</span></button>
      </div>
      <h1>Quick Start<a aria-label="Link for this heading" href="#quick-start">#</a></h1>
      <p>Body</p>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://react.dev/learn', 'generic-ssr')
    expect(result.bodyHtml).toContain('Quick Start')
    expect(result.bodyHtml).toContain('Body')
    expect(result.bodyHtml).not.toContain('Copy page')
    expect(result.bodyHtml).not.toContain('Learn React')
    expect(result.bodyHtml).not.toContain('aria-label="Link for this heading"')
  })

  it('保留 MDX ResponseField 的字段名与行内代码类型，并剥离 h4 标题锚点', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <h4>Authentication Capabilities<a aria-label="Link for this heading" href="#authentication-capabilities">
        <svg viewBox="0 0 24 24"><path d="M1" /></svg>
      </a></h4>
      <div class="response-field">
        <button>logout</button>
        <code>LogoutCapabilities Object</code>
        <p>The <a href="/protocol/v1/authentication#logging-out"><code>logout</code></a> method is available.</p>
      </div>
      <button aria-label="Copy page">Copy page</button>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://agentclientprotocol.com/protocol/v1/initialization')
    expect(result.bodyHtml).toContain('Authentication Capabilities')
    expect(result.bodyHtml).toContain('logout')
    expect(result.bodyHtml).toContain('<code>LogoutCapabilities Object</code>')
    expect(result.bodyHtml).not.toContain('<button')
    expect(result.bodyHtml).not.toContain('aria-label="Link for this heading"')
    expect(result.bodyHtml).not.toContain('viewBox="0 0 24 24"')
    expect(result.bodyHtml).not.toContain('Copy page')
  })

  it('在线文档阅读器为行内 code 与降级字段名注入独立样式', () => {
    const document = buildWebDocReaderDocument(
      {
        title: 'Initialization',
        bodyHtml:
          '<p><span class="web-doc-semantic-control">logout</span> <code>LogoutCapabilities Object</code></p>',
        baseUrl: 'https://agentclientprotocol.com/protocol/v1/initialization',
      },
      'dark',
    )

    expect(document).toContain('body code')
    expect(document).toContain('background: #27272a')
    expect(document).toContain('.web-doc-semantic-control')
    expect(document).toContain('body pre code')
  })

  it('Mintlify 嵌套卡片把布局和导航提升到外层语义节点', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <div class="card" role="link" tabindex="0" aria-labelledby="learn-more">
        <div class="px-6 py-5" data-component-part="card-content-container">
          <a href="/protocol/v1/elicitation" aria-hidden="true" tabindex="-1" style="display: contents;">
            <div class="absolute"><svg viewBox="0 0 18 18"><path d="M1" /></svg></div>
            <div data-component-part="card-icon"><svg viewBox="0 0 24 24"><path d="M1" /></svg></div>
            <div class="w-full"><div id="learn-more" data-component-part="card-content"><span>Learn more about Elicitation</span></div></div>
          </a>
        </div>
      </div>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://agentclientprotocol.com/protocol/v1/initialization')
    expect(result.bodyHtml).toContain('web-doc-card')
    expect(result.bodyHtml).toContain('web-doc-card-with-container')
    expect(result.bodyHtml).toContain(`data-montree-source-href="/protocol/v1/elicitation"`)
    expect(result.bodyHtml).toContain('web-doc-card-content-wrap')

    const readerDocument = buildWebDocReaderDocument(
      {
        title: 'Initialization',
        bodyHtml: result.bodyHtml,
        baseUrl: 'https://agentclientprotocol.com/protocol/v1/initialization',
      },
      'dark',
    )
    expect(readerDocument).toContain(
      'data-montree-href="https://agentclientprotocol.com/protocol/v1/elicitation"',
    )
    expect(readerDocument).not.toContain('data-montree-source-href')
    expect(readerDocument).toContain('data-component-part="card-content-container"')
    expect(readerDocument).toContain('<main class="web-doc-reader-content">')
    expect(readerDocument).toContain('</main>')

    expect(readerDocument).toContain('tabindex="-1"')
  })

  it('最终生成 srcdoc 时也能修复尚未归一化的旧卡片片段', () => {
    const readerDocument = buildWebDocReaderDocument(
      {
        title: 'Initialization',
        bodyHtml: `<div role="link" tabindex="0">
          <div data-component-part="card-content-container">
            <a href="/protocol/v1/elicitation" aria-hidden="true" style="display: contents;">
              <div class="absolute"><svg viewBox="0 0 18 18"><path d="M1" /></svg></div>
              <div data-component-part="card-icon"><svg viewBox="0 0 24 24"><path d="M1" /></svg></div>
              <div><div data-component-part="card-content"><span>Learn more</span></div></div>
            </a>
          </div>
        </div>`,
        baseUrl: 'https://agentclientprotocol.com/protocol/v1/initialization',
      },
      'dark',
    )

    expect(readerDocument).toContain('web-doc-card-with-container')
    expect(readerDocument).toContain(
      'data-montree-href="https://agentclientprotocol.com/protocol/v1/elicitation"',
    )
    expect(readerDocument).not.toContain('data-montree-source-href')
  })

  it('把原生 hr、Tailwind 边界类与 inline border 归一化为通用分割线类', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <div class="field border-gray-50 border-b"><p>第一组</p></div>
      <div style="border-top: 1px solid #eee"><p>第二组</p></div>
      <div class="divide-y"><div>第三组</div><div>第四组</div></div>
      <hr />
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://example.com/docs')
    expect(result.bodyHtml).toContain('web-doc-divider-after')
    expect(result.bodyHtml).toContain('web-doc-divider-block')
    expect(result.bodyHtml).toContain('web-doc-divider-before')
    expect(result.bodyHtml).toContain('web-doc-divider-group')
    expect(result.bodyHtml).toContain('web-doc-divider')

    const document = buildWebDocReaderDocument(
      { title: 'Divider', bodyHtml: result.bodyHtml, baseUrl: 'https://example.com/docs' },
      'dark',
    )
    expect(document).toContain('.web-doc-divider-after')
    expect(document).toContain('.web-doc-divider-block.web-doc-divider-after')
    expect(document).toContain('.web-doc-divider-group > * + *')
    expect(document).toContain('hr.web-doc-divider')
  })

  it('人民日报电子版仅提取 .article 正文', () => {    const html = `<!DOCTYPE html><html><head><title> 测试标题 </title></head><body>
      <div class="main w1000">
        <div class="paper-box">
          <img usemap="#PagePicMap" src="paper.jpg" />
          <map name="PagePicMap"><area href="content_30178365.html"></map>
        </div>
        <ul class="news-list"><li><a href="content_30178365.html">下一篇</a></li></ul>
        <div class="article">
          <h1><p> 测试标题 </p></h1>
          <div id="ozoom"><p>正文段落</p></div>
        </div>
      </div>
    </body></html>`
    const pageUrl = 'https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178364.html'
    const result = extractWebDocArticle(html, pageUrl, 'people-daily-paper')

    expect(result.title).toContain('测试标题')
    expect(result.bodyHtml).toContain('正文段落')
    expect(result.bodyHtml).not.toContain('paper-box')
    expect(result.bodyHtml).not.toContain('news-list')
    expect(result.bodyHtml).not.toContain('<area')
  })

  it('导航碎片截胡时密度兜底选中正文块', () => {
    const longParagraph = '正文段落内容。'.repeat(400)
    const html = `<!DOCTYPE html><html><head><title>News</title></head><body>
      <div class="content">登录更多 关于我们联系方式下载App</div>
      <header>站点头部导航链接</header>
      <div class="news_section">
        <h1>文章标题</h1>
        <div class="news-content"><section><p>${longParagraph}</p></section></div>
      </div>
      <div class="comment">请登录后评论</div>
    </body></html>`

    const result = extractWebDocArticle(html, 'https://example.com/news/1', 'generic-ssr')
    expect(result.title).toBe('文章标题')
    expect(result.bodyHtml).toContain('正文段落内容')
    expect(result.bodyHtml).not.toContain('关于我们联系方式')
    expect(result.bodyHtml).not.toContain('请登录后评论')
  })

  it('短页面不受密度兜底影响（保持原赢家）', () => {
    const html = `<!DOCTYPE html><html><head><title>Short</title></head><body>
      <article><h1>短文</h1><p>只有一百来字的内容。</p></article>
    </body></html>`

    const result = extractWebDocArticle(html, 'https://example.com/s', 'generic-ssr')
    expect(result.bodyHtml).toContain('只有一百来字的内容')
  })

  it('无选择器命中时链接农场不敌正文块', () => {
    const farmLinks = Array.from(
      { length: 80 },
      (_, i) => `<a href="/n${i}">推荐阅读标题条目${i}</a>`,
    ).join('')
    const prose = '正经文章段落。'.repeat(200)
    const html = `<!DOCTYPE html><html><head><title>Mix</title></head><body>
      <div class="sidebar">${farmLinks}</div>
      <div class="story"><p>${prose}</p></div>
    </body></html>`

    const result = extractWebDocArticle(html, 'https://example.com/mix', 'generic-ssr')
    expect(result.bodyHtml).toContain('正经文章段落')
    expect(result.bodyHtml).not.toContain('推荐阅读标题条目')
  })
})
