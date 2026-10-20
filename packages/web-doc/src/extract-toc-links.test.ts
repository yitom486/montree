import { describe, expect, it } from 'vitest'
import {
  decodeHtmlEntities,
  extractMdBookToc,
  resolveMdBookTocUrl,
  extractGenericWebDocToc,
  extractSameOriginDocLinks,
  extractStructuredNavToc,
  pickDocsNavHtml,
} from './extract-toc-links'

const MINTLIFY_SIDEBAR_FIXTURE = `<!DOCTYPE html><html><body>
<nav aria-label="Pages" id="sidebar">
  <a href="/"><span class="sr-only">Agent Client Protocol home page</span></a>
  <div>
    <h3 class="sidebar-title"><span>Get Started</span></h3>
  </div>
  <ul class="sidebar-group">
    <li data-title="Introduction"><a href="/get-started/introduction">Introduction</a></li>
    <li data-title="Architecture"><a href="/get-started/architecture">Architecture</a></li>
    <li data-title="Agents"><a href="/get-started/agents">Agents</a></li>
  </ul>
  <div>
    <h3 class="sidebar-title"><span>Protocol</span></h3>
  </div>
  <ul class="sidebar-group">
    <ul>
      <li><a href="/protocol/v1/overview">Overview</a></li>
      <li><a href="/protocol/v1/initialization">Initialization</a></li>
      <li><a href="/protocol/v1/prompt-turn">Prompt Turn</a></li>
    </ul>
  </ul>
  <div>
    <h3 class="sidebar-title"><span>Libraries</span></h3>
  </div>
  <ul class="sidebar-group">
    <li><a href="/libraries/kotlin">Kotlin</a></li>
    <li><a href="/libraries/python">Python</a></li>
  </ul>
  <ul>
    <li><a href="https://github.com/agentclientprotocol/agent-client-protocol">GitHub</a></li>
  </ul>
</nav>
<main><a href="/other">Other page buried in content</a></main>
</body></html>`

/** MkDocs Material：主侧栏内嵌套 chapter nav（非贪婪正则会截断） */
const MKDOCS_NAV_FIXTURE = `<!DOCTYPE html><html><body>
<nav class="md-header__inner" aria-label="页眉"><a href="/">Logo</a></nav>
<nav class="md-nav md-nav--primary" aria-label="导航栏" data-md-level="0">
  <ul class="md-nav__list">
    <li class="md-nav__item">
      <a href="/chapter_hello_algo/" class="md-nav__link">
        <span class="md-ellipsis">🚀 序</span>
      </a>
    </li>
    <li class="md-nav__item md-nav__item--nested">
      <a href="/chapter_sorting/" class="md-nav__link">
        <span class="md-ellipsis">第 11 章 &nbsp; 排序</span>
      </a>
      <nav class="md-nav" data-md-level="1" aria-expanded="true">
        <ul class="md-nav__list">
          <li class="md-nav__item">
            <a href="/chapter_sorting/sorting_algorithm/" class="md-nav__link">
              <span class="md-ellipsis">11.1 &nbsp; 排序算法</span>
            </a>
          </li>
          <li class="md-nav__item">
            <a href="/chapter_sorting/bubble_sort/" class="md-nav__link">
              <span class="md-ellipsis">11.3 &nbsp; 冒泡排序</span>
            </a>
          </li>
        </ul>
      </nav>
    </li>
  </ul>
</nav>
</body></html>`

describe('decodeHtmlEntities', () => {
  it('解码 &nbsp; 与数字实体', () => {
    expect(decodeHtmlEntities('11.1 &nbsp; 排序算法')).toBe('11.1 排序算法')
    expect(decodeHtmlEntities('A&#160;B')).toBe('A B')
  })
})

