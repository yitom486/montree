import DOMPurify, { type Config } from 'dompurify'
import { patchStreamingMathDelimiters } from '@/lib/editor/latex-delimiters'
import { renderMarkdown } from '@/lib/editor/markdown'

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

/**
 * Agent markdown-it 渲染（S2 起仅供阅读器批注/知识卡片等一次性正文使用；
 * 聊天主时间线已切 Streamdown 入口 `components/markdown/AgentMarkdown`）。
 * 流式补全未闭合 fence/公式，避免半截内容被吞。
 */
export function renderAgentMarkdown(
  text: string,
  options?: { streaming?: boolean },
): string {
  if (!text.trim()) return ''
  const patched = options?.streaming
    ? patchStreamingMathDelimiters(text)
    : text
  return sanitizeAgentHtml(renderMarkdown(patched, undefined, { strictSafe: true }))
}
