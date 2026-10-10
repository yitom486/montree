import { describe, expect, it } from 'vitest'
import { markdownParser, renderMarkdown } from './markdown'

describe('markdownParser', () => {
  it('渲染行内与块级 KaTeX 公式', () => {
    const inlineHtml = markdownParser.render('质能方程：$E = mc^2$')
    const blockHtml = markdownParser.render('$$\\frac{a}{b}$$')

    expect(inlineHtml).toContain('class="katex"')
    expect(blockHtml).toContain('class="katex-display"')
  })

  it('renderMarkdown 将 \\[...\\] 规范为 KaTeX 块级公式', () => {
    const html = renderMarkdown(String.raw`\[\text{补码}=\text{反码}+1\]`)
    expect(html).toContain('katex')
  })

  it('将 mermaid 代码块标记为待渲染图表', () => {
    const html = markdownParser.render([
      '```mermaid',
      'flowchart LR',
      '  A[编辑] --> B[预览]',
      '```',
    ].join('\n'))

    expect(html).toContain('<pre class="mermaid">')
    expect(html).toContain('flowchart LR')
    expect(html).not.toContain('language-mermaid')
  })

  it('为代码块添加语法高亮与工具栏', () => {
    const html = markdownParser.render(['```ts', 'const answer = 42', '```'].join('\n'))

    expect(html).toContain('code-block-toolbar')
    expect(html).toContain('class="hljs"')
    expect(html).toContain('hljs-number')
    expect(html).toContain('code-block-copy')
    expect(html).toContain('code-block-lines')
    expect(html).toContain('code-block-line-number')
  })

  it('为代码块添加语言标签与复制按钮', () => {
    const html = markdownParser.render(['```typescript', 'const x = 1', '```'].join('\n'))

    expect(html).toContain('code-block-lang')
    expect(html).toContain('typescript')
    expect(html).toContain('aria-label="复制代码"')
  })

  it('渲染 GFM 表格', () => {
    const html = markdownParser.render(
      ['| 列 A | 列 B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
    )

    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('列 A')
  })

  it('渲染 GFM 任务列表', () => {
    const html = markdownParser.render(['- [x] 已完成', '- [ ] 待办'].join('\n'))

    expect(html).toContain('task-list-item')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked')
  })

  it('渲染脚注（Footnote）', () => {
    const html = renderMarkdown('文中脚注[^1]\n\n[^1]: 底部解释说明。')
    expect(html).toContain('class="footnote-ref"')
    expect(html).toContain('class="footnotes"')
    expect(html).toContain('底部解释说明。')
  })

  it('渲染上下标与高亮（sub/sup/mark）', () => {
    const html = renderMarkdown('H~2~O 与 X^2^ 以及 ==重点关注==')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('<sup>2</sup>')
    expect(html).toContain('<mark>重点关注</mark>')
  })

  it('容错规范化内联裸 SVG Data-URI 图片', () => {
    const raw = '![inline-svg](data:image/svg+xml;utf8,<svg width="10"><rect/></svg> "测试标题")'
    const html = renderMarkdown(raw)
    expect(html).toContain('<img src="data:image/svg+xml;utf8,%3Csvg')
    expect(html).toContain('alt="inline-svg"')
    expect(html).toContain('title="测试标题"')
  })
})