describe('extractStructuredNavToc', () => {
  it('识别 Mintlify sidebar nav', () => {
    const nav = pickDocsNavHtml(MINTLIFY_SIDEBAR_FIXTURE)
    expect(nav).toContain('id="sidebar"')
  })

  it('保留分组标题与层级，且不按字母打乱', () => {
    const entries = extractStructuredNavToc(
      MINTLIFY_SIDEBAR_FIXTURE,
      'https://agentclientprotocol.com/protocol/v1/overview',
    )

    expect(entries.map((e) => `${e.level}:${e.label}`)).toEqual([
      '0:Agent Client Protocol home page',
      '0:Get Started',
      '1:Introduction',
      '1:Architecture',
      '1:Agents',
      '0:Protocol',
      '1:Overview',
      '1:Initialization',
      '1:Prompt Turn',
      '0:Libraries',
      '1:Kotlin',
      '1:Python',
    ])

    expect(entries.find((e) => e.label === 'Get Started')?.href).toBe(
      'https://agentclientprotocol.com/get-started/introduction',
    )
    expect(entries.some((e) => e.label === 'GitHub')).toBe(false)
    expect(entries.some((e) => e.label === 'Other page buried in content')).toBe(false)
  })

  it('MDN <ol> + <details><summary> 分组保留层级', () => {
    const html = `<!DOCTYPE html><html><body>
      <nav id="sidebar" aria-label="Documentation">
        <div class="left-sidebar__content">
          <ol>
            <li class="section"><a href="/en-US/docs/Web/API/View_Transition_API">View Transition API</a></li>
            <li class="section"><a href="/en-US/docs/Web/API/Document">Document</a></li>
            <li><details open=""><summary><span>Static methods</span></summary><ol>
              <li><a href="/en-US/docs/Web/API/Document/parseHTML_static">parseHTML()</a></li>
              <li><a href="/en-US/docs/Web/API/Document/parseHTMLUnsafe_static">parseHTMLUnsafe()</a></li>
            </ol></details></li>
            <li><details open=""><summary><span>Instance methods</span></summary><ol>
              <li><a href="/en-US/docs/Web/API/Document/startViewTransition">startViewTransition()</a></li>
              <li><a href="/en-US/docs/Web/API/Document/append">append()<span role="img" class="icon icon-baseline discouraged" title="Deprecated. Not for use in new websites." aria-label="Deprecated"></span></a></li>
            </ol></details></li>
            <li><details open=""><summary><span>Events</span></summary><ol>
              <li><a href="/en-US/docs/Web/API/Document/scroll_event">scroll</a></li>
              <li><a href="/en-US/docs/Web/API/Document/visibilitychange_event">visibilitychange</a></li>
            </ol></details></li>
          </ol>
        </div>
      </nav>
    </body></html>`

    const entries = extractStructuredNavToc(
      html,
      'https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition',
    )
    expect(entries.map((e) => `${e.level}:${e.label}`)).toEqual([
      '0:View Transition API',
      '0:Document',
      '0:Static methods',
      '1:parseHTML()',
      '1:parseHTMLUnsafe()',
      '0:Instance methods',
      '1:startViewTransition()',
      '1:append()',
      '0:Events',
      '1:scroll',
      '1:visibilitychange',
    ])
    expect(entries.find((e) => e.label === 'Static methods')?.href).toBe(
      'https://developer.mozilla.org/en-US/docs/Web/API/Document/parseHTML_static',
    )
    expect(entries.find((e) => e.label === 'Instance methods')?.href).toBe(
      'https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition',
    )
    expect(entries.some((e) => /Deprecated|Non-standard/.test(e.label))).toBe(false)
  })

  it('summary 分组没有链接时不生成空分组', () => {
    const html = `<!DOCTYPE html><html><body>
      <nav id="sidebar" aria-label="Documentation"><ol>
        <li><details><summary>Empty group</summary></details></li>
        <li><a href="/a">Alpha</a></li>
        <li><a href="/b">Beta</a></li>
        <li><a href="/c">Gamma</a></li>
      </ol></nav>
    </body></html>`

    const entries = extractStructuredNavToc(html, 'https://docs.example.com/')
    expect(entries.map((e) => `${e.level}:${e.label}`)).toEqual([
      '0:Alpha',
      '0:Beta',
      '0:Gamma',
    ])
  })

  it('MkDocs 主侧栏：解码实体并保留章 → 节层级', () => {
    const nav = pickDocsNavHtml(MKDOCS_NAV_FIXTURE)
    expect(nav).toContain('md-nav--primary')
    expect(nav).toContain('11.1')

    const entries = extractGenericWebDocToc(
      MKDOCS_NAV_FIXTURE,
      'https://www.hello-algo.com/chapter_hello_algo/',
    )
    expect(entries.map((e) => `${e.level}:${e.label}`)).toEqual([
      '0:🚀 序',
      '0:第 11 章 排序',
      '1:11.1 排序算法',
      '1:11.3 冒泡排序',
    ])
    expect(entries.every((e) => !e.label.includes('&nbsp;'))).toBe(true)
  })
})

