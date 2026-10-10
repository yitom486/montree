import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('markdown-it-alerts', () => {
  it('正确解析并渲染 GitHub 风格 NOTE、WARNING 等 Alert 提示卡片', () => {
    const md = [
      '> [!NOTE]',
      '> 这是重要提示内容',
      '',
      '> [!WARNING]',
      '> 这是警告警示信息',
    ].join('\n')

    const html = renderMarkdown(md)
    expect(html).toContain('markdown-alert-note')
    expect(html).toContain('markdown-alert-warning')
    expect(html).toContain('markdown-alert-title')
    expect(html).toContain('这是重要提示内容')
    expect(html).toContain('这是警告警示信息')
    expect(html).not.toContain('[!NOTE]')
    expect(html).not.toContain('[!WARNING]')
  })

  it('支持原生 HTML 块如 details 与 summary', () => {
    const md = '<details><summary>展开更多</summary><p>详细内容</p></details>'
    const html = renderMarkdown(md)
    expect(html).toContain('<details><summary>展开更多</summary>')
    expect(html).not.toContain('&lt;details&gt;')
  })
})
