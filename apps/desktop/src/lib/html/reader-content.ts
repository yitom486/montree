import type { ReaderUnitText } from '@/lib/agent/context/reader-content-registry'

/** 不应进入阅读正文的结构：脚本、样式、导航和页脚。 */
const SKIP_SELECTOR = 'script,style,noscript,template,nav,aside,footer,[hidden],[aria-hidden="true"],[role="navigation"]'
/** 用于还原段落/标题换行的块级元素。 */
const BLOCK_SELECTOR = 'address,article,blockquote,dd,div,dl,dt,fieldset,figcaption,figure,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,ol,p,pre,section,table,tbody,td,tfoot,th,thead,tr,ul'
const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6'

export interface HtmlReaderContent {
  /** 脚本执行后的可见纯文本，不含 HTML 标签。 */
  text: string
  /** 以标题切分的阅读单元；无标题时返回单个「正文」。 */
  units: ReaderUnitText[]
}

/**
 * 从已渲染的 HTML DOM 提取 Agent 可读正文。
 * 优先使用 `<main>/<article>` 与同页 `<header>`，排除导航、页脚和隐藏节点；
 * 无标题时退化为整篇正文，保证 `montree_read` 始终能读取。
 */
export function readHtmlReaderContent(root: HTMLElement | null): HtmlReaderContent {
  if (!root) return { text: '', units: [{ label: '正文', text: '' }] }

  const roots = selectContentRoots(root)
  const text = normalizeText(roots.map((item) => extractText(item)).filter(Boolean).join('\n\n'))
  const headings = roots.flatMap((item) =>
    Array.from(item.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).filter((heading) => !isHidden(heading)),
  )

  if (headings.length === 0) {
    return { text, units: [{ label: '正文', text }] }
  }

  const units = headings.map((heading, index) => {
    const next = headings[index + 1]
    const sectionRoot = roots.find((item) => item.contains(heading)) ?? heading.ownerDocument.body
    return {
      label: normalizeInline(heading.textContent ?? '') || `第 ${index + 1} 节`,
      level: Number(heading.tagName.slice(1)),
      text: extractSectionText(heading, next, sectionRoot),
    }
  })
  return { text, units }
}

function selectContentRoots(root: HTMLElement): HTMLElement[] {
  if (root.matches('main,article,[role="main"]')) return [root]
  const main = root.querySelector<HTMLElement>('main,article,[role="main"]')
  if (!main) return [root]

  const header = Array.from(root.querySelectorAll<HTMLElement>('header')).find(
    (item) => !main.contains(item) && !item.closest(SKIP_SELECTOR) && !isHidden(item),
  )
  return header ? [header, main] : [main]
}

function extractSectionText(heading: HTMLElement, next: HTMLElement | undefined, root: HTMLElement): string {
  try {
    const range = heading.ownerDocument.createRange()
    range.setStartBefore(heading)
    if (next) range.setEndBefore(next)
    else range.setEnd(root, root.childNodes.length)
    const wrapper = heading.ownerDocument.createElement('div')
    wrapper.append(range.cloneContents())
    return normalizeText(extractText(wrapper))
  } catch {
    return normalizeText(heading.textContent ?? '')
  }
}

function extractText(root: HTMLElement): string {
  const connected = root.isConnected && Boolean(root.ownerDocument.defaultView)
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let output = ''
  let lastBlock: Element | null = null

  while (walker.nextNode()) {
    const node = walker.currentNode
    const parent = node.parentElement
    const value = node.textContent?.replace(/\s+/g, ' ').trim()
    if (!parent || !value || parent.closest(SKIP_SELECTOR) || isHidden(parent, connected)) continue

    const block = parent.closest(BLOCK_SELECTOR)
    if (block !== lastBlock) {
      if (output) output += '\n'
      lastBlock = block
    } else if (output && !output.endsWith('\n')) {
      output += ' '
    }
    output += value
  }
  return output
}

function isHidden(element: Element, connected = element.isConnected): boolean {
  if (element.closest('[hidden],[aria-hidden="true"]')) return true
  const style = element.getAttribute('style') ?? ''
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true
  if (!connected) return false
  const view = element.ownerDocument.defaultView
  if (!view) return false
  const computed = view.getComputedStyle(element)
  return computed.display === 'none' || computed.visibility === 'hidden'
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
