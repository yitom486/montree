// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { getCodeBlockTextFromCopyButton } from '@/lib/preview/code-block-copy'
import { activateWebDocCodeTab, enhanceWebDocCodeBlocks } from './web-doc-code-blocks'
import { buildWebDocReaderDocument } from './web-doc-html'

describe('enhanceWebDocCodeBlocks', () => {
  it('react.dev Sandpack pre 识别 javascript', () => {
    const html = `<pre class="sp-cm sp-pristine sp-javascript"><code>function MyButton() {}</code></pre>`
    const enhanced = enhanceWebDocCodeBlocks(html)
    expect(enhanced).toContain('class="code-block-lang">javascript')
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
    expect(doc).toContain('echo hi')
    expect(doc).toContain('web-doc-tabs-tab')
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
