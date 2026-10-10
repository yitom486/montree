/**
 * 在线文档正文 HTML 转换为标准 GitHub 风格 Markdown 导出模块
 */

export interface WebDocMarkdownExportOptions {
  title: string
  baseUrl: string
  bodyHtml: string
}

export function sanitizeExportFileName(name: string): string {
  const sanitized = name.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim()
  return sanitized || 'document'
}

type CalloutAlertTag = 'NOTE' | 'TIP' | 'WARNING' | 'CAUTION' | 'IMPORTANT'

function resolveCalloutAlertTag(el: HTMLElement): CalloutAlertTag {
  const rawType = (
    el.getAttribute('data-callout-type') ||
    el.getAttribute('data-callout') ||
    ''
  ).toLowerCase().trim()

  if (/warn|caution/.test(rawType)) return 'WARNING'
  if (/danger|error|critical/.test(rawType)) return 'CAUTION'
  if (/tip|success|check/.test(rawType)) return 'TIP'
  if (/important/.test(rawType)) return 'IMPORTANT'
  if (/note/.test(rawType)) return 'NOTE'

  const className = String(el.className ?? '').toLowerCase()
  if (/warning|caution/.test(className)) return 'WARNING'
  if (/danger|error/.test(className)) return 'CAUTION'
  if (/tip|success/.test(className)) return 'TIP'
  if (/important/.test(className)) return 'IMPORTANT'
  return 'NOTE'
}

function resolveAbsoluteUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

function serializeNode(node: Node, baseUrl: string, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const el = node as HTMLElement
  const tagName = el.tagName.toUpperCase()

  // 1. 过滤非正文或站点纯图标噪点
  if (
    tagName === 'SCRIPT' ||
    tagName === 'STYLE' ||
    tagName === 'BUTTON' ||
    tagName === 'NOSCRIPT' ||
    tagName === 'TEMPLATE' ||
    el.classList.contains('web-doc-heading-anchor-wrap') ||
    el.classList.contains('web-doc-field-anchor-wrap') ||
    el.classList.contains('web-doc-card-arrow') ||
    el.classList.contains('web-doc-callout-icon')
  ) {
    return ''
  }

  // 2. KaTeX 公式提取（优先从 <annotation> 获取原始 LaTeX 源码）
  if (el.classList.contains('katex') || el.classList.contains('arithmatex')) {
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
    const tex = annotation?.textContent?.trim()
    if (tex) {
      const isDisplay =
        el.classList.contains('katex-display') ||
        el.classList.contains('display') ||
        el.classList.contains('arithmatex-display')
      return isDisplay ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`
    }
  }

  // 3. 标题
  if (/^H[1-6]$/.test(tagName)) {
    const level = Number(tagName.charAt(1))
    const text = serializeChildren(el, baseUrl, depth).trim()
    if (!text) return ''
    return `\n\n${'#'.repeat(level)} ${text}\n\n`
  }

  // 4. 段落
  if (tagName === 'P') {
    const text = serializeChildren(el, baseUrl, depth).trim()
    if (!text) return ''
    return `\n\n${text}\n\n`
  }

  // 5. Callout 提示卡片（转换为 GitHub / Montree 原生 Alert 语法）
  if (
    el.classList.contains('web-doc-callout') ||
    el.getAttribute('data-callout-type') ||
    el.getAttribute('data-callout') ||
    el.classList.contains('callout')
  ) {
    const alertTag = resolveCalloutAlertTag(el)
    const contentEl = el.querySelector('.web-doc-callout-content') ?? el
    const innerMarkdown = serializeChildren(contentEl, baseUrl, depth).trim()
    const lines = innerMarkdown.split('\n')
    const quoted = lines.map((line) => (line.trim() ? `> ${line}` : '>')).join('\n')
    return `\n\n> [!${alertTag}]\n${quoted}\n\n`
  }

  // 6. 代码块
  if (tagName === 'PRE' || el.classList.contains('code-block')) {
    const codeEl = el.querySelector('code') ?? el
    const codeClass = `${el.className} ${codeEl.className}`
    const langMatch = codeClass.match(/language-([a-zA-Z0-9_-]+)/)
    const lang =
      langMatch?.[1] ||
      el.getAttribute('data-lang') ||
      el.getAttribute('data-language') ||
      ''
    const codeContent = codeEl.textContent ?? el.textContent ?? ''
    return `\n\n\`\`\`${lang}\n${codeContent.replace(/\r\n/g, '\n').trimEnd()}\n\`\`\`\n\n`
  }

  // 7. 行内代码
  if (tagName === 'CODE') {
    const codeText = el.textContent ?? ''
    return `\`${codeText.replace(/`/g, '\\`')}\``
  }

  // 8. 文本加粗 / 斜体 / 删除线
  if (tagName === 'STRONG' || tagName === 'B') {
    const text = serializeChildren(el, baseUrl, depth).trim()
    return text ? `**${text}**` : ''
  }
  if (tagName === 'EM' || tagName === 'I') {
    const text = serializeChildren(el, baseUrl, depth).trim()
    return text ? `*${text}*` : ''
  }
  if (tagName === 'DEL' || tagName === 'S' || tagName === 'STRIKE') {
    const text = serializeChildren(el, baseUrl, depth).trim()
    return text ? `~~${text}~~` : ''
  }

  // 9. 超链接
  if (tagName === 'A') {
    const href = el.getAttribute('href')?.trim()
    const text = serializeChildren(el, baseUrl, depth).trim()
    if (!href || href.startsWith('javascript:')) return text
    if (!text && !el.querySelector('img')) return ''
    const fullHref = href.startsWith('#') ? href : resolveAbsoluteUrl(href, baseUrl)
    return `[${text || fullHref}](${fullHref})`
  }

  // 10. 图片
  if (tagName === 'IMG') {
    const src = el.getAttribute('src')?.trim()
    if (!src) return ''
    const alt = el.getAttribute('alt') || el.getAttribute('title') || ''
    const fullSrc = resolveAbsoluteUrl(src, baseUrl)
    return `![${alt}](${fullSrc})`
  }

  // 11. 引用块
  if (tagName === 'BLOCKQUOTE') {
    const inner = serializeChildren(el, baseUrl, depth).trim()
    const quoted = inner
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n')
    return `\n\n${quoted}\n\n`
  }

  // 12. 无序列表与有序列表
  if (tagName === 'UL' || tagName === 'OL') {
    const isOrdered = tagName === 'OL'
    const items = Array.from(el.children).filter((c) => c.tagName.toUpperCase() === 'LI')
    const lines: string[] = []

    items.forEach((item, index) => {
      const checkbox = item.querySelector('input[type="checkbox"]')
      const prefix = isOrdered ? `${index + 1}. ` : '- '
      const checkMark = checkbox
        ? checkbox.hasAttribute('checked') || (checkbox as HTMLInputElement).checked
          ? '[x] '
          : '[ ] '
        : ''

      // 提取 LI 内部文本
      const itemContent = serializeChildren(item, baseUrl, depth + 1).trim()
      const indent = '  '.repeat(depth)
      lines.push(`${indent}${prefix}${checkMark}${itemContent}`)
    })

    return `\n\n${lines.join('\n')}\n\n`
  }

  // 13. 表格
  if (tagName === 'TABLE') {
    return serializeTable(el as HTMLTableElement, baseUrl, depth)
  }

  // 14. 水平分割线
  if (tagName === 'HR') {
    return '\n\n---\n\n'
  }

  // 15. 换行
  if (tagName === 'BR') {
    return '\n'
  }

  // 默认：递归子节点
  return serializeChildren(el, baseUrl, depth)
}

