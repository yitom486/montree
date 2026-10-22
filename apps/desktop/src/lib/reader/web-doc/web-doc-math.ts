import katex from 'katex'
import katexStyles from 'katex/dist/katex.min.css?inline'

const INLINE_WRAP = /^\\\(([\s\S]*)\\\)$/
const DISPLAY_WRAP = /^\\\[([\s\S]*)\\\]$/
const DOLLAR_DISPLAY = /^\$\$([\s\S]*)\$\$$/
const DOLLAR_INLINE = /^\$([\s\S]*)\$$/

// 阅读器正文重置使用 !important；恢复 KaTeX 自带字号/行高，避免上下标被拉成正文大小。
const KATEX_TYPOGRAPHY_CSS = (String(katexStyles).match(/[^{}]+\{[^{}]*\}/g) ?? []).flatMap((rule) => {
  const opening = rule.indexOf('{')
  const selectors = rule.slice(0, opening).trim()
  if (!selectors.includes('.katex') || selectors.startsWith('@')) return []
  const declarations = [...rule.slice(opening + 1, -1).matchAll(/(?:^|;)\s*(font-size|line-height)\s*:\s*([^;]+)/g)]
    .map((match) => `${match[1]}:${match[2].replace(/\s*!important$/, '')} !important;`).join('')
  return declarations ? [`${selectors.split(',').map((selector) => `#montree-web-doc-content ${selector.trim()}`).join(',')}{${declarations}}`] : []
}).join('\n')

function unwrapTex(raw: string): { tex: string; displayMode: boolean } | null {
  const text = raw.trim()
  if (!text) return null

  let match = text.match(DISPLAY_WRAP)
  if (match) return { tex: match[1]!.trim(), displayMode: true }

  match = text.match(DOLLAR_DISPLAY)
  if (match) return { tex: match[1]!.trim(), displayMode: true }

  match = text.match(INLINE_WRAP)
  if (match) return { tex: match[1]!.trim(), displayMode: false }

  match = text.match(DOLLAR_INLINE)
  if (match) return { tex: match[1]!.trim(), displayMode: false }

  // MkDocs arithmatex 偶发只包公式本体
  if (/[\\^_{}]/.test(text) || /\\[a-zA-Z]+/.test(text)) {
    return { tex: text, displayMode: false }
  }

  return null
}

function renderTexToHtml(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    throwOnError: false,
    displayMode,
    strict: 'ignore',
  })
}

/** 渲染 `.arithmatex` / `.math` 等站点公式容器 */
export function renderWebDocMathElements(root: ParentNode): void {
  root.querySelectorAll('.arithmatex, .math, .katex-error').forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    if (node.closest('pre, code')) return
    if (node.querySelector('.katex')) return

    // Sphinx 将编号和锚点放在公式容器内，它们不属于 LaTeX 源码。
    const source = node.cloneNode(true) as Element
    source.querySelectorAll('.eqno').forEach((number) => number.remove())
    const parsed = unwrapTex(source.textContent ?? '')
    if (!parsed) return

    const displayMode =
      parsed.displayMode ||
      node.matches('div.math') ||
      node.classList.contains('display') ||
      node.classList.contains('arithmatex-display')

    const numbers = [...node.querySelectorAll(':scope > .eqno')]
    node.innerHTML = renderTexToHtml(parsed.tex, displayMode)
    node.prepend(...numbers)
    node.classList.add('web-doc-math-rendered')
  })
}

/**
 * 将正文中残留的 `\(...\)` / `\[...\]` 文本替换为 KaTeX（无 class 包裹时）。
 * 跳过 pre/code，避免破坏代码字面量。
 */
export function renderWebDocMathInText(root: ParentNode): void {
  const doc = root instanceof Document ? root : root.ownerDocument
  if (!doc) return

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []

  let current = walker.nextNode()
  while (current) {
    const text = current as Text
    const parent = text.parentElement
    if (
      parent &&
      !parent.closest('pre, code, .katex, .web-doc-math-rendered, script, style') &&
      /\\\(|\\\[|\$\$/.test(text.nodeValue ?? '')
    ) {
      targets.push(text)
    }
    current = walker.nextNode()
  }

  for (const textNode of targets) {
    const value = textNode.nodeValue ?? ''
    const pattern = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g
    if (!pattern.test(value)) continue
    pattern.lastIndex = 0

    const frag = doc.createDocumentFragment()
    let last = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(value))) {
      if (match.index > last) {
        frag.appendChild(doc.createTextNode(value.slice(last, match.index)))
      }
      const displayMode = Boolean(match[2] || match[3])
      const tex = (match[1] ?? match[2] ?? match[3] ?? '').trim()
      const span = doc.createElement('span')
      span.className = 'web-doc-math-rendered'
      span.innerHTML = renderTexToHtml(tex, displayMode)
      frag.appendChild(span)
      last = match.index + match[0].length
    }
    if (last < value.length) {
      frag.appendChild(doc.createTextNode(value.slice(last)))
    }
    textNode.parentNode?.replaceChild(frag, textNode)
  }
}

export function enhanceWebDocMath(html: string): string {
  if (!/arithmatex|katex-error|\\\(|\\\[|\$\$|class=["'][^"']*\bmath\b/.test(html)) {
    return html
  }

  const doc = new DOMParser().parseFromString(`<div id="web-doc-math-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('web-doc-math-root')
  if (!root) return html

  renderWebDocMathElements(root)
  renderWebDocMathInText(root)
  return root.innerHTML
}

/** 使用随应用打包的同版本样式和字体；srcdoc 中的资源地址以宿主为基准。 */
export function buildWebDocKatexStyles(): string {
  const css = String(katexStyles).replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, _quote: string, url: string) => {
    try { return `url("${new URL(url, window.location.href).href}")` } catch { return match }
  })
  return `<style data-web-doc-katex>${css}</style>`
}

export function buildWebDocMathCss(): string {
  return `
    ${KATEX_TYPOGRAPHY_CSS}
    .web-doc-math-rendered {
      display: inline;
    }
    .katex-display {
      margin: 0.75em 0;
      overflow-x: auto;
      overflow-y: hidden;
    }
    .arithmatex .katex,
    .math .katex {
      font-size: 1.05em;
    }
    body .katex, body .katex * { max-width: none !important; box-sizing: content-box !important; }
    body .katex svg { height: inherit !important; max-height: none !important; }
    .math > .eqno { float: right; margin-left: 0.75em; }
  `
}