describe('extractGenericWebDocToc', () => {
  it('有结构化侧栏时不走扁平字母排序兜底', () => {
    const entries = extractGenericWebDocToc(
      MINTLIFY_SIDEBAR_FIXTURE,
      'https://agentclientprotocol.com/protocol/v1/overview',
    )
    expect(entries[1]?.label).toBe('Get Started')
    expect(entries.some((e) => e.level === 1)).toBe(true)
  })

  it('无侧栏时回退扁平同站链接', () => {
    const html = `<html><body>
      <a href="/b">Beta</a>
      <a href="/a">Alpha</a>
      <a href="https://example.com/x">External</a>
    </body></html>`
    const flat = extractSameOriginDocLinks(html, 'https://docs.example.com/')
    const generic = extractGenericWebDocToc(html, 'https://docs.example.com/')
    expect(flat.map((e) => e.label)).toEqual(['Beta', 'Alpha'])
    expect(generic.map((e) => e.label)).toEqual(['Beta', 'Alpha'])
  })

  it('react.dev 风格 nav[role=navigation] 走通用结构化提取', () => {
    const html = `<!DOCTYPE html><html><body>
<aside><nav role="navigation">
<ul>
<h3>GET STARTED</h3>
<li><a title="Quick Start" href="/learn"><div>Quick Start</div></a>
<ul>
<li><a title="Tutorial: Tic-Tac-Toe" href="/learn/tutorial-tic-tac-toe"><div>Tutorial: Tic-Tac-Toe</div></a></li>
<li><a title="Thinking in React" href="/learn/thinking-in-react"><div>Thinking in React</div></a></li>
</ul>
</li>
<li><a title="Installation" href="/learn/installation"><div>Installation</div></a></li>
</ul>
</nav></aside>
</body></html>`
    const entries = extractGenericWebDocToc(html, 'https://react.dev/learn')
    expect(entries.map((e) => `${e.level}:${e.label}`)).toEqual([
      '0:GET STARTED',
      '1:Quick Start',
      '2:Tutorial: Tic-Tac-Toe',
      '2:Thinking in React',
      '1:Installation',
    ])
  })

  it('密集新闻列表走通用提取（人民日报类版面）', () => {
    const html = `<html><body>
      <ul class="news-list">
        <li><a href="content_30178364.html">习近平同吉尔吉斯斯坦总统扎帕罗夫会谈</a></li>
        <li><a href="content_30178365.html">风雨同舟七十载</a></li>
      </ul>
      <a href="http://paper.people.com.cn/rmrb/paperindex.htm">首页</a>
    </body></html>`
    const base = 'https://paper.people.com.cn/rmrb/pc/content/202609/01/content_30178364.html'
    const entries = extractGenericWebDocToc(html, base)
    expect(entries).toHaveLength(2)
    expect(entries[1]?.label).toContain('风雨同舟')
    expect(entries.every((e) => e.level === 0)).toBe(true)
  })

  it('多 nav 场景下精准选取全站侧边栏并排除本页大纲（如 OpenCode 风格）', () => {
    const html = `<!DOCTYPE html><html><body>
      <nav aria-label="Documentation sections"><a href="/docs/">Docs</a><a href="/api/">API</a></nav>
      <nav class="docs-sidebar" aria-label="Documentation">
        <section>
          <ul>
            <li><a href="/v2/docs/">Intro</a></li>
            <li><a href="/v2/docs/config/">Config</a></li>
            <li><a href="/v2/docs/migrate/">Migrate</a></li>
          </ul>
        </section>
        <section>
          <h2>Configure</h2>
          <ul>
            <li><a href="/v2/docs/agents/">Agents</a></li>
            <li><a href="/v2/docs/models/">Models</a></li>
          </ul>
        </section>
      </nav>
      <main>
        <h1>Config</h1>
        <nav class="docs-toc" aria-label="On this page">
          <h2>On this page</h2>
          <ul>
            <li><a href="#format">Format</a></li>
            <li><a href="#locations">Locations</a></li>
            <li><a href="#schema">Schema</a></li>
            <li><a href="#shell">Shell</a></li>
          </ul>
        </nav>
      </main>
    </body></html>`

    const picked = pickDocsNavHtml(html)
    expect(picked).toContain('class="docs-sidebar"')
    expect(picked).not.toContain('class="docs-toc"')

    const entries = extractGenericWebDocToc(html, 'https://opencode.ai/v2/docs/config/')
    expect(entries.map((e) => `${e.level}:${e.label}`)).toEqual([
      '0:Intro',
      '0:Config',
      '0:Migrate',
      '0:Configure',
      '1:Agents',
      '1:Models',
    ])
  })
})


