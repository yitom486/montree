import { mermaidLog, summarizeMermaidSource } from '@/lib/preview/mermaid-debug'

export type MarkdownPart =
  | { type: 'html'; html: string }
  | { type: 'mermaid'; source: string; id: string }

/** @deprecated 使用 MarkdownPart */
export type AgentMarkdownPart = MarkdownPart

function isMermaidElement(el: Element): boolean {
  const className = el.getAttribute('class') ?? ''
  return (
    className.split(/\s+/).includes('mermaid') ||
    className.split(/\s+/).includes('mermaid-hydrating')
  )
}

/**
 * 把消毒后的 HTML 拆成「普通 HTML」与「Mermaid 源码」片段（预览 / Agent 共用）。
 * 必须递归：DOMPurify 常保留外层 `<div>`，Mermaid 会变成嵌套节点。
 */
export function splitMarkdownParts(html: string): MarkdownPart[] {
  if (!html.trim()) return []
  if (typeof DOMParser === 'undefined') {
    return [{ type: 'html', html }]
  }

  const doc = new DOMParser().parseFromString(
    `<div id="montree-md-split">${html}</div>`,
    'text/html',
  )
  const root = doc.getElementById('montree-md-split') ?? doc.body
  const parts: MarkdownPart[] = []
  let htmlBuf = ''
  let mermaidSeq = 0

  const flushHtml = () => {
    if (!htmlBuf) return
    parts.push({ type: 'html', html: htmlBuf })
    htmlBuf = ''
  }

  const walk = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      if (isMermaidElement(el)) {
        flushHtml()
        const source = (
          el.getAttribute('data-mermaid-source') ||
          el.textContent ||
          ''
        ).trim()
        if (source) {
          parts.push({ type: 'mermaid', source, id: `mmd-${++mermaidSeq}` })
        }
        return
      }

      if (el.querySelector?.('.mermaid, .mermaid-hydrating')) {
        for (const child of Array.from(el.childNodes)) {
          walk(child)
        }
        return
      }

      htmlBuf += el.outerHTML
      return
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) htmlBuf += text
    }
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child)
  }

  flushHtml()
  const result = parts.length > 0 ? parts : [{ type: 'html' as const, html }]
  const mermaidParts = result.filter((p) => p.type === 'mermaid')
  mermaidLog(`split:parts mmd=${mermaidParts.length}/${result.length}`, {
    nestedHtmlHadMermaid: /class=["'][^"']*\bmermaid\b/.test(html),
    mermaids: mermaidParts.map((p) =>
      p.type === 'mermaid' ? { id: p.id, ...summarizeMermaidSource(p.source) } : null,
    ),
  })
  return result
}

/** @deprecated 使用 splitMarkdownParts */
export const splitAgentMarkdownParts = splitMarkdownParts
