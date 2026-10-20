// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebDocCompatTableCss, enrichWebDocCompatTables } from './web-doc-compat'

const pageUrl = 'https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition'

function placeholder(query: string): string {
  return `<section class="web-doc-embed-placeholder web-doc-compat-placeholder" data-bcd-query="${query}" role="note"><div class="web-doc-embed-placeholder-title">浏览器兼容性表格</div><small class="web-doc-embed-placeholder-note">该表格由 MDN 在浏览器端动态加载，阅读器未执行站点脚本。</small></section>`
}

function bcdFixture(query: string) {
  return {
    __meta: { timestamp: '2026-10-20T00:00:00.000Z', version: '8.1.6' },
    query,
    data: {
      __compat: {
        description: 'The <code>startViewTransition()</code> method',
        support: {
          chrome: { version_added: '111' },
          firefox: { version_added: false },
          safari: { version_added: '18' },
        },
      },
      options_parameter: {
        __compat: {
          description: '<code>options</code> parameter',
          support: {
            chrome: { version_added: '125' },
            firefox: { version_added: '147' },
            safari: { version_added: '18.2' },
          },
        },
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('enrichWebDocCompatTables', () => {
  it('拉取 BCD 数据并把占位卡替换为兼容性表格', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => bcdFixture('api.Document.startViewTransition'),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const enriched = await enrichWebDocCompatTables(placeholder('api.Document.startViewTransition'), pageUrl)
    const doc = new DOMParser().parseFromString(enriched, 'text/html')
    const section = doc.querySelector('.web-doc-bcd')!
    const table = doc.querySelector('.web-doc-bcd-table')!
    const headers = [...doc.querySelectorAll('.web-doc-bcd-table thead th')].map((el) => el.textContent)
    const rows = [...doc.querySelectorAll('.web-doc-bcd-table tbody tr')]

    expect(fetchMock).toHaveBeenCalledWith(
      'https://bcd.developer.mozilla.org/bcd/api/v0/current/api.Document.startViewTransition.json',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
    expect(doc.querySelector('.web-doc-embed-placeholder')).toBeNull()
    expect(section).not.toBeNull()
    expect(table).not.toBeNull()
    expect(headers).toEqual(['特性', 'Chrome', 'Firefox', 'Safari'])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.querySelector('th')?.textContent).toBe('The startViewTransition() method')
    expect(rows[0]?.querySelector('.web-doc-bcd-cell-supported')?.textContent).toContain('111')
    expect(rows[0]?.querySelector('.web-doc-bcd-cell-unsupported')?.textContent).toBe('×')
    expect(rows[1]?.querySelector('th')?.textContent).toBe('options parameter')
    expect(section.querySelector('.web-doc-bcd-original')?.getAttribute('href')).toBe(
      `${pageUrl}#browser_compatibility`,
    )
    expect(doc.querySelector('.web-doc-bcd-meta')?.textContent).toContain('BCD 8.1.6')
  })

  it('BCD 请求失败时保留占位卡，不影响正文', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    const input = `<p>正文</p>${placeholder('api.Document.failureUnique')}`
    const enriched = await enrichWebDocCompatTables(input, pageUrl)
    const doc = new DOMParser().parseFromString(enriched, 'text/html')

    expect(doc.querySelector('.web-doc-bcd')).toBeNull()
    expect(doc.querySelector('[data-bcd-query="api.Document.failureUnique"]')).not.toBeNull()
    expect(doc.querySelector('p')?.textContent).toBe('正文')
  })

  it('拒绝非法 BCD query，且无占位卡时不发请求', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const invalid = await enrichWebDocCompatTables(placeholder('../../evil'), pageUrl)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(invalid).toContain('data-bcd-query="../../evil"')

    const plain = '<p>no compat table</p>'
    expect(await enrichWebDocCompatTables(plain, pageUrl)).toBe(plain)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('已渲染的表格再次归一化不会重复请求或退回占位卡', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => bcdFixture('api.Document.idempotentUnique'),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const once = await enrichWebDocCompatTables(placeholder('api.Document.idempotentUnique'), pageUrl)
    const twice = await enrichWebDocCompatTables(once, pageUrl)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const doc = new DOMParser().parseFromString(twice, 'text/html')
    expect(doc.querySelectorAll('.web-doc-bcd-table')).toHaveLength(1)
    expect(doc.querySelector('.web-doc-embed-placeholder')).toBeNull()
  })
})

describe('buildWebDocCompatTableCss', () => {
  it('注入主题化表格样式与窄栏滚动', () => {
    const css = buildWebDocCompatTableCss('dark')
    expect(css).toContain('.web-doc-bcd-table')
    expect(css).toContain('position: sticky')
    expect(css).toContain('.web-doc-bcd-cell-supported')
    expect(css).toContain('overflow-x: auto')
  })
})
