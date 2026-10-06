// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  renderAgentMarkdown,
  renderAgentMarkdownStreaming,
  splitAgentMarkdownParts,
} from './agent-markdown'

describe('renderAgentMarkdown + splitAgentMarkdownParts', () => {
  beforeEach(() => {
    // 单测里关掉 mermaid 诊断噪音
    window.localStorage.setItem('montree:mermaid-debug', '0')
  })

  it('highlights fenced code with hljs (shared preview pipeline)', () => {    const html = renderAgentMarkdown(['```ts', 'const answer = 42', '```'].join('\n'))
    expect(html).toContain('code-block-toolbar')
    expect(html).toContain('hljs')
    expect(html).toContain('code-block-copy')
    expect(html).toContain('hljs-number')
  })

  it('keeps mermaid fence for client-side render', () => {
    const html = renderAgentMarkdown(['```mermaid', 'flowchart LR', '  A --> B', '```'].join('\n'))
    expect(html).toContain('class="mermaid"')
    expect(html).toContain('flowchart LR')
  })

  it('preserves sole-root mermaid after sanitize wrap', () => {
    const html = renderAgentMarkdown(['```mermaid', 'graph TD', '  X --> Y', '```'].join('\n'))
    expect(html).toMatch(/<pre[^>]*class="mermaid"/)
  })

  it('closes unclosed fence while streaming', () => {
    const html = renderAgentMarkdown(['```ts', 'const x = 1'].join('\n'), { streaming: true })
    expect(html).toContain('code-block')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-number')
  })

  it('streaming and final share the same renderer for closed markdown', () => {
    const md = ['## 标题', '', '- 一项', '', '> 引用文字'].join('\n')
    const streaming = renderAgentMarkdown(md, { streaming: true })
    const final = renderAgentMarkdown(md)
    expect(streaming).toBe(final)
  })

  it('splits mermaid out of mixed markdown html', () => {
    const html = renderAgentMarkdown(
      ['段落', '', '```mermaid', 'flowchart LR', 'A --> B', '```', '', '结尾'].join('\n'),
    )
    const parts = splitAgentMarkdownParts(html)
    const mermaid = parts.find((p) => p.type === 'mermaid')
    expect(mermaid?.type).toBe('mermaid')
    if (mermaid?.type === 'mermaid') {
      expect(mermaid.source).toContain('flowchart LR')
      expect(mermaid.source).toContain('A --> B')
    }
    expect(parts.some((p) => p.type === 'html' && p.html.includes('段落'))).toBe(true)
  })

  it('splits mermaid nested under a wrapper div (DOMPurify 外层残留)', () => {
    const nested = [
      '<div>',
      '<p>前</p>',
      '<pre class="mermaid">flowchart LR\nA --> B\n</pre>',
      '<p>后</p>',
      '</div>',
    ].join('')
    const parts = splitAgentMarkdownParts(nested)
    expect(parts.filter((p) => p.type === 'mermaid')).toHaveLength(1)
    const mermaid = parts.find((p) => p.type === 'mermaid')
    expect(mermaid && mermaid.type === 'mermaid' && mermaid.source).toContain('flowchart LR')
    expect(
      parts
        .filter((p) => p.type === 'html')
        .some((p) => p.type === 'html' && /class=["'][^"']*\bmermaid\b/.test(p.html)),
    ).toBe(false)
  })

  it('splits Chinese flowchart from real markdown pipeline', () => {
    const md = [
      '块级公式已上',
      '',
      '```mermaid',
      'flowchart LR',
      'A[用户提出需求] --> B[分析任务]',
      'B --> C{需要工具吗？}',
      'C -->|是| D[执行并验证]',
      'C -->|否| E[直接回答]',
      'D --> F[交付结果]',
      'E --> F',
      '```',
      '',
      '如果你的界面支持 Mermaid',
    ].join('\n')
    const html = renderAgentMarkdown(md)
    const parts = splitAgentMarkdownParts(html)
    expect(parts.filter((p) => p.type === 'mermaid')).toHaveLength(1)
    const mermaid = parts.find((p) => p.type === 'mermaid')
    expect(mermaid?.type).toBe('mermaid')
    if (mermaid?.type === 'mermaid') {
      expect(mermaid.source).toContain('用户提出需求')
      expect(mermaid.source).toContain('需要工具吗？')
    }
    // 回归：html 段不得再藏 .mermaid，否则会只显示源码灰框
    for (const part of parts) {
      if (part.type === 'html') {
        expect(part.html).not.toMatch(/class=["'][^"']*\bmermaid\b/)
      }
    }
  })

  it('splits multiple mermaid blocks in order', () => {
    const html = [
      '<p>一</p>',
      '<pre class="mermaid">graph TD\nA-->B</pre>',
      '<p>中</p>',
      '<pre class="mermaid">flowchart LR\nX-->Y</pre>',
      '<p>尾</p>',
    ].join('')
    const parts = splitAgentMarkdownParts(html)
    const mermaids = parts.filter((p) => p.type === 'mermaid')
    expect(mermaids).toHaveLength(2)
    expect(mermaids[0]).toMatchObject({ type: 'mermaid' })
    expect(mermaids[1]).toMatchObject({ type: 'mermaid' })
    if (mermaids[0]?.type === 'mermaid' && mermaids[1]?.type === 'mermaid') {
      expect(mermaids[0].source).toContain('graph TD')
      expect(mermaids[1].source).toContain('flowchart LR')
    }
  })

  it('deeply nested mermaid under multiple wrappers still extracts', () => {
    const html =
      '<div><section><div class="x"><pre class="mermaid">flowchart LR\nA-->B</pre></div></section></div>'
    const parts = splitAgentMarkdownParts(html)
    expect(parts.some((p) => p.type === 'mermaid')).toBe(true)
    expect(
      parts
        .filter((p) => p.type === 'html')
        .every((p) => p.type === 'html' && !/class=["'][^"']*\bmermaid\b/.test(p.html)),
    ).toBe(true)
  })

  it('渲染 $...$ 与 $$...$$ 数学公式', () => {
    expect(renderAgentMarkdown('行内 $E=mc^2$ 测试')).toContain('class="katex"')
    expect(renderAgentMarkdown('$$\frac{a}{b}$$')).toContain('katex-display')
  })

  it('渲染 \\[...\\] 与省略反斜杠的 [ ... ] 块级公式', () => {
    const bracket = String.raw`\[
\begin{aligned}
A-B &= A + B
\end{aligned}
\]`
    expect(renderAgentMarkdown(bracket)).toContain('katex')

    const bareBrackets = [
      '[',
      String.raw`\text{补码}=\text{反码}+1`,
      ']',
    ].join('\n')
    expect(renderAgentMarkdown(bareBrackets)).toContain('katex')
  })

  it('渲染 \\(...\\) 行内公式', () => {
    const html = renderAgentMarkdown(String.raw`补码 \((A+\sim B+1)\) 示例`)
    expect(html).toContain('katex')
  })

  it('渲染裸括号内的 LaTeX 命令', () => {
    const html = renderAgentMarkdown(String.raw`- (A+\sim B+1)`)
    expect(html).toContain('katex')
  })

  it('流式时临时闭合未完成的公式定界符', () => {
    const html = renderAgentMarkdown(String.raw`$$\frac{a}{`, { streaming: true })
    expect(html).toContain('katex')
  })

  it('模型输出的 XSS 载荷不可执行（解析层拦截）', () => {
    // markdown-it 默认 validateLink 拒绝 javascript: 链接，html:false 转义裸标签；
    // 即使某层放行，DOMPurify 默认 URI 规则在真实 Chromium 中也会剥 href（happy-dom
    // 下 DOMPurify 属性级行为失真，此处只锁定解析层输出）。
    const html = renderAgentMarkdown(
      [
        '[点我](javascript:alert(1))',
        '',
        '<img src="x" onerror="alert(2)" />',
      ].join('\n'),
    )
    expect(html).not.toContain('<a href="javascript')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('[点我]')
  })
})
