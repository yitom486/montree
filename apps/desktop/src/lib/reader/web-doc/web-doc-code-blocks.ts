import type { EpubThemeMode } from '@montree/reader-core'
import { READER_PALETTE } from '@montree/reader-core'
import { buildCodeBlockToolbarHtml } from '@/lib/preview/code-block-chrome'

const LANGUAGE_CLASS = /\blanguage-([\w-]+)\b/i
const LANG_CLASS = /\blang-([\w-]+)\b/i
const SP_LANG_CLASS = /\bsp-(javascript|typescript|jsx|tsx|json|css|html|bash|shell|python|java|go|rust|yaml|markdown|md)\b/i
const HLJS_LANG_CLASS = /\bhljs-([\w-]+)\b/i

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
    if (language) return language.toLowerCase()

    const sp = source.match(SP_LANG_CLASS)?.[1]
    if (sp) return sp.toLowerCase()

    const hljs = source.match(HLJS_LANG_CLASS)?.[1]
    if (hljs) return hljs.toLowerCase()
  }

  const dataLang =
    node.getAttribute('data-language') ??
    node.getAttribute('data-lang') ??
    node.querySelector('code')?.getAttribute('data-language') ??
    node.closest('[data-language]')?.getAttribute('data-language')
  if (dataLang?.trim()) return dataLang.trim().toLowerCase()

  const pre = node.tagName === 'PRE' ? node : node.querySelector('pre')
  const inferred = inferLanguageFromContent(pre?.textContent ?? node.textContent ?? '')
  if (inferred) return inferred

  return 'text'
}

function isLanguageWrapper(div: HTMLElement): boolean {
  if (div.classList.contains('code-block')) return false
  if (LANGUAGE_CLASS.test(div.className) || LANG_CLASS.test(div.className) || div.classList.contains('highlight')) {
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

function wrapCodeBlockHost(host: HTMLElement): void {
  const pre = host.tagName === 'PRE' ? host : host.querySelector('pre')
  if (!pre) return

  const lang = detectCodeLanguage(host)
  const doc = host.ownerDocument
  const wrapper = doc.createElement('div')
  wrapper.className = 'code-block'
  wrapper.innerHTML = buildCodeBlockToolbarHtml(lang)

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
export function buildWebDocTabsRuntimeScript(): string {  return `<script>(function(){
  function activate(tab){
    var root=tab.closest('.web-doc-tabs');
    if(!root)return;
    var index=tab.getAttribute('data-tab-index');
    if(index==null)return;
    root.querySelectorAll('.web-doc-tabs-tab').forEach(function(btn){
      btn.setAttribute('aria-selected', btn.getAttribute('data-tab-index')===index ? 'true' : 'false');
    });
    root.querySelectorAll('.web-doc-tabs-panel').forEach(function(panel){
      if(panel.getAttribute('data-tab-index')===index){
        panel.removeAttribute('hidden');
        panel.style.removeProperty('display');
      }else{
        panel.setAttribute('hidden','');
        panel.style.setProperty('display','none','important');
      }
    });
  }
  document.addEventListener('click',function(event){
    var t=event.target;
    if(!t||!t.closest)return;
    var tab=t.closest('.web-doc-tabs-tab');
    if(!tab)return;
    event.preventDefault();
    activate(tab);
  },true);
})();</script>`
}

/**
 * Tab 运行时内联脚本的 CSP hash（`src/index.html` script-src 放行）。
 * 改脚本正文必须同步更新此值（有单测锁定），否则在线文档代码 Tab 失效。
 */
export const WEB_DOC_TABS_RUNTIME_SCRIPT_SHA256 =
  'sha256-o5eUpYe6xVdLRtL5mmEZtzhPc0HijWnKllVh5rCb/60='

/** 为在线文档正文中的 pre/code 注入与 Markdown 预览一致的复制工具栏 */
export function enhanceWebDocCodeBlocks(html: string): string {
  if (!html.includes('<pre') && !html.includes('tabbed-set')) return html

  const doc = new DOMParser().parseFromString(`<div id="web-doc-code-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('web-doc-code-root')
  if (!root) return html

  normalizeWebDocTabbedSets(root)

  for (const host of collectCodeBlockHosts(root)) {
    wrapCodeBlockHost(host)
  }

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
    .code-block-lang {
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
  `
}
