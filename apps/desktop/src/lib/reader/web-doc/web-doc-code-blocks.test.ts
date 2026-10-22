// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { getCodeBlockTextFromCopyButton } from '@/lib/preview/code-block-copy'
import { activateWebDocCodeTab, enhanceWebDocCodeBlocks } from './web-doc-code-blocks'
import { buildWebDocReaderDocument, extractWebDocArticle } from './web-doc-html'

describe('enhanceWebDocCodeBlocks', () => {
  it.each([
    '<pre class="mermaid">flowchart LR\nA --&gt; B</pre>',
    '<pre><code class="language-mermaid">flowchart LR\nA --&gt; B</code></pre>',
    '<div class="language-mermaid"><pre><code>flowchart LR\nA --&gt; B</code></pre></div>',
  ])('为 Mermaid 保留图表宿主与可复制的源码，重复增强不会套娃：%s', (html) => {
    const enhanced = enhanceWebDocCodeBlocks(html)
    const doc = new DOMParser().parseFromString(enhanceWebDocCodeBlocks(enhanced), 'text/html')
    expect(doc.querySelectorAll('.web-doc-mermaid')).toHaveLength(1)
    expect(doc.querySelector('.mermaid')?.getAttribute('data-mermaid-source')).toBe('flowchart LR\nA --> B')
    expect(doc.querySelector('details summary')?.textContent).toBe('Mermaid 源码')
    expect(doc.querySelector('details pre')?.textContent).toBe('flowchart LR\nA --> B')
    expect(doc.querySelector('details .code-block-lang')?.textContent).toBe('mermaid')
    expect(doc.querySelectorAll('details .mermaid')).toHaveLength(0)
  })

  it('react.dev Sandpack pre 识别 javascript', () => {
    const html = `<pre class="sp-cm sp-pristine sp-javascript"><code>function MyButton() {}</code></pre>`
    const enhanced = enhanceWebDocCodeBlocks(html)
    expect(enhanced).toContain('class="code-block-lang">javascript')
  })

  it('识别 MDN brush 语言并清理 example-header 中的重复语言标签', () => {
    const source = 'startViewTransition()\nstartViewTransition(updateCallback)\nstartViewTransition(options)\n'
    const html = `<div class="code-example"><div class="example-header"><span class="language-name">js</span></div><pre class="brush: js notranslate"><code>${source}</code></pre></div>`

    const enhanced = enhanceWebDocCodeBlocks(html)
    const doc = new DOMParser().parseFromString(enhanced, 'text/html')

    expect(doc.querySelector('.example-header')).toBeNull()
    expect(doc.querySelector('.code-block-lang')?.textContent).toBe('javascript')
    expect(doc.querySelector('pre')?.getAttribute('data-language')).toBe('javascript')
    expect(doc.querySelector('code')?.textContent).toBe(source)
  })

  it('pre 无显式语言类时从 example-header 语言名回退（且不被内容猜测覆盖）', () => {
    const html = `<div class="code-example"><div class="example-header"><span class="language-name">TypeScript</span></div><pre><code>const answer: number = 42</code></pre></div>`

    const enhanced = enhanceWebDocCodeBlocks(html)
    const doc = new DOMParser().parseFromString(enhanced, 'text/html')

    expect(doc.querySelector('.example-header')).toBeNull()
    expect(doc.querySelector('.code-block-lang')?.textContent).toBe('typescript')
    expect(doc.querySelector('pre')?.getAttribute('data-language')).toBe('typescript')
  })

  it('保留带标题的 code-example 头部，只移除语言/复制等重复装饰', () => {
    const html = `<div class="code-example"><div class="example-header">Basic usage</div><pre class="brush: js"><code>const x = 1</code></pre></div>`

    const enhanced = enhanceWebDocCodeBlocks(html)
    const doc = new DOMParser().parseFromString(enhanced, 'text/html')

    expect(doc.querySelector('.example-header')?.textContent).toBe('Basic usage')
    expect(doc.querySelector('.code-block-lang')?.textContent).toBe('javascript')
  })

  it('识别 brush、highlight-source-*、lang 属性与 data-code-language', () => {
    const cases: Array<[string, string]> = [
      ['<pre class="brush: python notranslate"><code>print(1)</code></pre>', 'python'],
      ['<div class="highlight highlight-source-js"><pre><code>const x = 1</code></pre></div>', 'javascript'],
      ['<div class="highlight-python notranslate"><div class="highlight"><pre><code>print(2)</code></pre></div></div>', 'python'],
      ['<div class="highlight-python notranslate"><pre><code>print(3)</code></pre></div>', 'python'],
      ['<pre lang="yaml"><code>key: value</code></pre>', 'yaml'],
      ['<pre data-code-language="go"><code>package main</code></pre>', 'go'],
    ]

    for (const [html, lang] of cases) {
      const doc = new DOMParser().parseFromString(enhanceWebDocCodeBlocks(html), 'text/html')
      expect(doc.querySelector('.code-block-lang')?.textContent).toBe(lang)
      expect(doc.querySelector('pre')?.getAttribute('data-language')).toBe(lang)
    }
  })

  it('将 Pygments / Docusaurus / data-filename 的文件名提升到工具栏', () => {
    const pygments = enhanceWebDocCodeBlocks(
      `<div class="highlight"><span class="filename">example.py</span><pre><code class="language-python">print("hi")</code></pre></div>`,
    )
    const pygmentsDoc = new DOMParser().parseFromString(pygments, 'text/html')
    expect(pygmentsDoc.querySelector('.code-block-filename')?.textContent).toBe('example.py')
    expect(pygmentsDoc.querySelector('.filename')).toBeNull()
    expect(pygmentsDoc.querySelector('.code-block-lang')?.textContent).toBe('python')

    const docusaurus = enhanceWebDocCodeBlocks(
      `<div class="codeBlockContainer"><div class="codeBlockTitle_x1">src/App.tsx</div><div class="codeBlockContent"><pre><code class="language-tsx">const App = () => null</code></pre></div></div>`,
    )
    const docusaurusDoc = new DOMParser().parseFromString(docusaurus, 'text/html')
    expect(docusaurusDoc.querySelector('.code-block-filename')?.textContent).toBe('src/App.tsx')
    expect(docusaurusDoc.querySelector('[class*="codeBlockTitle"]')).toBeNull()
    expect(docusaurusDoc.querySelector('.code-block-lang')?.textContent).toBe('tsx')

    const dataFilename = enhanceWebDocCodeBlocks(
      `<pre data-filename="Dockerfile"><code>FROM node:20</code></pre>`,
    )
    const dataFilenameDoc = new DOMParser().parseFromString(dataFilename, 'text/html')
    expect(dataFilenameDoc.querySelector('.code-block-filename')?.textContent).toBe('Dockerfile')
    expect(dataFilenameDoc.querySelector('pre')?.textContent).toBe('FROM node:20')
  })

  it('普通标题或交互式文件名不会搬进工具栏', () => {
    const title = enhanceWebDocCodeBlocks(
      `<div class="highlight"><span class="filename">Basic usage</span><pre><code>echo hi</code></pre></div>`,
    )
    const titleDoc = new DOMParser().parseFromString(title, 'text/html')
    expect(titleDoc.querySelector('.code-block-filename')).toBeNull()
    expect(titleDoc.querySelector('.filename')?.textContent).toBe('Basic usage')

    const link = enhanceWebDocCodeBlocks(
      `<div class="highlight"><a class="filename" href="/src/app.ts">src/app.ts</a><pre><code class="language-ts">const x = 1</code></pre></div>`,
    )
    const linkDoc = new DOMParser().parseFromString(link, 'text/html')
    expect(linkDoc.querySelector('.code-block-filename')).toBeNull()
    expect(linkDoc.querySelector('a.filename')?.getAttribute('href')).toBe('/src/app.ts')
  })

  it('为 VuePress 风格 div.language-* > pre > code 注入复制工具栏', () => {
    const html = `<div class="language-bash extra-class"><pre class="language-bash"><code>$ curl -Lo minikube</code></pre></div>`

    const enhanced = enhanceWebDocCodeBlocks(html)
    expect(enhanced).toContain('class="code-block"')
    expect(enhanced).toContain('class="code-block-copy"')
    expect(enhanced).toContain('class="code-block-lang">bash')
    expect(enhanced).toContain('$ curl -Lo minikube')
    expect(enhanced).not.toContain('extra-class')
  })

  it('独立 pre 也会包装', () => {
    const html = `<pre><code>plain block</code></pre>`
    const enhanced = enhanceWebDocCodeBlocks(html)
    expect(enhanced).toContain('class="code-block-copy"')
    expect(enhanced).toContain('plain block')
  })

  it('已增强的块不会重复包装', () => {
    const once = enhanceWebDocCodeBlocks(`<pre><code>a</code></pre>`)
    const twice = enhanceWebDocCodeBlocks(once)
    expect(twice.match(/class="code-block-copy"/g)).toHaveLength(1)
  })

  it('复制按钮能读到高亮 span 内的纯文本', () => {
    const enhanced = enhanceWebDocCodeBlocks(
      `<pre class="language-bash"><code>$ <span class="token function">curl</span> minikube</code></pre>`,
    )
    document.body.innerHTML = enhanced
    const button = document.querySelector('.code-block-copy')!
    expect(getCodeBlockTextFromCopyButton(button)).toBe('$ curl minikube')
    document.body.innerHTML = ''
  })

  it('MkDocs tabbed-set 转为可切换的语言 Tab，默认 Python', () => {
    const html = `
      <div class="tabbed-set tabbed-alternate" data-tabs="1:3">
        <input checked="checked" id="__tabbed_1_1" name="__tabbed_1" type="radio" />
        <input id="__tabbed_1_2" name="__tabbed_1" type="radio" />
        <input id="__tabbed_1_3" name="__tabbed_1" type="radio" />
        <div class="tabbed-labels">
          <label for="__tabbed_1_1">Python</label>
          <label for="__tabbed_1_2">C++</label>
          <label for="__tabbed_1_3">Java</label>
        </div>
        <div class="tabbed-content">
          <div class="tabbed-block">
            <div class="highlight"><span class="filename">a.py</span><pre><code>def f(): pass</code></pre></div>
          </div>
          <div class="tabbed-block">
            <div class="highlight"><span class="filename">a.cpp</span><pre><code>int main(){}</code></pre></div>
          </div>
          <div class="tabbed-block">
            <div class="highlight"><span class="filename">a.java</span><pre><code>class A{}</code></pre></div>
          </div>
        </div>
      </div>`

    const enhanced = enhanceWebDocCodeBlocks(html)
    document.body.innerHTML = enhanced

    expect(enhanced).toContain('web-doc-tabs')
    expect(enhanced).not.toContain('tabbed-set')
    expect(enhanced).not.toContain('PythonC++')
    expect(document.querySelectorAll('[data-web-doc-tab]')).toHaveLength(3)

    const pythonTab = [...document.querySelectorAll('[data-web-doc-tab]')].find(
      (el) => el.textContent === 'Python',
    )!
    const cppTab = [...document.querySelectorAll('[data-web-doc-tab]')].find(
      (el) => el.textContent === 'C++',
    )!
    expect(pythonTab.getAttribute('aria-selected')).toBe('true')
    expect(document.body.textContent).toContain('def f(): pass')
    expect(document.querySelector('[data-tab-index="1"].web-doc-tabs-panel')?.hasAttribute('hidden')).toBe(
      true,
    )

    activateWebDocCodeTab(cppTab)
    expect(cppTab.getAttribute('aria-selected')).toBe('true')
    expect(pythonTab.getAttribute('aria-selected')).toBe('false')
    expect(document.querySelector('[data-tab-index="1"].web-doc-tabs-panel')?.hasAttribute('hidden')).toBe(
      false,
    )
    expect(document.body.textContent).toContain('int main(){}')
    expect(enhanced).toContain('class="code-block-lang">python')

    document.body.innerHTML = ''
  })

  it('arXiv / LaTeXML listing 规范化为 code-block 并识别语言与复制', () => {
    const html = `
      <figure class="ltx_float ltx_lstlisting">
        <p class="ltx_figure_panel">A minimal sandbox session through libdsec.</p>
        <div class="ltx_listing ltx_lst_language_Python ltx_lstlisting">
          <div class="ltx_listing_data"><a href="data:text/plain;base64,YWJj" download="test.py">⬇</a></div>
          <div class="ltx_listingline"><span class="ltx_text ltx_lst_identifier">client</span> = <span class="ltx_text ltx_lst_identifier">DSecClient</span>()</div>
          <div class="ltx_listingline"><span class="ltx_text ltx_lst_keyword">await</span> client.open()</div>
        </div>
      </figure>
    `
    const enhanced = enhanceWebDocCodeBlocks(html)
    expect(enhanced).toContain('class="code-block"')
    expect(enhanced).toContain('class="code-block-lang">python')
    expect(enhanced).toContain('class="code-block-copy"')
    expect(enhanced).toContain('DSecClient')
    expect(enhanced).toContain('await')
    expect(enhanced).not.toContain('⬇')
  })

  it('剥离 Shiki / Astro 风格的独立行号栏（如 learn.chatgpt.com）', () => {
    const html = `<pre class="shiki syntax-highlighter" data-language="typescript"><code><span aria-hidden="true" class="syntax-highlighter-line-numbers"><span class="syntax-highlighter-line-number">1<!-- -->\n</span><span class="syntax-highlighter-line-number">2<!-- -->\n</span></span><span class="syntax-highlighter-line">import { spawn } from "chatgpt-app-server";</span></code></pre>`
    const enhanced = enhanceWebDocCodeBlocks(html)
    expect(enhanced).not.toContain('syntax-highlighter-line-numbers')
    expect(enhanced).not.toContain('syntax-highlighter-line-number')
    expect(new DOMParser().parseFromString(enhanced, 'text/html').querySelector('pre code')?.textContent).toBe('import { spawn } from "chatgpt-app-server";')
    expect(enhanced).not.toMatch(/^\s*1\s*2/m)

    document.body.innerHTML = enhanced
    const button = document.querySelector('.code-block-copy')!
    expect(getCodeBlockTextFromCopyButton(button)).toBe('import { spawn } from "chatgpt-app-server";')
    document.body.innerHTML = ''
  })

  it('剥离 Prism 风格伪元素与 Pygments table.highlighttable 行号列', () => {
    const prismHtml = `<pre class="line-numbers language-js"><code>const x = 42;<span aria-hidden="true" class="line-numbers-rows"><span></span></span></code></pre>`
    const prismEnhanced = enhanceWebDocCodeBlocks(prismHtml)
    expect(prismEnhanced).not.toContain('line-numbers-rows')
    expect(new DOMParser().parseFromString(prismEnhanced, 'text/html').querySelector('pre code')?.textContent).toBe('const x = 42;')

    const pygmentsHtml = `<table class="highlighttable"><tbody><tr><td class="linenos"><pre>1\n2</pre></td><td class="code"><div class="highlight"><pre><span></span>print("hello")</pre></div></td></tr></tbody></table>`
    const pygmentsEnhanced = enhanceWebDocCodeBlocks(pygmentsHtml)
    expect(pygmentsEnhanced).not.toContain('highlighttable')
    expect(pygmentsEnhanced).not.toContain('linenos')
    expect(pygmentsEnhanced).toContain('print("hello")')
  })
})

