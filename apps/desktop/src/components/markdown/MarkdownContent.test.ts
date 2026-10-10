// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

vi.mock('./MermaidBlock', () => ({
  MermaidBlock: ({ source }: { source: string }) => createElement('div', { 'data-testid': 'diagram' }, source),
}))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false
})

describe('MarkdownContent HTML containers', () => {
  it('Mermaid 原位挂载，保留嵌套折叠区、引用和代码的容器结构', async () => {
    await act(async () => root.render(createElement(MarkdownContent, {
      html: '<details><summary>外层</summary><blockquote><p>引用</p><details><summary>内层</summary><pre class="mermaid">graph TD\nA --> B</pre></details><pre><code>代码</code></pre></blockquote></details><p>外部正文</p>',
    })))
    expect(container.querySelector('details blockquote details [data-testid="diagram"]')?.textContent).toContain('A --> B')
    expect(container.querySelector('details blockquote code')?.textContent).toBe('代码')
    expect(container.querySelector('details')?.textContent).not.toContain('外部正文')
  })
  it('正文更新及流式模式切换清理旧图表，折叠状态不因 portal 挂载重置', async () => {
    const html = '<details><summary>详情</summary><pre class="mermaid">graph TD\nA --> B</pre></details>'
    await act(async () => root.render(createElement(MarkdownContent, { html })))
    container.querySelector('details')!.open = true
    await act(async () => root.render(createElement(MarkdownContent, { html, className: 'updated' })))
    expect(container.querySelector('details')?.open).toBe(true)
    await act(async () => root.render(createElement(MarkdownContent, { html: html.replace('A --> B', 'C --> D') })))
    expect(container.querySelectorAll('[data-testid="diagram"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="diagram"]')?.textContent).toContain('C --> D')
    await act(async () => root.render(createElement(MarkdownContent, { html, deferMermaid: true })))
    expect(container.querySelector('[data-testid="diagram"]')).toBeNull()
    expect(container.querySelector('details pre.mermaid')).not.toBeNull()
    await act(async () => root.render(createElement(MarkdownContent, { html: '<p>普通正文</p>' })))
    expect(container.textContent).toBe('普通正文')
  })
})