function serializeChildren(el: Element, baseUrl: string, depth: number): string {
  let result = ''
  for (const child of Array.from(el.childNodes)) {
    result += serializeNode(child, baseUrl, depth)
  }
  return result
}

function serializeTable(table: HTMLTableElement, baseUrl: string, depth: number): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return ''

  const tableData: string[][] = []
  let maxCols = 0

  rows.forEach((row) => {
    const cells = Array.from(row.querySelectorAll('th, td'))
    if (cells.length > maxCols) maxCols = cells.length
    const rowValues = cells.map((cell) =>
      serializeChildren(cell, baseUrl, depth).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim(),
    )
    tableData.push(rowValues)
  })

  if (tableData.length === 0 || maxCols === 0) return ''

  // 补齐列数
  const normalizedRows = tableData.map((row) => {
    const padded = [...row]
    while (padded.length < maxCols) padded.push('')
    return padded
  })

  const header = normalizedRows[0]!
  const headerLine = `| ${header.join(' | ')} |`
  const separatorLine = `| ${header.map(() => '---').join(' | ')} |`
  const bodyLines = normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`)

  return `\n\n${[headerLine, separatorLine, ...bodyLines].join('\n')}\n\n`
}

/**
 * 将整篇在线文档导出为带 Frontmatter 的标准 Markdown 文档
 */
export function buildWebDocMarkdown(options: WebDocMarkdownExportOptions): string {
  const { title, baseUrl, bodyHtml } = options
  const doc = new DOMParser().parseFromString(`<div id="root">${bodyHtml}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return `# ${title}\n`

  const bodyMarkdown = serializeChildren(root, baseUrl, 0)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const safeTitle = title.replace(/"/g, '\\"')
  const today = new Date().toISOString().slice(0, 10)

  const frontmatter = [
    '---',
    `title: "${safeTitle}"`,
    `source: "${baseUrl}"`,
    `date: "${today}"`,
    '---',
  ].join('\n')

  // 若正文开头尚未包含与 title 匹配的 H1，则补充 H1
  const hasH1 = /^#\s+/m.test(bodyMarkdown)
  const contentBody = hasH1 ? bodyMarkdown : `# ${title}\n\n${bodyMarkdown}`

  return `${frontmatter}\n\n${contentBody}\n`
}