describe('buildWebDocReaderDocument', () => {
  it('输出文档含代码块样式与复制按钮', () => {
    const doc = buildWebDocReaderDocument(
      {
        title: 'Demo',
        bodyHtml: `<div class="language-bash"><pre class="language-bash"><code>echo hi</code></pre></div>`,
        baseUrl: 'https://example.com/docs',
      },
      'dark',
    )

    expect(doc).toContain('code-block-copy')
    expect(doc).toContain('.code-block-toolbar')
    expect(new DOMParser().parseFromString(doc, 'text/html').querySelector('pre code')?.textContent).toBe('echo hi')
    expect(doc).toContain('web-doc-tabs-tab')
  })

  it('MDN startViewTransition 文章抽取后保留 JS 高亮且不再输出独立的 js 文本', () => {
    const pageUrl = 'https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition'
    const source = 'startViewTransition()\nstartViewTransition(updateCallback)\nstartViewTransition(options)\n'
    const html = `<!doctype html><html><head><title>Document: startViewTransition() method</title></head><body><main><article><h1>Document: startViewTransition() method</h1><section><h2>Syntax</h2><div class="code-example"><div class="example-header"><span class="language-name">js</span></div><pre class="brush: js notranslate"><code>${source}</code></pre></div></section></article></main></body></html>`

    const { bodyHtml } = extractWebDocArticle(html, pageUrl)
    const doc = new DOMParser().parseFromString(
      buildWebDocReaderDocument({ title: 'startViewTransition()', bodyHtml, baseUrl: pageUrl }, 'dark'),
      'text/html',
    )
    expect(doc.querySelector('.example-header')).toBeNull()
    expect(doc.querySelector('.code-block-lang')?.textContent).toBe('javascript')
    expect(doc.querySelector('pre')?.getAttribute('data-language')).toBe('javascript')
    expect(doc.querySelector('code.hljs.language-javascript')?.textContent).toBe(source)
  })

  it('Tab 运行时脚本哈希与 CSP 放行值一致（改脚本须同步更新）', async () => {
    const { buildWebDocTabsRuntimeScript, WEB_DOC_TABS_RUNTIME_SCRIPT_SHA256 } =
      await import('./web-doc-code-blocks')
    const output = buildWebDocTabsRuntimeScript()
    const inner = output.replace(/^<script>/, '').replace(/<\/script>$/, '')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inner))
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    expect(`sha256-${base64}`).toBe(WEB_DOC_TABS_RUNTIME_SCRIPT_SHA256)
  })
})