describe('mdBook chapter navigation', () => {
  const tree = `<ol class="chapter"><li class="chapter-item"><a href="index.html">Introduction</a></li>
    <li class="chapter-item"><a href="primitives.html"><strong>2.</strong> Primitives</a><a class="chapter-fold-toggle">❱</a>
      <ol class="section"><li class="chapter-item"><a href="primitives/literals.html">2.1. Literals and operators</a>
        <ol class="section"><li class="chapter-item"><a href="primitives/literals.html#examples">Examples</a></li></ol>
      </li></ol>
    </li><li class="chapter-item"><a href="https://other.example/">External</a><a href="javascript:alert(1)">Bad</a></li></ol>`
  const sidebar = (src: string) => `<nav id="mdbook-sidebar"><mdbook-sidebar-scrollbox></mdbook-sidebar-scrollbox><noscript><iframe src="${src}"></iframe></noscript></nav>`
  it('extracts nested ordered chapters, preserving anchors and ignoring fold controls and body references', () => {
    const entries = extractGenericWebDocToc(tree + '<main><a href="mut.html">mut</a></main>', 'https://book.example/rust/toc.html')
    expect(entries.map(e => [e.label, e.level])).toEqual([['Introduction', 0], ['2. Primitives', 0], ['2.1. Literals and operators', 1], ['Examples', 2]])
    expect(entries[3]?.href).toBe('https://book.example/rust/primitives/literals.html#examples')
    expect(extractMdBookToc('<p>not mdbook</p>', 'https://book.example/')).toEqual([])
  })
  it('resolves the declared index relative to deep and translated pages', () => {
    expect(resolveMdBookTocUrl(sidebar('../toc.html'), 'https://book.example/rust/ja/primitives/literals.html')).toBe('https://book.example/rust/ja/toc.html')
    expect(resolveMdBookTocUrl(sidebar('toc.html?x=1&amp;y=2'), 'https://book.example/rust/primitives.html')).toBe('https://book.example/rust/toc.html?x=1&y=2')
  })
  it('ignores arbitrary frames, cross-origin indexes and non-HTTP protocols', () => {
    expect(resolveMdBookTocUrl('<iframe src="toc.html"></iframe>', 'https://book.example/')).toBeNull()
    for (const src of ['https://evil.example/toc.html', 'file:///toc.html', 'javascript:alert(1)', 'other.html']) {
      expect(resolveMdBookTocUrl(sidebar(src), 'https://book.example/rust/page.html')).toBeNull()
    }
  })
})
