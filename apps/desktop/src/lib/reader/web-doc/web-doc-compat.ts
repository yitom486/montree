import { decodeHtmlEntities } from '@montree/web-doc'
import type { EpubThemeMode } from '@yitom/reader-core'
import { READER_PALETTE } from '@yitom/reader-core'

const BCD_API_BASE = 'https://bcd.developer.mozilla.org/bcd/api/v0/current/'
const BCD_FETCH_TIMEOUT_MS = 6_000

const BCD_BROWSERS: Array<{ id: string; label: string }> = [
  { id: 'chrome', label: 'Chrome' },
  { id: 'edge', label: 'Edge' },
  { id: 'firefox', label: 'Firefox' },
  { id: 'opera', label: 'Opera' },
  { id: 'safari', label: 'Safari' },
  { id: 'chrome_android', label: 'Chrome Android' },
  { id: 'firefox_android', label: 'Firefox Android' },
  { id: 'opera_android', label: 'Opera Android' },
  { id: 'safari_ios', label: 'Safari iOS' },
  { id: 'samsunginternet_android', label: 'Samsung Internet' },
  { id: 'webview_android', label: 'WebView Android' },
  { id: 'webview_ios', label: 'WebView iOS' },
]

interface BcdSupportStatement {
  version_added?: string | boolean | null
  version_removed?: string | boolean | null
  partial_implementation?: boolean
  notes?: string | string[]
  flags?: Array<{ type?: string; name?: string; value_to_set?: string }>
  prefix?: string
  alternative_name?: string
}

interface BcdCompat {
  description?: string
  support?: Record<string, BcdSupportStatement | BcdSupportStatement[]>
  status?: {
    experimental?: boolean
    deprecated?: boolean
    standard_track?: boolean
  }
}

interface BcdFeatureNode {
  __compat?: BcdCompat
  [key: string]: unknown
}

interface BcdResponse {
  __meta?: { timestamp?: string; version?: string }
  query?: string
  data?: BcdFeatureNode
}

const bcdCache = new Map<string, Promise<BcdResponse | null>>()

function plainText(html: string | undefined): string {
  if (!html) return ''
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function humanizeFeatureKey(key: string, query: string): string {
  if (key === '__compat') return query.split('.').pop() ?? query
  return key.replace(/_/g, ' ').trim()
}

function featureLabel(key: string, compat: BcdCompat, query: string): string {
  return plainText(compat.description) || humanizeFeatureKey(key, query)
}

function supportStatements(value: BcdSupportStatement | BcdSupportStatement[] | undefined): BcdSupportStatement[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function supportCaveat(statement: BcdSupportStatement): string {
  const parts: string[] = []
  if (statement.partial_implementation) parts.push('Partial implementation')
  if (statement.flags?.length) {
    parts.push(`Requires flag: ${statement.flags.map((flag) => flag.name ?? flag.type ?? 'yes').join(', ')}`)
  }
  if (statement.prefix) parts.push(`Prefixed: ${statement.prefix}`)
  if (statement.alternative_name) parts.push(`Alternative name: ${statement.alternative_name}`)
  const notes = Array.isArray(statement.notes) ? statement.notes : statement.notes ? [statement.notes] : []
  parts.push(...notes.map(plainText).filter(Boolean))
  return parts.join(' · ')
}

interface SupportCell {
  state: 'supported' | 'unsupported' | 'unknown' | 'partial'
  version: string
  note: string
}

function resolveSupportCell(
  value: BcdSupportStatement | BcdSupportStatement[] | undefined,
): SupportCell {
  const statements = supportStatements(value)
  if (statements.length === 0) return { state: 'unknown', version: '', note: '' }

  const statement = statements.find((item) => item.version_added !== false) ?? statements[0]!
  const note = supportCaveat(statement)
  if (statement.version_added === false) {
    return { state: 'unsupported', version: '', note }
  }
  if (statement.version_added === null || statement.version_added === undefined) {
    return { state: 'unknown', version: '', note }
  }
  return {
    state: statement.partial_implementation || note ? 'partial' : 'supported',
    version: typeof statement.version_added === 'string' ? statement.version_added : '',
    note,
  }
}

function fetchBcd(query: string): Promise<BcdResponse | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(query)) return Promise.resolve(null)
  const cached = bcdCache.get(query)
  if (cached) return cached

  const request = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BCD_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(`${BCD_API_BASE}${encodeURIComponent(query)}.json`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) return null
      const data = (await response.json()) as BcdResponse
      return data?.data && typeof data.data === 'object' ? data : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  })()

  bcdCache.set(query, request)
  void request.then((data) => {
    if (!data) bcdCache.delete(query)
  })
  return request
}

