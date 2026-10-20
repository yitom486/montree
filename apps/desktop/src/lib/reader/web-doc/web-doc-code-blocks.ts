import githubTheme from 'highlight.js/styles/github.min.css?inline'
import githubDarkTheme from 'highlight.js/styles/github-dark.min.css?inline'
import { highlightCode, hljs, normalizeHighlightLanguage } from '@/lib/editor/code-highlight'
import type { EpubThemeMode } from '@yitom/reader-core'
import { READER_PALETTE } from '@yitom/reader-core'
import { buildCodeBlockToolbarHtml } from '@/lib/preview/code-block-chrome'
import { stripCodeBlockLineNumbers } from '@/lib/reader/web-doc/web-doc-chrome'

const LANGUAGE_CLASS = /\blanguage-([\w-]+)\b/i
const LANG_CLASS = /\blang-([\w-]+)\b/i
const SP_LANG_CLASS = /\bsp-(javascript|typescript|jsx|tsx|json|css|html|bash|shell|python|java|go|rust|yaml|markdown|md)\b/i
const HLJS_LANG_CLASS = /\bhljs-([\w-]+)\b/i
/** MDN / 旧版 wiki 语法：`<pre class="brush: js notranslate">` */
const BRUSH_LANG_CLASS = /\bbrush:\s*([\w.+#-]+)/i
/** GitHub 代码块：`highlight highlight-source-js` */
const HIGHLIGHT_SOURCE_CLASS = /\bhighlight-source-([\w.+#-]+)\b/i
/** Sphinx / Pygments：`highlight-python` */
const HIGHLIGHT_LANG_CLASS = /\bhighlight-(?!source-)([\w.+#-]+)\b/i
const DIRECT_CODE_EXAMPLE_HEADER_SELECTOR = ':scope > .example-header, :scope > .code-example-header, :scope > [class*="example-header"], :scope > [class*="code-example-header"]'
const CODE_FILENAME_SELECTOR = [
  '[data-filename]',
  '.filename',
  '[class*="filename"]',
  '[class*="file-name"]',
  '[class*="codeBlockTitle"]',
  '[class*="code-block-title"]',
  '[class*="code-title"]',
].join(', ')
const KNOWN_CODE_FILENAMES =
  /^(?:Dockerfile|Makefile|Gemfile|Rakefile|Procfile|Vagrantfile|CMakeLists\.txt|Justfile|Brewfile|Earthfile)$/i

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  py: 'python',
  python: 'python',
  rb: 'ruby',
  ruby: 'ruby',
  rs: 'rust',
  rust: 'rust',
  golang: 'go',
  go: 'go',
  kt: 'kotlin',
  kotlin: 'kotlin',
  cs: 'csharp',
  'c#': 'csharp',
  csharp: 'csharp',
  'c++': 'cpp',
  cpp: 'cpp',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  bash: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  htm: 'html',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  plain: 'text',
  plaintext: 'text',
  'plain-text': 'text',
  txt: 'text',
  text: 'text',
}

function canonicalizeLanguage(raw: string): string {
  const token = raw.trim().toLowerCase().replace(/[;,]+$/, '')
  if (!token) return 'text'
  const compact = token.replace(/\s+/g, '-')
  return LANGUAGE_ALIASES[token] ?? LANGUAGE_ALIASES[compact] ?? compact
}

function languageFromCodeExampleHeader(node: Element): string | null {
  const parent = node.parentElement
  if (!parent) return null
  const header = parent.querySelector(DIRECT_CODE_EXAMPLE_HEADER_SELECTOR)
  if (!header) return null
  const label = header.matches('[data-language], [data-language-name]')
    ? header
    : header.querySelector('.language-name, [data-language-name], [data-language]')
  if (!label) return null
  const raw =
    label.getAttribute('data-language') ??
    label.getAttribute('data-language-name') ??
    label.textContent ??
    ''
  if (!raw.trim()) return null
  const language = canonicalizeLanguage(raw)
  return language === 'text' ? null : language
}

/** MkDocs / pymdownx 多语言 Tab 标签 → 工具栏语言名 */
const TABBED_LABEL_LANG: Record<string, string> = {
  python: 'python',
  'c++': 'cpp',
  cpp: 'cpp',
  java: 'java',
  'c#': 'csharp',
  csharp: 'csharp',
  go: 'go',
  golang: 'go',
  swift: 'swift',
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  dart: 'dart',
  rust: 'rust',
  c: 'c',
  kotlin: 'kotlin',
  ruby: 'ruby',
}

function langFromTabLabel(label: string): string {
  const key = label.trim().toLowerCase()
  const mapped = TABBED_LABEL_LANG[key]
  if (mapped) return mapped
  const cleaned = key.replace(/[^a-z0-9#+.-]/gi, '')
  return cleaned || 'text'
}

function inferLanguageFromContent(text: string): string | null {
  const sample = text.trim().slice(0, 400)
  if (!sample) return null
  if (/^\s*<\?xml/m.test(sample)) return 'xml'
  if (/^\s*<!DOCTYPE html/i.test(sample) || /<\/?[a-z][\s\S]*>/i.test(sample)) return 'html'
  if (/^\s*#\!/.test(sample) || /^\$\s+\w+/.test(sample)) return 'bash'
  if (/^\s*(import|export)\s+/m.test(sample) || /\b(function|const|let|var)\s+\w+/m.test(sample)) {
    return /<\w+/.test(sample) ? 'jsx' : 'javascript'
  }
  return null
}

function detectCodeLanguage(node: Element): string {
  const sources = [
    node.className,
    node.querySelector('code')?.className ?? '',
    node.parentElement?.className ?? '',
  ]

  for (const source of sources) {
    const language = source.match(LANGUAGE_CLASS)?.[1] ?? source.match(LANG_CLASS)?.[1]
    if (language) return canonicalizeLanguage(language)

    const sp = source.match(SP_LANG_CLASS)?.[1]
    if (sp) return canonicalizeLanguage(sp)

    const hljs = source.match(HLJS_LANG_CLASS)?.[1]
    if (hljs) return canonicalizeLanguage(hljs)

    const brush = source.match(BRUSH_LANG_CLASS)?.[1]
    if (brush) return canonicalizeLanguage(brush)

    const highlightSource = source.match(HIGHLIGHT_SOURCE_CLASS)?.[1]
    if (highlightSource) return canonicalizeLanguage(highlightSource)

    const highlight = source.match(HIGHLIGHT_LANG_CLASS)?.[1]
    if (highlight) return canonicalizeLanguage(highlight)
  }

  const code = node.querySelector('code')
  const dataLang =
    node.getAttribute('data-language') ??
    node.getAttribute('data-code-language') ??
    node.getAttribute('data-lang') ??
    code?.getAttribute('data-language') ??
    code?.getAttribute('data-code-language') ??
    code?.getAttribute('data-lang') ??
    node.closest('[data-code-language]')?.getAttribute('data-code-language') ??
    node.closest('[data-language]')?.getAttribute('data-language')
  if (dataLang?.trim()) return canonicalizeLanguage(dataLang)

  const langAttr =
    node.getAttribute('lang') ?? code?.getAttribute('lang') ?? node.querySelector('pre')?.getAttribute('lang')
  if (langAttr?.trim()) return canonicalizeLanguage(langAttr)

  // MDN 的 `<span class="language-name">js</span>` 位于 pre 的兄弟头部；
  // 部分站点只给出这个标签，pre 自身没有 language/brush class。
  const headerLanguage = languageFromCodeExampleHeader(node)
  if (headerLanguage) return headerLanguage

  const pre = node.tagName === 'PRE' ? node : node.querySelector('pre')
  const inferred = inferLanguageFromContent(pre?.textContent ?? node.textContent ?? '')
  if (inferred) return canonicalizeLanguage(inferred)

  return 'text'
}

/**
 * MDN 的代码语言与复制按钮在 `.example-header` 中，阅读器工具栏已经承担同样职责；
 * 保留头部会让语言名（如独立的 “js”）作为正文段落重复出现。
 */
function removeRedundantCodeExampleHeader(pre: Element): void {
  const container = pre.closest('.code-example, .code-example-container')
  const header = container?.querySelector(DIRECT_CODE_EXAMPLE_HEADER_SELECTOR)
  if (!header) return
  // 头部若带文件名则保留，避免只清理语言标签时丢掉文件信息。
  if (header.querySelector('a[href], .filename, [class*="filename"], [class*="file-name"]')) return
  // 只有语言标签 / 复制按钮 / 空白的头部才是重复信息；带标题的头部必须保留。
  const residual = header.cloneNode(true) as Element
  residual.querySelectorAll('.language-name, [data-language-name], [data-language], button').forEach((node) => node.remove())
  if (residual.textContent?.trim()) return
  header.remove()
}

function isLanguageWrapper(div: HTMLElement): boolean {
  if (div.classList.contains('code-block')) return false
  if (
    LANGUAGE_CLASS.test(div.className) ||
    LANG_CLASS.test(div.className) ||
    HIGHLIGHT_LANG_CLASS.test(div.className) ||
    div.classList.contains('highlight')
  ) {
    return true
  }
  return false
}

function isPreOnlyWrapper(div: HTMLElement): boolean {
  return [...div.childNodes].every((node) => {
    if (node.nodeType === Node.TEXT_NODE) return !node.textContent?.trim()
    return node instanceof HTMLPreElement
  })
}

function collectCodeBlockHosts(root: ParentNode): HTMLElement[] {
  const hosts: HTMLElement[] = []
  const seen = new Set<HTMLElement>()

  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.closest('.code-block')) return
    const text = pre.textContent?.replace(/\u00a0/g, ' ').trim()
    if (!text) return

    const parent = pre.parentElement
    if (parent && parent !== root && parent.tagName === 'DIV' && isLanguageWrapper(parent) && isPreOnlyWrapper(parent)) {
      if (!seen.has(parent)) {
        seen.add(parent)
        hosts.push(parent)
      }
      return
    }

    if (!seen.has(pre)) {
      seen.add(pre)
      hosts.push(pre)
    }
  })

  return hosts
}

function looksLikeCodeFilename(value: string): boolean {
  if (!value || value.length > 120 || /\s/.test(value)) return false
  return /[\\/]/.test(value) || /\.[a-z0-9]{1,12}$/i.test(value) || KNOWN_CODE_FILENAMES.test(value)
}

interface CodeBlockFilename {
  filename: string
  source: HTMLElement | null
}

/**
 * 通用文件名提升：Pygments/MkDocs 的 `.filename`、Docusaurus 的 `codeBlockTitle`、
 * 以及 `data-filename`。只接受短且像文件名的文本，普通标题保持原位。
 */
function detectCodeBlockFilename(host: HTMLElement): CodeBlockFilename | null {
  const pre = host.tagName === 'PRE' ? host : host.querySelector('pre')
  const code = pre?.querySelector('code') ?? host.querySelector('code')
  const explicit =
    host.getAttribute('data-filename') ??
    pre?.getAttribute('data-filename') ??
    code?.getAttribute('data-filename')
  if (explicit?.trim()) return { filename: explicit.trim(), source: null }

  const scope =
    host.closest('.highlight, [class*="codeBlockContainer"], [class*="code-block-container"], figure') ??
    host.parentElement
  if (!scope) return null

  for (const candidate of scope.querySelectorAll<HTMLElement>(CODE_FILENAME_SELECTOR)) {
    if (candidate === host || candidate.contains(host)) continue
    if (candidate.closest('pre, code')) continue
    // 交互元素保留原链接/按钮，不搬进工具栏。
    if (candidate.closest('a, button')) continue
    // 文件名通常位于代码块之前；避免把后一个代码块的标题挂到当前块。
    if (!(candidate.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING)) continue

    const text = (candidate.getAttribute('data-filename') ?? candidate.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    if (!candidate.hasAttribute('data-filename') && !looksLikeCodeFilename(text)) continue
    return { filename: text, source: candidate }
  }
  return null
}

function wrapCodeBlockHost(host: HTMLElement): void {
  const pre = host.tagName === 'PRE' ? host : host.querySelector('pre')
  if (!pre) return

  const lang = detectCodeLanguage(host)
  const filename = detectCodeBlockFilename(host)
  pre.setAttribute('data-language', lang)
  const doc = host.ownerDocument
  const wrapper = doc.createElement('div')
  wrapper.className = 'code-block'
  wrapper.innerHTML = buildCodeBlockToolbarHtml(lang, filename?.filename)

  const body = doc.createElement('div')
  body.className = 'code-block-body'
  wrapper.appendChild(body)

  const parent = host.parentNode
  if (!parent) return

  parent.insertBefore(wrapper, host)
  body.appendChild(pre)
  if (host !== pre) {
    host.remove()
  }
  filename?.source?.remove()
  removeRedundantCodeExampleHeader(pre)
}

/**
 * 将 MkDocs pymdownx `tabbed-set`（无站点 CSS 时语言名会粘成 PythonC++Java…）
 * 转为可读的语言切换 Tab；优先保留默认选中项，否则优先 Python。
 */
export function normalizeWebDocTabbedSets(root: ParentNode): void {
  const sets = [...root.querySelectorAll('.tabbed-set')]
  for (const set of sets) {
    if (!(set instanceof HTMLElement)) continue
    const doc = set.ownerDocument
    if (!doc) continue

    const labels = [...set.querySelectorAll('.tabbed-labels > label')].map(
      (node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    )
    const blocks = [...set.querySelectorAll('.tabbed-content > .tabbed-block')]
    if (labels.length === 0 || blocks.length === 0) {
      set.querySelector('.tabbed-labels')?.remove()
      set.querySelectorAll('input[type="radio"]').forEach((node) => node.remove())
      continue
    }

    const count = Math.min(labels.length, blocks.length)
    let activeIndex = 0
    const checked = set.querySelector('input[type="radio"][checked], input[type="radio"]:checked')
    if (checked instanceof HTMLInputElement) {
      const inputs = [...set.querySelectorAll('input[type="radio"]')]
      const idx = inputs.indexOf(checked)
      if (idx >= 0 && idx < count) activeIndex = idx
    } else {
      const pythonIdx = labels.findIndex((label, i) => i < count && /^python$/i.test(label))
      if (pythonIdx >= 0) activeIndex = pythonIdx
    }

    const tabs = doc.createElement('div')
    tabs.className = 'web-doc-tabs'

    const bar = doc.createElement('div')
    bar.className = 'web-doc-tabs-bar'
    bar.setAttribute('role', 'tablist')
    bar.setAttribute('aria-label', '代码语言')

    const panels = doc.createElement('div')
    panels.className = 'web-doc-tabs-panels'

    for (let i = 0; i < count; i++) {
      const label = labels[i] || `Lang ${i + 1}`
      const lang = langFromTabLabel(label)
      const selected = i === activeIndex

      const tab = doc.createElement('button')
      tab.type = 'button'
      tab.className = 'web-doc-tabs-tab'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
      tab.setAttribute('data-tab-index', String(i))
      tab.setAttribute('data-web-doc-tab', '')
      tab.textContent = label
      bar.appendChild(tab)

      const panel = doc.createElement('div')
      panel.className = 'web-doc-tabs-panel'
      panel.setAttribute('role', 'tabpanel')
      panel.setAttribute('data-tab-index', String(i))
      panel.setAttribute('data-language', lang)
      if (!selected) {
        panel.setAttribute('hidden', '')
        panel.style.setProperty('display', 'none', 'important')
      }

      const block = blocks[i]
      if (block) {
        while (block.firstChild) {
          panel.appendChild(block.firstChild)
        }
      }

      // 供后续 code-block 包装识别语言（highlight 往往不带 language-*）
      panel.querySelectorAll('pre, code, .highlight').forEach((node) => {
        if (!(node instanceof HTMLElement)) return
        if (!LANGUAGE_CLASS.test(node.className) && !LANG_CLASS.test(node.className)) {
          node.setAttribute('data-language', lang)
        }
      })

      panels.appendChild(panel)
    }

    tabs.appendChild(bar)
    tabs.appendChild(panels)
    set.replaceWith(tabs)
  }
}

/** iframe 内切换 web-doc 多语言代码 Tab */
export function activateWebDocCodeTab(tabButton: Element): boolean {
  if (!(tabButton instanceof HTMLElement)) return false
  const root = tabButton.closest('.web-doc-tabs')
  if (!root) return false
  const index = tabButton.getAttribute('data-tab-index')
  if (index == null) return false

  root.querySelectorAll('.web-doc-tabs-tab').forEach((btn) => {
    const selected = btn.getAttribute('data-tab-index') === index
    btn.setAttribute('aria-selected', selected ? 'true' : 'false')
  })
  root.querySelectorAll('.web-doc-tabs-panel').forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return
    if (panel.getAttribute('data-tab-index') === index) {
      panel.removeAttribute('hidden')
      panel.style.removeProperty('display')
    } else {
      panel.setAttribute('hidden', '')
      panel.style.setProperty('display', 'none', 'important')
    }
  })
  return true
}

/** 写入阅读文档的可信脚本（非远端 HTML），不依赖宿主 React 事件绑定 */
export { buildWebDocTabsRuntimeScript } from './web-doc-runtime-scripts'

/**
 * Tab 运行时内联脚本的 CSP hash（`src/index.html` script-src 放行）。
 * 改脚本正文必须同步更新此值（有单测锁定），否则在线文档代码 Tab 失效。
 */
export const WEB_DOC_TABS_RUNTIME_SCRIPT_SHA256 =
  'sha256-o5eUpYe6xVdLRtL5mmEZtzhPc0HijWnKllVh5rCb/60='

/**
 * 将 arXiv / LaTeXML 的学术代码清单 (`.ltx_lstlisting` / `.ltx_listing`)
 * 规范化为标准 `<pre><code class="language-...">` 结构，
 * 将行内代码拼装完整，并支持一键复制与语言标签识别。
 */
export function normalizeWebDocLatexListings(root: ParentNode): void {
  const candidates = [...root.querySelectorAll('.ltx_listing, .ltx_lstlisting, .ltx_float')]
  const listings = candidates.filter((el) => {
    if (el.tagName === 'FIGURE' && el.querySelector('.ltx_listing, .ltx_lstlisting')) {
      return false
    }
    return el.querySelector('.ltx_listingline') !== null
  })

  for (const listing of listings) {
    if (!(listing instanceof HTMLElement)) continue
    if (listing.closest('.code-block')) continue

    const lines = [...listing.querySelectorAll('.ltx_listingline')]
    if (lines.length === 0) continue

    const langElement =
      (listing.getAttribute('class')?.includes('ltx_lst_language_') ? listing : null) ??
      listing.closest('[class*="ltx_lst_language_"]') ??
      listing.querySelector('[class*="ltx_lst_language_"]') ??
      listing
    const langClass = langElement?.getAttribute('class') ?? ''
    const langMatch = langClass.match(/(?:^|\s)ltx_lst_language_([a-zA-Z0-9_-]+)/i)
    const lang = langMatch ? langMatch[1].toLowerCase() : 'text'

    const doc = listing.ownerDocument
    const pre = doc.createElement('pre')
    pre.className = `language-${lang}`
    const code = doc.createElement('code')
    code.className = `language-${lang}`

    code.innerHTML = lines.map((line) => line.innerHTML).join('\n')
    pre.appendChild(code)

    // 清理掉 arXiv 原始可能存在的孤立下载箭头，统一由 CodeBlock 提供工具栏
    listing.querySelector('.ltx_listing_data')?.remove()

    listing.replaceWith(pre)
  }
}

/** Reuse preview grammars; replace site-specific token markup without changing the source text. */
function highlightWebDocCode(pre: Element): void {
  const language = normalizeHighlightLanguage(detectCodeLanguage(pre))
  if (language === 'plaintext' || !hljs.getLanguage(language)) return
  let source = pre.textContent ?? ''
  const lines = [...pre.querySelectorAll('code > .line, code > .syntax-highlighter-line, :scope > .line')]
  if (lines.length > 1 && !source.includes('\n') && lines.map(line => line.textContent).join('') === source) {
    source = lines.map(line => line.textContent).join('\n')
  }
  // Bound synchronous work on imported pages; oversized listings remain readable and copyable.
  if (!source || source.length > 100_000) return
  const code = pre.ownerDocument.createElement('code')
  code.className = `hljs language-${language}`
  code.innerHTML = highlightCode(source, language)
  pre.replaceChildren(code)
}

/** Reader typography forces span colors; scoped token rules must override that without altering prose. */
function scopeHighlightTheme(css: string): string {
  return (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) ?? []).map(rule => {
    const opening = rule.indexOf('{')
    const selectors = rule.slice(0, opening).split(',').filter(selector => selector.includes('.hljs-'))
      .map(selector => `body .web-doc-reader-content .code-block pre code.hljs ${selector.trim()}`)
    if (!selectors.length) return ''
    const declarations = rule.slice(opening + 1, -1).replace(/([\w-]+)\s*:\s*([^;]+)(;|$)/g,
      (_, property: string, value: string) => `${property}:${value.trim()} !important;`)
    return `${selectors.join(',')}{${declarations}}`
  }).join('\n')
}

const HIGHLIGHT_THEMES = { light: scopeHighlightTheme(githubTheme), dark: scopeHighlightTheme(githubDarkTheme) }

/** 为在线文档正文中的 pre/code 注入与 Markdown 预览一致的语法高亮与复制工具栏 */
export function enhanceWebDocCodeBlocks(html: string): string {
  if (
    !html.includes('<pre') &&
    !html.includes('tabbed-set') &&
    !html.includes('ltx_listing') &&
    !html.includes('ltx_lstlisting')
  ) {
    return html
  }

  const doc = new DOMParser().parseFromString(`<div id="web-doc-code-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('web-doc-code-root')
  if (!root) return html

  stripCodeBlockLineNumbers(root)
  normalizeWebDocTabbedSets(root)
  normalizeWebDocLatexListings(root)

  for (const host of collectCodeBlockHosts(root)) {
    wrapCodeBlockHost(host)
  }

  root.querySelectorAll('.code-block pre').forEach(highlightWebDocCode)
  return root.innerHTML
}

export function buildWebDocCodeBlockCss(mode: EpubThemeMode): string {
  const palette = READER_PALETTE[mode]
  const border = mode === 'dark' ? '#3f3f46' : '#e4e4e7'
  const surface = mode === 'dark' ? '#27272a' : '#f4f4f5'
  const toolbar = mode === 'dark' ? '#1f1f23' : '#ececee'
  const copyBg = mode === 'dark' ? '#18181b' : '#fafafa'
  const muted = mode === 'dark' ? '#a1a1aa' : '#71717a'
  const primary = mode === 'dark' ? '#fafafa' : '#18181b'

  return `
    ${HIGHLIGHT_THEMES[mode === 'dark' ? 'dark' : 'light']}
    .web-doc-tabs {
      margin: 1em 0 !important;
    }
    .web-doc-tabs-bar {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 0.35rem !important;
      margin: 0 0 0.5rem !important;
    }
    .web-doc-tabs-tab {
      appearance: none !important;
      border: 1px solid ${border} !important;
      border-radius: 0.375rem !important;
      background: ${toolbar} !important;
      color: ${muted} !important;
      padding: 0.2rem 0.55rem !important;
      font-size: 0.75rem !important;
      font-family: ui-sans-serif, system-ui, sans-serif !important;
      line-height: 1.3 !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      -webkit-user-select: none !important;
      user-select: none !important;
    }
    .web-doc-tabs-tab[aria-selected="true"] {
      background: ${surface} !important;
      color: ${primary} !important;
      border-color: ${primary} !important;
    }
    .web-doc-tabs-panel[hidden] {
      display: none !important;
    }
    .web-doc-tabs .filename {
      display: block !important;
      margin: 0 0 0.35rem !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 0.75rem !important;
      color: ${muted} !important;
    }
    .code-block {
      margin: 1em 0 !important;
      overflow: hidden !important;
      border: 1px solid ${border} !important;
      border-radius: 0.5rem !important;
      background: ${surface} !important;
    }
    .web-doc-tabs .code-block {
      margin: 0 !important;
    }
    .code-block-toolbar {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 0.75rem !important;
      border-bottom: 1px solid ${border} !important;
      background: ${toolbar} !important;
      padding: 0.375rem 0.625rem !important;
    }
    .code-block-labels {
      display: flex !important;
      align-items: center !important;
      gap: 0.5rem !important;
      min-width: 0 !important;
    }
    .code-block-filename {
      overflow: hidden !important;
      color: ${primary} !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 0.75rem !important;
      font-weight: 600 !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    .code-block-lang {
      flex: 0 0 auto !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 0.75rem !important;
      font-weight: 500 !important;
      color: ${muted} !important;
      text-transform: lowercase !important;
    }
    .code-block-copy {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border: 1px solid ${border} !important;
      border-radius: 0.375rem !important;
      background: ${copyBg} !important;
      padding: 0.25rem !important;
      color: ${muted} !important;
      cursor: pointer !important;
    }
    .code-block-copy:hover {
      border-color: ${primary} !important;
      color: ${primary} !important;
    }
    .code-block-copy.copied {
      border-color: ${muted} !important;
      color: ${primary} !important;
    }
    .code-block-body {
      overflow-x: auto !important;
    }
    .code-block pre {
      margin: 0 !important;
      padding: 1rem !important;
      overflow-x: auto !important;
      background: transparent !important;
      border-radius: 0 !important;
      white-space: pre-wrap !important;
      word-break: break-word !important;
    }
    .code-block pre code {
      background: transparent !important;
      padding: 0 !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 0.875em !important;
      color: ${palette.text} !important;
    }
    .code-block .token {
      background: transparent !important;
    }
    /* arXiv / LaTeXML listing 语法高亮与行排版强化 */
    .code-block .ltx_font_typewriter,
    .code-block .ltx_listingline {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    }
    .code-block .ltx_lst_keyword {
      color: ${mode === 'dark' ? '#c084fc' : '#7c3aed'} !important;
      font-weight: 600 !important;
    }
    .code-block .ltx_lst_identifier {
      color: ${mode === 'dark' ? '#38bdf8' : '#0284c7'} !important;
    }
    .code-block .ltx_lst_string {
      color: ${mode === 'dark' ? '#4ade80' : '#16a34a'} !important;
    }
    .code-block .ltx_lst_comment {
      color: ${mode === 'dark' ? '#9ca3af' : '#6b7280'} !important;
      font-style: italic !important;
    }
    .code-block .ltx_lst_number {
      color: ${mode === 'dark' ? '#fb923c' : '#ea580c'} !important;
    }
  `
}
