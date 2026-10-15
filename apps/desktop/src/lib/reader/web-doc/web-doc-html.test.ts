// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  buildWebDocPlaygroundRuntimeScript,
  buildWebDocReaderDocument,
  extractDocumentTitle,
  extractWebDocArticle,
  rewriteRelativeUrls,
  sanitizeWebDocBodyHtml,
} from './web-doc-html'
import { normalizeWebDocImageObjects } from './web-doc-embeds'

describe('web-doc-html', () => {
  it('arXiv SVG object 在插件清洗前转为图片并保留图注', () => {
    const html = `<article><h1>Paper</h1><figure id="S3.F1">
      <object type="image/svg+xml" data="2609.22978v1/arch.svg" width="476" height="291"></object>
      <figcaption>Figure 1: Architecture</figcaption></figure></article>`
    const result = extractWebDocArticle(html, 'https://arxiv.org/html/2609.22978v1')
    expect(result.bodyHtml).toContain('https://arxiv.org/html/2609.22978v1/arch.svg')
    expect(result.bodyHtml).toContain('web-doc-object-image')
    expect(result.bodyHtml).toContain('Figure 1: Architecture')
    expect(result.bodyHtml).not.toContain('<object')
  })

  it('图片 object 只复制显示属性，不保留插件事件或任意协议', () => {
    const root = document.createElement('div')
    root.innerHTML = `<object id="diagram" type="image/svg+xml" data="/plot.svg" width="476"
      onload="alert(1)" style="display:none"></object>
      <object type="image/svg+xml" data="javascript:alert(1)"></object>
      <object type="image/svg+xml" data="file:///private.svg"></object>
      <object type="text/html" data="/active.html"></object>`
    normalizeWebDocImageObjects(root, 'https://example.com/paper')
    const image = root.querySelector('img')!
    expect(image.getAttribute('src')).toBe('https://example.com/plot.svg')
    expect(image.id).toBe('diagram')
    expect(image.getAttribute('width')).toBe('476')
    expect(image.hasAttribute('onload')).toBe(false)
    expect(image.hasAttribute('style')).toBe(false)
    expect(root.querySelectorAll('img')).toHaveLength(1)
    expect(sanitizeWebDocBodyHtml(root.innerHTML)).not.toContain('<object')
  })

  it('论文表格保留合并单元格与对齐类，重复构建不会嵌套滚动容器', () => {
    const content = {
      title: 'Paper', baseUrl: 'https://example.com/paper',
      bodyHtml: `<figure><figcaption>Table 1: Results</figcaption><table><tbody>
        <tr><th rowspan="2">Metric</th><td class="ltx_align_center ltx_border_tt">●◐○</td></tr>
        <tr><td colspan="2">Merged</td></tr></tbody></table></figure>`,
    }
    const first = new DOMParser().parseFromString(buildWebDocReaderDocument(content, 'dark'), 'text/html')
    expect(first.querySelectorAll('.web-doc-table-scroll')).toHaveLength(1)
    expect(first.querySelector('th')?.getAttribute('rowspan')).toBe('2')
    expect(first.querySelector('td[colspan]')?.getAttribute('colspan')).toBe('2')
    expect(first.querySelector('td.ltx_align_center')?.textContent).toBe('●◐○')
    const second = new DOMParser().parseFromString(buildWebDocReaderDocument({
      ...content, bodyHtml: first.body.innerHTML,
    }, 'dark'), 'text/html')
    expect(second.querySelectorAll('.web-doc-table-scroll')).toHaveLength(1)
  })

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

  it('通过 Mozilla Readability 智能自适应提取深层嵌套网页正文', () => {
    const longArticle = '这是深度报道正文。'.repeat(150)
    const html = `<!DOCTYPE html><html><head><title>深度科技文章</title></head><body>
      <nav class="custom-nav"><a href="/">首页</a><a href="/about">关于</a></nav>
      <div class="unusual-wrapper-abc">
        <div class="deep-nested-zone">
          <p>${longArticle}</p>
        </div>
      </div>
      <footer class="custom-footer">Copyright 2026</footer>
    </body></html>`

    const result = extractWebDocArticle(html, 'https://tech.example.com/deep', 'generic-ssr')
    expect(result.bodyHtml).toContain('这是深度报道正文')
    expect(result.bodyHtml).not.toContain('custom-nav')
    expect(result.bodyHtml).not.toContain('custom-footer')
  })

  it('Mintlify 页面剥离底部页脚超大 Logo、打分反馈与翻页噪音', () => {
    const html = `<!DOCTYPE html><html><body><main>
      <h1>Agent Client Protocol</h1>
      <p>Introduction content.</p>
      <div class="feedback-toolbar">
        <span>Was this page helpful?</span>
        <button>Yes</button>
        <button>No</button>
        <input placeholder="Ask a question..." />
      </div>
      <nav id="pagination">
        <a href="/protocol/v1/overview">Next: Protocol Overview</a>
      </nav>
      <footer id="footer">
        <a href="https://mintlify.com/preview">
          Powered by
          <svg width="1274" height="367" viewBox="0 0 1274 367"><path d="M1" /></svg>
        </a>
      </footer>
    </main></body></html>`

    const result = extractWebDocArticle(html, 'https://agentclientprotocol.com/get-started/introduction')
    expect(result.bodyHtml).toContain('Agent Client Protocol')
    expect(result.bodyHtml).toContain('Introduction content.')
    expect(result.bodyHtml).not.toContain('feedback-toolbar')
    expect(result.bodyHtml).not.toContain('Was this page helpful?')
    expect(result.bodyHtml).not.toContain('pagination')
    expect(result.bodyHtml).not.toContain('Next: Protocol Overview')
    expect(result.bodyHtml).not.toContain('footer')
    expect(result.bodyHtml).not.toContain('width="1274"')
    expect(result.bodyHtml).not.toContain('Powered by')
  })

  it('Mintlify Callout 提示卡片标准化并注入主题样式', () => {
    const html = `<!DOCTYPE html><html><body><main>
      <h1>Document</h1>
      <div role="note" class="callout" data-callout-type="info">
        <div data-component-part="callout-icon">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
        </div>
        <div data-component-part="callout-content">
          <p>This is an important info callout.</p>
        </div>
      </div>
    </main></body></html>`

    const result = extractWebDocArticle(html, 'https://agentclientprotocol.com/get-started/introduction')
    expect(result.bodyHtml).toContain('web-doc-callout')
    expect(result.bodyHtml).toContain('web-doc-callout-info')
    expect(result.bodyHtml).toContain('web-doc-callout-with-icon')
    expect(result.bodyHtml).toContain('web-doc-callout-icon')
    expect(result.bodyHtml).toContain('web-doc-callout-content')
    expect(result.bodyHtml).toContain('This is an important info callout.')

    const readerDocument = buildWebDocReaderDocument(
      {
        title: 'Document',
        bodyHtml: result.bodyHtml,
        baseUrl: 'https://agentclientprotocol.com/get-started/introduction',
      },
      'dark',
    )
    expect(readerDocument).toContain('.web-doc-callout')
    expect(readerDocument).toContain('.web-doc-callout-info')
    expect(readerDocument).toContain('border-left-color: #60a5fa')
  })

  it('常见文档站无明确 component-part 的警告框能自适应归集图标与内容', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <h1>Warning Test</h1>
      <div class="custom-block warning" data-callout="warning">
        <svg viewBox="0 0 24 24"><polygon points="12,2 22,22 2,22" /></svg>
        <p>First warning paragraph.</p>
        <p>Second warning paragraph.</p>
      </div>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://example.com/guide')
    expect(result.bodyHtml).toContain('web-doc-callout')
    expect(result.bodyHtml).toContain('web-doc-callout-warning')
    expect(result.bodyHtml).toContain('web-doc-callout-with-icon')
    expect(result.bodyHtml).toContain('web-doc-callout-icon')
    expect(result.bodyHtml).toContain('web-doc-callout-content')
    expect(result.bodyHtml).toContain('First warning paragraph.')
    expect(result.bodyHtml).toContain('Second warning paragraph.')
  })

  it('react.dev 的 Next.js 响应式图片 srcset 与 source 改写为完整绝对路径', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <h1>Sharing data</h1>
      <picture>
        <source srcset="/_next/image?url=%2Fpic.png&w=640 1x, /_next/image?url=%2Fpic.png&w=828 2x" />
        <img src="/_next/image?url=%2Fpic.png&w=828" srcset="/_next/image?url=%2Fpic.png&w=640 1x, /_next/image?url=%2Fpic.png&w=828 2x" alt="Diagram" />
      </picture>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://react.dev/learn')
    expect(result.bodyHtml).toContain('src="https://react.dev/_next/image?url=%2Fpic.png&amp;w=828"')
    expect(result.bodyHtml).toContain('srcset="https://react.dev/_next/image?url=%2Fpic.png&amp;w=640 1x, https://react.dev/_next/image?url=%2Fpic.png&amp;w=828 2x"')
    expect(result.bodyHtml).not.toContain('srcset="/_next/image')
  })

  it('在线文档阅读器在暗色模式下隐藏 .light-image、在浅色模式下隐藏 .dark-image', () => {
    const content = {
      title: 'Sharing data',
      baseUrl: 'https://react.dev/learn',
      bodyHtml: '<div class="dark-image"><img src="https://react.dev/dark.png" /></div><div class="light-image"><img src="https://react.dev/light.png" /></div>',
    }

    const darkDoc = buildWebDocReaderDocument(content, 'dark')
    expect(darkDoc).not.toContain('<base href=')
    expect(darkDoc).toContain('body .light-image')
    expect(darkDoc).toContain('display: none !important')

    const lightDoc = buildWebDocReaderDocument(content, 'light')
    expect(lightDoc).not.toContain('<base href=')
    expect(lightDoc).toContain('body .dark-image')
    expect(lightDoc).toContain('display: none !important')
  })

  it('React 官方文档等多图对照 figure 容器归一化为横向并排 .web-doc-figure-row', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <h2>Sharing data between components</h2>
      <div class="flex flex-col sm:flex-row py-2 sm:p-0 justify-center items-start sm:items-center w-full">
        <figure class="flex flex-col px-0 p-0 sm:p-10 justify-center items-center">
          <img src="/fig1.png" alt="fig1" />
          <figcaption><p>Initially, each MyButton's count state is 0</p></figcaption>
        </figure>
        <figure class="flex flex-col px-0 p-0 sm:p-10 justify-center items-center">
          <img src="/fig2.png" alt="fig2" />
          <figcaption><p>The first MyButton updates its count to 1</p></figcaption>
        </figure>
      </div>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://react.dev/learn')
    expect(result.bodyHtml).toContain('web-doc-figure-row')
    expect(result.bodyHtml).toContain('web-doc-figure-item')

    const doc = buildWebDocReaderDocument({ title: 'Test', bodyHtml: result.bodyHtml, baseUrl: 'https://react.dev/learn' }, 'dark')
    expect(doc).toContain('.web-doc-figure-row')
    expect(doc).toContain('display: flex !important')
  })

  it('Mintlify 透明链单图提升为独立 figure（ACP 架构图形态）', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <h2>Setup</h2>
      <span data-as="p">Each connection can support several concurrent sessions.</span>
      <div class="mdx-content"><span data-ramka-trigger="" class="zoom-image-trigger contents cursor-zoom-in"><span class="contents"><picture class="contents"><img data-path="images/server-client.svg" src="https://mintcdn.com/x/server-client.svg" alt="Server Client setup" class="object-contain" width="579" height="455" /></picture></span></span></div>
      <span data-as="p">ACP makes heavy use of JSON-RPC notifications.</span>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://agentclientprotocol.com/get-started/architecture')
    const root = document.createElement('div')
    root.innerHTML = result.bodyHtml
    const img = root.querySelector('img[src*="server-client"]')!
    expect(img).not.toBeNull()
    // 链整体装进 figure，缩放触发器与 picture 原样保留在内
    const figure = img.closest('figure.web-doc-figure')
    expect(figure).not.toBeNull()
    expect(figure!.querySelector('[data-ramka-trigger]')).not.toBeNull()
    expect(figure!.querySelector('picture')).not.toBeNull()
    expect(img.getAttribute('width')).toBe('579')
    expect(img.getAttribute('alt')).toBe('Server Client setup')
    // 前后正文仍在 figure 之外（图不再跟文字缠在一起）
    expect(root.textContent).toContain('several concurrent sessions')
    expect(root.textContent).toContain('JSON-RPC notifications')

    const doc = buildWebDocReaderDocument({ title: 'T', bodyHtml: result.bodyHtml, baseUrl: 'https://agentclientprotocol.com/' }, 'dark')
    expect(doc).toContain('figure.web-doc-figure img')
  })

  it('行内小图不动，已有 figure 不套娃', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <p>点击 <img src="/icon.png" alt="icon" /> 继续阅读下文。</p>
      <figure><img src="/real.png" alt="real" /><figcaption>实图</figcaption></figure>
      <p><img src="/solo.png" alt="solo" /></p>
    </article></body></html>`
    const result = extractWebDocArticle(html, 'https://example.com/a')
    const root = document.createElement('div')
    root.innerHTML = result.bodyHtml
    // 行内图标：无 figure 祖先
    expect(root.querySelector('img[src*="icon.png"]')!.closest('figure')).toBeNull()
    // 已有 figure：不嵌套
    const real = root.querySelector('img[src*="real.png"]')!
    expect(real.closest('figure')!.querySelectorAll('figure')).toHaveLength(0)
    expect(real.closest('figure')!.querySelector('figcaption')?.textContent).toBe('实图')
    // p 独占图：p 被替换为 figure（id 保留逻辑见实现）
    const solo = root.querySelector('img[src*="solo.png"]')!
    expect(solo.closest('figure.web-doc-figure')).not.toBeNull()
    expect(root.querySelector('p > figure')).toBeNull()
  })

  it('纯图链接整体装进 figure，追踪像素跳过', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <p>下面这张架构图值得细看，它展示了客户端与服务端的关系。</p>
      <p><a href="https://example.com/big"><img src="/big.png" alt="big" /></a></p>
      <p>看完图之后，我们继续讨论剩下的文本内容，保证段落足够长。</p>
      <img src="/px.gif" alt="" width="1" height="1" />
    </article></body></html>`
    const result = extractWebDocArticle(html, 'https://example.com/a')
    const root = document.createElement('div')
    root.innerHTML = result.bodyHtml
    const big = root.querySelector('img[src*="big.png"]')!
    const figure = big.closest('figure.web-doc-figure')!
    expect(figure).not.toBeNull()
    // 链接不断：figure 包住整个 a
    expect(figure.querySelector('a[href="https://example.com/big"]')).not.toBeNull()
    expect(root.querySelector('img[src*="px.gif"]')!.closest('figure')).toBeNull()
  })

  it('React 官方文档 Sandpack 交互沙箱转换为 web-doc-playground 并提供代码与预览', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <h1>Counters that update together</h1>
      <div class="sandpack sandpack--playground w-full my-8" dir="ltr">
        <div class="sp-wrapper">
          <div class="sp-tabs"><button class="sp-tab-button">App.js</button></div>
          <div class="sp-code-editor">
            <pre class="sp-cm sp-javascript"><code>export default function MyApp() { return &lt;button&gt;Click&lt;/button&gt;; }</code></pre>
          </div>
          <iframe title="Sandbox Preview"></iframe>
        </div>
      </div>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://react.dev/learn')
    expect(result.bodyHtml).toContain('web-doc-playground')
    expect(result.bodyHtml).toContain('web-doc-playground-iframe')
    expect(result.bodyHtml).toContain('export default function MyApp()')

    const doc = buildWebDocReaderDocument({ title: 'Playground Test', bodyHtml: result.bodyHtml, baseUrl: 'https://react.dev/learn' }, 'dark')
    expect(doc).toContain('.web-doc-playground')
    expect(doc).toContain('web-doc-playground-run-btn')
    expect(doc).toContain('loadScript')
    expect(doc).toContain('ReactDOM.createRoot')
  })

  it('Shiki / Astro 风格代码块抽取正文时剥离行号元素，保持代码纯净', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <h1>App Server</h1>
      <pre class="shiki syntax-highlighter" data-language="ts"><code><span aria-hidden="true" class="syntax-highlighter-line-numbers"><span class="syntax-highlighter-line-number">1<!-- -->\n</span><span class="syntax-highlighter-line-number">2<!-- -->\n</span></span><span class="syntax-highlighter-line">import { spawn } from "chatgpt-app-server";</span></code></pre>
    </article></body></html>`

    const result = extractWebDocArticle(html, 'https://learn.chatgpt.com/docs/app-server')
    expect(result.bodyHtml).not.toContain('syntax-highlighter-line-numbers')
    expect(result.bodyHtml).not.toContain('syntax-highlighter-line-number')
    expect(result.bodyHtml).toContain('import { spawn } from "chatgpt-app-server";')

    const doc = buildWebDocReaderDocument(
      { title: 'App Server', bodyHtml: result.bodyHtml, baseUrl: 'https://learn.chatgpt.com/docs/app-server' },
      'dark',
    )
    expect(doc).toContain('import { spawn } from "chatgpt-app-server";')
    expect(doc).not.toMatch(/^\s*1\s*2/m)
  })

  it('游乐场外层运行时脚本可解析（曾因三层转义 \\ 漏写致整页 SyntaxError）', () => {
    const output = buildWebDocPlaygroundRuntimeScript()
    const inner = output.replace(/^<script>/, '').replace(/<\/script>$/, '')
    // 只解析不执行：语法错即抛 SyntaxError
    expect(() => new Function(inner)).not.toThrow()
  })

  it('游乐场恶意代码经 \\u003c 转义：runner 文档唯一 </script> 且可解析', () => {
    const hostile = 'const s = "</script><script>alert(1)</script>"; export default function App() {}'
    const output = buildWebDocPlaygroundRuntimeScript()
    const inner = output.replace(/^<script>/, '').replace(/<\/script>$/, '')
    const pg = document.createElement('div')
    pg.className = 'web-doc-playground'
    const source = document.createElement('div')
    source.className = 'web-doc-playground-source'
    source.textContent = hostile
    const frame = document.createElement('iframe')
    frame.className = 'web-doc-playground-iframe'
    pg.append(source, frame)
    document.body.append(pg)
    try {
      new Function(inner)()
      const srcdoc = frame.getAttribute('srcdoc') ?? (frame as HTMLIFrameElement).srcdoc ?? ''
      expect(srcdoc).toContain('u003c/script')
      // runner 自身闭合唯一，恶意载荷不得提前终结脚本块
      expect(srcdoc.split('</script').length - 1).toBe(1)
      const runnerInner = srcdoc.slice(srcdoc.indexOf('<script>') + 8, srcdoc.lastIndexOf('</script>'))
      expect(() => new Function(runnerInner)).not.toThrow()
    } finally {
      pg.remove()
    }
  })
})