function createBcdSection(
  doc: Document,
  query: string,
  response: BcdResponse,
  pageUrl: string,
): HTMLElement | null {
  const data = response.data
  if (!data) return null

  const rows: Array<{ key: string; compat: BcdCompat }> = []
  if (data.__compat) rows.push({ key: '__compat', compat: data.__compat })
  for (const [key, value] of Object.entries(data)) {
    if (key === '__compat' || !value || typeof value !== 'object') continue
    const compat = (value as BcdFeatureNode).__compat
    if (compat) rows.push({ key, compat })
  }
  if (rows.length === 0) return null

  const browsers = BCD_BROWSERS.filter((browser) =>
    rows.some((row) => Boolean(row.compat.support?.[browser.id])),
  )
  const columns = browsers.length > 0 ? browsers : BCD_BROWSERS.slice(0, 5)

  const section = doc.createElement('section')
  section.className = 'web-doc-bcd'
  section.setAttribute('data-bcd-query', query)

  const header = doc.createElement('div')
  header.className = 'web-doc-bcd-header'

  const title = doc.createElement('small')
  title.className = 'web-doc-bcd-title'
  title.textContent = '浏览器兼容性'
  header.appendChild(title)

  try {
    const originalUrl = new URL(pageUrl)
    originalUrl.hash = 'browser_compatibility'
    const originalLink = doc.createElement('a')
    originalLink.className = 'web-doc-bcd-original'
    originalLink.href = originalUrl.toString()
    originalLink.target = '_blank'
    originalLink.rel = 'noopener noreferrer'
    originalLink.textContent = '在原文中查看'
    header.appendChild(originalLink)
  } catch {
    // 非法 base URL 时只保留表格
  }
  section.appendChild(header)

  const scroll = doc.createElement('div')
  scroll.className = 'web-doc-table-scroll web-doc-bcd-scroll'
  scroll.setAttribute('role', 'region')
  scroll.setAttribute('aria-label', '浏览器兼容性表格')
  scroll.setAttribute('tabindex', '0')

  const table = doc.createElement('table')
  table.className = 'web-doc-bcd-table'

  const thead = doc.createElement('thead')
  const headRow = doc.createElement('tr')
  const featureHead = doc.createElement('th')
  featureHead.scope = 'col'
  featureHead.textContent = '特性'
  headRow.appendChild(featureHead)
  for (const browser of columns) {
    const th = doc.createElement('th')
    th.scope = 'col'
    th.textContent = browser.label
    headRow.appendChild(th)
  }
  thead.appendChild(headRow)
  table.appendChild(thead)

  const tbody = doc.createElement('tbody')
  for (const row of rows) {
    const tr = doc.createElement('tr')
    const feature = doc.createElement('th')
    feature.scope = 'row'
    feature.className = 'web-doc-bcd-feature'
    feature.textContent = featureLabel(row.key, row.compat, query)
    tr.appendChild(feature)

    for (const browser of columns) {
      const cell = resolveSupportCell(row.compat.support?.[browser.id])
      const td = doc.createElement('td')
      td.className = `web-doc-bcd-cell web-doc-bcd-cell-${cell.state}`
      if (cell.note) td.title = cell.note
      td.appendChild(doc.createTextNode(cell.state === 'unsupported' ? '×' : cell.state === 'unknown' ? '?' : '✓'))
      if (cell.version) {
        const version = doc.createElement('small')
        version.className = 'web-doc-bcd-version'
        version.textContent = cell.version
        td.appendChild(version)
      }
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  scroll.appendChild(table)
  section.appendChild(scroll)

  const meta = doc.createElement('small')
  meta.className = 'web-doc-bcd-meta'
  const version = response.__meta?.version ? ` · BCD ${response.__meta.version}` : ''
  meta.textContent = `数据来源：MDN Browser Compat Data${version}`
  section.appendChild(meta)

  return section
}

/**
 * MDN Browser compatibility 表格是客户端从 BCD 动态拉取的。
 * 阅读器在正文抽取后异步补表：成功则替换占位卡，失败则保留占位卡，
 * 不阻塞正文显示，也不执行站点脚本。
 */
export async function enrichWebDocCompatTables(html: string, pageUrl: string): Promise<string> {
  if (!html.includes('data-bcd-query')) return html

  const doc = new DOMParser().parseFromString(`<div id="web-doc-compat-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('web-doc-compat-root')
  if (!root) return html

  const placeholders = [...root.querySelectorAll<HTMLElement>('[data-bcd-query]')].filter(
    (element) => !element.classList.contains('web-doc-bcd') && !element.querySelector('.web-doc-bcd-table'),
  )
  if (placeholders.length === 0) return html

  await Promise.all(
    placeholders.map(async (placeholder) => {
      const query = placeholder.getAttribute('data-bcd-query')?.trim() ?? ''
      if (!query) return
      const response = await fetchBcd(query)
      if (!response) return
      const section = createBcdSection(doc, query, response, pageUrl)
      if (section) placeholder.replaceWith(section)
    }),
  )

  return root.innerHTML
}

/** BCD 表格样式：与阅读器主题一致，首列吸附，窄栏横向滚动。 */
export function buildWebDocCompatTableCss(theme: EpubThemeMode): string {
  const isDark = theme === 'dark'
  const isSepia = theme === 'sepia'
  const palette = READER_PALETTE[theme]
  const muted = isDark ? '#a1a1aa' : isSepia ? '#6b5d4c' : '#71717a'
  const border = isDark ? 'rgba(255, 255, 255, 0.1)' : isSepia ? 'rgba(120, 100, 70, 0.16)' : 'rgba(24, 24, 27, 0.1)'
  const surface = isDark ? 'rgba(255, 255, 255, 0.03)' : isSepia ? 'rgba(255, 255, 255, 0.32)' : '#f8fafc'
  const headerBg = isDark ? 'rgba(255, 255, 255, 0.06)' : isSepia ? 'rgba(120, 100, 70, 0.08)' : '#f1f5f9'
  const supported = isDark ? '#4ade80' : isSepia ? '#15803d' : '#16a34a'
  const unsupported = isDark ? '#f87171' : isSepia ? '#b91c1c' : '#dc2626'
  const partial = isDark ? '#fbbf24' : isSepia ? '#b45309' : '#d97706'

  return `
    body .web-doc-bcd {
      margin: 1rem 0 1.5rem !important;
      overflow: hidden !important;
      border: 1px solid ${border} !important;
      border-radius: 0.75rem !important;
      background: ${surface} !important;
      color: ${palette.text} !important;
      font-size: 0.9rem !important;
      line-height: 1.55 !important;
    }
    body .web-doc-bcd-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 0.75rem !important;
      padding: 0.7rem 1rem !important;
      border-bottom: 1px solid ${border} !important;
    }
    body .web-doc-bcd-title {
      color: ${palette.text} !important;
      font-size: 0.92rem !important;
      font-weight: 600 !important;
      line-height: 1.4 !important;
    }
    body .web-doc-bcd-original {
      flex: 0 0 auto !important;
      color: ${palette.link} !important;
      font-size: 0.74rem !important;
      text-decoration: none !important;
      border-bottom: 1px solid transparent !important;
    }
    body .web-doc-bcd-original:hover {
      color: ${palette.linkHover} !important;
      border-bottom-color: currentColor !important;
    }
    body .web-doc-bcd-scroll {
      overflow-x: auto !important;
    }
    body .web-doc-bcd-table {
      width: 100% !important;
      min-width: 720px !important;
      border-collapse: collapse !important;
      font-size: 0.82rem !important;
      line-height: 1.45 !important;
    }
    body .web-doc-bcd-table th,
    body .web-doc-bcd-table td {
      padding: 0.5rem 0.65rem !important;
      border-bottom: 1px solid ${border} !important;
      font-size: 0.82rem !important;
      line-height: 1.45 !important;
      text-align: center !important;
      white-space: nowrap !important;
    }
    body .web-doc-bcd-table th {
      color: ${palette.text} !important;
    }
    body .web-doc-bcd-table thead th {
      background: ${headerBg} !important;
      color: ${muted} !important;
      font-size: 0.7rem !important;
      font-weight: 600 !important;
      letter-spacing: 0.01em !important;
    }
    body .web-doc-bcd-table thead th:first-child,
    body .web-doc-bcd-table tbody th {
      position: sticky !important;
      left: 0 !important;
      z-index: 1 !important;
      text-align: left !important;
    }
    body .web-doc-bcd-table thead th:first-child {
      background: ${headerBg} !important;
      z-index: 2 !important;
    }
    body .web-doc-bcd-table tbody th {
      background: ${surface} !important;
    }
    body .web-doc-bcd-feature {
      color: ${palette.text} !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 0.76rem !important;
      font-weight: 500 !important;
    }
    body .web-doc-bcd-table tbody tr:last-child th,
    body .web-doc-bcd-table tbody tr:last-child td {
      border-bottom: 0 !important;
    }
    body .web-doc-bcd-table td.web-doc-bcd-cell-supported {
      color: ${supported} !important;
    }
    body .web-doc-bcd-table td.web-doc-bcd-cell-unsupported {
      color: ${unsupported} !important;
    }
    body .web-doc-bcd-table td.web-doc-bcd-cell-partial {
      color: ${partial} !important;
    }
    body .web-doc-bcd-table td.web-doc-bcd-cell-unknown {
      color: ${muted} !important;
    }
    body .web-doc-bcd-version {
      display: block !important;
      margin-top: 0.05rem !important;
      color: ${muted} !important;
      font-size: 0.68rem !important;
      line-height: 1.2 !important;
    }
    body .web-doc-bcd-meta {
      display: block !important;
      padding: 0.45rem 1rem 0.6rem !important;
      border-top: 1px solid ${border} !important;
      color: ${muted} !important;
      font-size: 0.68rem !important;
      line-height: 1.4 !important;
    }
  `
}
