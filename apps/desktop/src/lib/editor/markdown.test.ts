import { describe, expect, it } from 'vitest'
import { markdownParser, renderMarkdown } from './markdown'
import MarkdownIt from 'markdown-it'

describe('markdownParser', () => {
  it('文档组件围栏保存 JSON 数据，隐藏参数合并相邻静态图片并保留行映射', () => {
    const spec = JSON.stringify({ schemaVersion: 1, title: '<script>不执行</script>', diagramType: 'flowchart', nodes: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }], edges: [{ from: 'a', to: 'b' }] })
    const html = markdownParser.render(['```montree-diagram', spec, '```'].join('\n'))
    expect(html).toContain('data-montree-artifact="montree-diagram"')
    expect(html).not.toContain('<script>')
    const text = `![静态图](./diagram.svg)\n\n<!-- montree-diagram\n${spec}\n-->`
    const token = markdownParser.parse(text, {})[0]
    expect(token.type).toBe('montree_artifact')
    expect(token.map).toEqual([0, 5])
    expect(markdownParser.render(text)).toContain('<img src="./diagram.svg"')
    const portable = new MarkdownIt({ html: true }).render(text)
    expect(portable).toContain('<img src="./diagram.svg"')
    expect(portable).not.toContain('data-montree-artifact')
    expect(markdownParser.render(`正文不应丢失\n\n<!-- montree-diagram\n${spec}\n-->`)).toContain('<p>正文不应丢失</p>')
  })
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

  it('将 markmap 代码块标记为思维导图待渲染容器', () => {
    const html = markdownParser.render([
      '```markmap',
      '# 核心主题',
      '## 分支一',
      '## 分支二',
      '```',
    ].join('\n'))

    expect(html).toContain('<pre class="markmap"')
    expect(html).toContain('data-markmap-source=')
    expect(html).toContain('# 核心主题')
    expect(html).not.toContain('language-markmap')
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
