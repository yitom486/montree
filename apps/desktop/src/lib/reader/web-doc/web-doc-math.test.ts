// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { enhanceWebDocMath } from './web-doc-math'
import { buildWebDocReaderDocument } from './web-doc-html'

describe('enhanceWebDocMath', () => {
  it('渲染 arithmatex 行内 \\( \\) 公式', () => {
    const html = `<p>每轮选择上<span class="arithmatex">\\(1\\)</span>阶或<span class="arithmatex">\\(2\\)</span>阶</p>`
    const out = enhanceWebDocMath(html)
    expect(out).toContain('class="katex"')
    expect(out).not.toContain('\\(1\\)')
    expect(out).toContain('>1<')
  })

  it('渲染正文残留的 \\( \\) 文本', () => {
    const html = `<p>方案数量加\\(1\\)，越过则剪枝</p>`
    const out = enhanceWebDocMath(html)
    expect(out).toContain('class="katex"')
    expect(out).not.toContain('\\(1\\)')
  })

  it('不改动 pre/code 内的字面量', () => {
    const html = `<pre><code>print("\\(1\\)")</code></pre>`
    const out = enhanceWebDocMath(html)
    expect(out).toContain('\\(1\\)')
    expect(out).not.toContain('class="katex"')
  })

  it('渲染仅含 $$ 的独立公式，不跳过多 class 的 Sphinx math 容器', () => {
    expect(enhanceWebDocMath('<p>$$\\frac{a}{b}$$</p>')).toContain('class="katex-display"')
    expect(enhanceWebDocMath('<div class="math notranslate nohighlight">\\[\\sum_{i=1}^n i\\]</div>')).toContain('class="katex-display"')
    expect(enhanceWebDocMath('<pre><code class="math">\\(x^2\\)</code></pre>')).not.toContain('class="katex"')
  })

  it('Sphinx 公式编号不参与 LaTeX 解析，编号与锚点仍保留', () => {
    const html = '<div class="math notranslate nohighlight" id="equation-vector"><span class="eqno">(2.3.1)<a href="#equation-vector">¶</a></span>\\[\\begin{split}\\mathbf{x}=\\begin{bmatrix}1\\\\2\\end{bmatrix}\\end{split}\\]</div>'
    const out = enhanceWebDocMath(html)
    expect(out).toContain('class="katex-display"')
    expect(out).not.toContain('class="katex-error"')
    expect(out).toContain('(2.3.1)')
    expect(out).toContain('href="#equation-vector"')
  })
})

describe('buildWebDocReaderDocument math', () => {
  it('文档含 KaTeX 样式与渲染结果', () => {
    const doc = buildWebDocReaderDocument(
      {
        title: 'Demo',
        bodyHtml: `<p><span class="arithmatex">\\(n\\)</span></p>`,
        baseUrl: 'https://example.com/docs',
      },
      'light',
    )
    expect(doc).toContain('data-web-doc-katex')
    expect(doc).not.toContain('cdn.jsdelivr.net/npm/katex')
    expect(doc).toContain('class="katex"')
  })
})
