// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  buildWebDocMarkdown,
  sanitizeExportFileName,
} from './web-doc-markdown-export'

describe('web-doc-markdown-export', () => {
  it('正确导出带 Frontmatter、标题、段落、代码块的 Markdown', () => {
    const html = `
      <h1>Agent Client Protocol</h1>
      <p>ACP is a <strong>standardized</strong> protocol for <em>agent-editor</em> communication.</p>
      <pre><code class="language-typescript">const client = new AcpClient();</code></pre>
    `

    const md = buildWebDocMarkdown({
      title: 'Agent Client Protocol',
      baseUrl: 'https://agentclientprotocol.com/intro',
      bodyHtml: html,
    })

    expect(md).toContain('title: "Agent Client Protocol"')
    expect(md).toContain('source: "https://agentclientprotocol.com/intro"')
    expect(md).toContain('# Agent Client Protocol')
    expect(md).toContain('**standardized**')
    expect(md).toContain('*agent-editor*')
    expect(md).toContain('```typescript\nconst client = new AcpClient();\n```')
  })

  it('正确将 Callout 提示框转换为 GitHub Alert 格式', () => {
    const html = `
      <div class="callout web-doc-callout web-doc-callout-info" data-callout-type="info">
        <div class="web-doc-callout-icon"><svg></svg></div>
        <div class="web-doc-callout-content">
          <p>This is a note message.</p>
        </div>
      </div>
      <div class="custom-block warning" data-callout="warning">
        <div class="web-doc-callout-content">
          <p>Be careful with this operation.</p>
        </div>
      </div>
    `

    const md = buildWebDocMarkdown({
      title: 'Callouts',
      baseUrl: 'https://example.com/docs',
      bodyHtml: html,
    })

    expect(md).toContain('> [!NOTE]\n> This is a note message.')
    expect(md).toContain('> [!WARNING]\n> Be careful with this operation.')
  })

  it('正确转换表格为 Markdown GFM 格式', () => {
    const html = `
      <table>
        <thead>
          <tr><th>Feature</th><th>Support</th></tr>
        </thead>
        <tbody>
          <tr><td>Markdown</td><td>Yes</td></tr>
          <tr><td>Latex</td><td>Yes</td></tr>
        </tbody>
      </table>
    `

    const md = buildWebDocMarkdown({
      title: 'Table Test',
      baseUrl: 'https://example.com/table',
      bodyHtml: html,
    })

    expect(md).toContain('| Feature | Support |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| Markdown | Yes |')
    expect(md).toContain('| Latex | Yes |')
  })

  it('提取 KaTeX 内部公式源码', () => {
    const html = `
      <p>Inline formula: <span class="katex"><annotation encoding="application/x-tex">E=mc^2</annotation></span></p>
    `

    const md = buildWebDocMarkdown({
      title: 'Math Test',
      baseUrl: 'https://example.com/math',
      bodyHtml: html,
    })

    expect(md).toContain('$E=mc^2$')
  })

  it('列表包含 task list 复选框', () => {
    const html = `
      <ul>
        <li><input type="checkbox" checked /> First item</li>
        <li><input type="checkbox" /> Second item</li>
      </ul>
    `

    const md = buildWebDocMarkdown({
      title: 'List Test',
      baseUrl: 'https://example.com/list',
      bodyHtml: html,
    })

    expect(md).toContain('- [x] First item')
    expect(md).toContain('- [ ] Second item')
  })

  it('sanitizeExportFileName 过滤 Windows 非法文件名字符', () => {
    expect(sanitizeExportFileName('Hello: World / Test?')).toBe('Hello_ World _ Test_')
    expect(sanitizeExportFileName('   ')).toBe('document')
  })
})
