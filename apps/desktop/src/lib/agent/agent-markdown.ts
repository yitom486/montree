import DOMPurify, { type Config } from 'dompurify'
import { patchStreamingMathDelimiters } from '@/lib/editor/latex-delimiters'
import { markdownParser, renderMarkdown } from '@/lib/editor/markdown'
import { isInsideFence } from '@/lib/agent/streaming-split'

export type { AgentMarkdownPart, MarkdownPart } from '@/lib/editor/markdown-parts'
export { splitAgentMarkdownParts, splitMarkdownParts } from '@/lib/editor/markdown-parts'

/** 与预览同源消毒策略；保留 pre.mermaid / code-block class 供后续 hook 使用 */
import { PREVIEW_SANITIZE_OPTIONS } from '@/lib/preview/preview-sanitize'

/** 与预览同源消毒策略；保留 details / HTML 样式 / Alerts 供聊天卡片使用 */
const AGENT_SANITIZE_OPTIONS: Config = PREVIEW_SANITIZE_OPTIONS

/**
 * 包一层再消毒：sole-root 的 `<pre>` / `<div class="mermaid">` 在 DOMPurify+happy-dom
 * （及部分浏览器 fragment 路径）会被剥掉，导致纯 Mermaid 消息丢图。
 */
function sanitizeAgentHtml(html: string): string {
  return String(DOMPurify.sanitize(`<div>${html}</div>`, AGENT_SANITIZE_OPTIONS))
}

/** 流式未闭合的 ``` fence 先补全，避免半截内容被吞或整段挤进异常节点 */
export function patchStreamingMarkdownFences(text: string): string {
  if (!text.trim()) return text
  const fenceCount = (text.match(/^```/gm) ?? []).length
  return fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text
}

/**
 * Agent 气泡统一 Markdown 渲染（流式 / 完成共用同一套 markdown-it + 消毒）。
 * 流式仅额外补全未闭合 fence，避免结束后换渲染器导致整页重排。
 */
export function renderAgentMarkdown(
  text: string,
  options?: { streaming?: boolean },
): string {
  if (!text.trim()) return ''
  const patched = options?.streaming
    ? patchStreamingMathDelimiters(patchStreamingMarkdownFences(text))
    : text
  return sanitizeAgentHtml(renderMarkdown(patched, undefined, { strictSafe: true }))
}

/** @deprecated 使用 renderAgentMarkdown(text, { streaming: true }) */
export function renderAgentMarkdownStreaming(text: string): string {
  return renderAgentMarkdown(text, { streaming: true })
}

/**
 * 流式尾部轻量渲染：尾部落在未闭合围栏里时，代码部分跳过 highlight.js
 * （逐帧全量高亮是长代码回复的核心卡点），只做转义直出；
 * 围栏前的普通文本仍走正常管线。完成态不走这里。
 */
export function renderStreamingTail(stableAndTail: string, tail: string): string {
  if (!tail) return ''
  if (!isInsideFence(stableAndTail)) {
    return renderAgentMarkdown(tail, { streaming: true })
  }
  const fenceStart = tail.lastIndexOf('```')
  const head = fenceStart >= 0 ? tail.slice(0, fenceStart) : ''
  const code = fenceStart >= 0 ? tail.slice(fenceStart).replace(/^```[^\n]*\n?/, '') : tail
  const headHtml = head.trim() ? renderAgentMarkdown(head, { streaming: true }) : ''
  const esc = markdownParser.utils.escapeHtml(code)
  // 剥掉外层 <div> 包裹取内层，保持与 sanitizeAgentHtml 一致的清洗路径
  const plain = sanitizeAgentHtml(`<pre><code>${esc}\n</code></pre>`)
  return `${headHtml}${plain}`
}