describe('web documentation syntax highlighting', () => {
  it('highlights mdBook Rust keywords, comments and strings while preserving exact copy text', () => {
    const source = 'fn main() {\n    // comment\n    let n: u32 = 42;\n    println!("hello");\n}\n'
    const html = enhanceWebDocCodeBlocks(`<pre class="playground"><code class="language-rust editable mdbook-runnable">${source}</code></pre>`)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('code.hljs.language-rust')?.textContent).toBe(source)
    expect(doc.querySelector('.hljs-keyword')?.textContent).toBe('fn')
    expect(doc.querySelector('.hljs-comment')?.textContent).toBe('// comment')
    expect(doc.querySelector('.hljs-string')?.textContent).toBe('"hello"')
    expect(getCodeBlockTextFromCopyButton(doc.querySelector('.code-block-copy')!)).toBe(source)
    expect(enhanceWebDocCodeBlocks(html)).toBe(html)
  })
  it('preserves SSR line boundaries, replaces foreign token markup and keeps escaped code inert', () => {
    const html = enhanceWebDocCodeBlocks('<pre class="language-js"><code><span class="line"><span style="color:red">const x = 1;</span></span><span class="line">console.log("&lt;img src=x onerror=alert(1)&gt;");</span></code></pre>')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('code')?.textContent).toBe('const x = 1;\nconsole.log("<img src=x onerror=alert(1)>");')
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.querySelector('code [style]')).toBeNull()
    expect(doc.querySelector('.hljs-keyword')).not.toBeNull()
  })
  it('keeps unsupported languages and oversized listings readable without forcing detection', () => {
    for (const [lang, source] of [['unknown-example', 'alpha beta gamma'], ['rust', ' '.repeat(100001) + 'fn main() {}']]) {
      const html = enhanceWebDocCodeBlocks(`<pre><code class="language-${lang}">${source}</code></pre>`)
      const doc = new DOMParser().parseFromString(html, 'text/html')
      expect(doc.querySelector('code')?.textContent).toBe(source)
      expect(doc.querySelector('code.hljs')).toBeNull()
    }
  })
})
