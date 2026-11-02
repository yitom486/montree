import type { WebReadingAnchor } from '@yitom/contracts'
import { markdownPreviewUrl } from '@montree/workspace-core'

const HEADINGS = 'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'
const clean = (text: string) => text.replace(/\s/g, '')

export function markdownHeadingAt(root: HTMLElement, range: Range): string | undefined {
  let result: string | undefined
  for (const heading of root.querySelectorAll<HTMLElement>(HEADINGS)) {
    if (heading.contains(range.startContainer) || (heading.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)) result = heading.id
    else break
  }
  return result
}

export function captureMarkdownReference(root: HTMLElement, range: Range, filePath: string): WebReadingAnchor {
  const before = range.cloneRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const after = range.cloneRange()
  after.selectNodeContents(root)
  after.setStart(range.endContainer, range.endOffset)
  return {
    format: 'web', url: markdownPreviewUrl(filePath), headingId: markdownHeadingAt(root, range),
    selectedText: range.toString().trim(),
    quote: { exact: range.toString().trim(), prefix: before.toString().slice(-64), suffix: after.toString().slice(0, 64) },
  }
}

export type MarkdownReferenceResult = { status: 'matched'; range: Range } | { status: 'missing' | 'ambiguous' }

/** 只匹配完整摘录；多处同文用上下文和章节消歧，绝不以模糊前缀静默跳错段落。 */
export function resolveMarkdownReference(root: HTMLElement, anchor: WebReadingAnchor): MarkdownReferenceResult {
  const needle = clean(anchor.quote?.exact || anchor.selectedText || '')
  if (!needle) return { status: 'missing' }
  const nodes: Array<{ node: Text; from: number; to: number }> = []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ''
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const excluded = node.parentElement?.closest('button,script,style,textarea,select,[aria-hidden="true"]')
    // Dialog 会临时把整个应用设为 aria-hidden；只排除正文内部的装饰与控件。
    if (excluded && excluded !== root && root.contains(excluded)) continue
    nodes.push({ node, from: text.length, to: text.length + node.length })
    text += node.data
  }
  const indices: number[] = []
  let normalized = ''
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue
    normalized += text[i]
    indices.push(i)
  }
  const candidates: Array<{ range: Range; context: boolean; chapter: boolean }> = []
  for (let at = normalized.indexOf(needle); at >= 0; at = normalized.indexOf(needle, at + 1)) {
    if (candidates.length > 500) return { status: 'ambiguous' }
    const from = indices[at], to = indices[at + needle.length - 1] + 1
    const start = nodes.find((item) => from >= item.from && from < item.to)
    const end = nodes.find((item) => to > item.from && to <= item.to)
    if (!start || !end) continue
    const range = root.ownerDocument.createRange()
    range.setStart(start.node, from - start.from)
    range.setEnd(end.node, to - end.from)
    const prefix = clean(anchor.quote?.prefix ?? '')
    const suffix = clean(anchor.quote?.suffix ?? '')
    candidates.push({ range,
      context: Boolean(prefix || suffix) && (!prefix || clean(text.slice(0, from)).endsWith(prefix)) && (!suffix || clean(text.slice(to)).startsWith(suffix)),
      chapter: Boolean(anchor.headingId) && markdownHeadingAt(root, range) === anchor.headingId,
    })
  }
  if (!candidates.length) return { status: 'missing' }
  if (candidates.length === 1) return { status: 'matched', range: candidates[0].range }
  const contextual = candidates.filter((item) => item.context)
  if (contextual.length === 1) return { status: 'matched', range: contextual[0].range }
  const chapter = (contextual.length ? contextual : candidates).filter((item) => item.chapter)
  return chapter.length === 1 ? { status: 'matched', range: chapter[0].range } : { status: 'ambiguous' }
}
