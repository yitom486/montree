import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@yitom/contracts'
import {
  discoverWebDocToc,
  fetchWebDocPage,
  parseWebDocUrlInput,
  validateWebDocUrl,
} from './web-doc-service'

describe('web-doc-service', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.includes('fail.example')) {
          return new Response('nope', { status: 500, headers: { 'content-type': 'text/html' } })
        }
        const html = `<!DOCTYPE html><html><head><title>Docs</title></head><body>
          <article><h1>Page</h1><p>text</p></article>
          <a href="/learn/installation">Install</a>
          <a href="https://other.example/x">External</a>
        </body></html>`
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('拒绝非 http(s) URL', () => {
    const result = validateWebDocUrl('file:///etc/passwd')
    expect(result.ok).toBe(false)
  })

  it('规范化 URL 并去掉 hash', () => {
    const result = validateWebDocUrl('https://react.dev/learn#setup')
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value).toBe('https://react.dev/learn')
  })

  it('fetch 返回 HTML', async () => {
    const result = await fetchWebDocPage({ url: 'https://react.dev/learn' })
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.html).toContain('<article>')
  })

  it('HTTP 错误返回 FILE_READ_ERROR', async () => {
    const result = await fetchWebDocPage({ url: 'https://fail.example/docs' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('FILE_READ_ERROR')
  })

  it('discoverToc 仅保留同站链接', async () => {
    const result = await discoverWebDocToc({ url: 'https://react.dev/learn' })
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.siteId).toBe('generic-ssr')
    expect(result.value.entries.some((e) => e.href.includes('/learn/installation'))).toBe(true)
    expect(result.value.entries.every((e) => e.href.startsWith('https://react.dev'))).toBe(true)
  })

  it('parseWebDocUrlInput 校验空字符串', () => {
    expect(parseWebDocUrlInput('  ').ok).toBe(false)
  })

  it('文档入口可打开本机，外部链接入口默认保持拦截', async () => {
    expect(parseWebDocUrlInput('http://localhost:3000/').ok).toBe(false)
    expect(parseWebDocUrlInput('http://localhost:3000/', true).ok).toBe(true)
    expect((await fetchWebDocPage({ url: 'http://localhost:3000/' })).ok).toBe(true)
  })

  it('本机允许同源重定向，禁止换端口和公网重定向到本机', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/start')
      ? new Response('', { status: 302, headers: { location: '/chapter' } })
      : new Response('<article>Local</article>', { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    expect((await fetchWebDocPage({ url: 'http://localhost:3000/start' })).ok).toBe(true)
    expect(fetch).toHaveBeenLastCalledWith('http://localhost:3000/chapter', expect.anything())
    for (const entry of ['http://localhost:3000/', 'https://public.example/']) {
      fetch.mockClear()
      fetch.mockImplementation(async () => new Response('', { status: 302, headers: { location: 'http://localhost:4000/private' } }))
      expect((await fetchWebDocPage({ url: entry })).ok).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })

  it('公网目录索引不能借 llms.txt 获取本机访问权限', async () => {
    const fetch = vi.fn(async (_url: string) => new Response('<link rel="alternate" type="text/markdown" href="http://localhost:3000/llms.txt"><article>Docs</article>', { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    await discoverWebDocToc({ url: 'https://docs.example/' })
    expect(fetch.mock.calls.every(([url]) => !String(url).includes('localhost'))).toBe(true)
  })

  it('同时存在局部侧栏与站点 llms.txt 时支持双轨且优先局部侧栏', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const u = String(input)
        if (u === 'https://dual.example/docs') {
          const html = `<!DOCTYPE html><html><head>
            <link rel="alternate" type="text/markdown" href="/llms.txt">
          </head><body>
            <nav class="sidebar">
              <a href="/docs/intro">Intro</a>
              <a href="/docs/guide">Guide</a>
            </nav>
            <article><h1>Doc</h1></article>
          </body></html>`
          return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
        }
        if (u === 'https://dual.example/llms.txt') {
          const txt = `# Site\n- [All Docs](https://dual.example/all)\n- [Full 1](https://dual.example/1)\n- [Full 2](https://dual.example/2)\n- [Full 3](https://dual.example/3)`
          return new Response(txt, { status: 200, headers: { 'content-type': 'text/plain' } })
        }
        return new Response('', { status: 404 })
      }),
    )

    const result = await discoverWebDocToc({ url: 'https://dual.example/docs' })
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    // 优先局部侧栏
    expect(result.value.entries.length).toBe(2)
    expect(result.value.entries[0]?.label).toBe('Intro')
    // 附带双轨数据
    expect(result.value.sectionEntries?.length).toBe(2)
    expect(result.value.siteEntries?.length).toBe(4)
  })

  it('当独立子页面自身无侧栏时回退到根路径发现通用目录', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const u = String(input)
        if (u === 'https://react.dev/docs/isolated-page') {
          // 独立页面，只有正文，没有 nav 或侧栏
          return new Response(
            `<!DOCTYPE html><html><body><article><h1>Isolated</h1><p>content</p></article></body></html>`,
            { status: 200, headers: { 'content-type': 'text/html' } },
          )
        }
        if (u === 'https://react.dev/docs/') {
          // 站点根目录，有完整的 nav 侧栏
          return new Response(
            `<!DOCTYPE html><html><body>
              <nav class="sidebar">
                <a href="/docs/intro">Intro</a>
                <a href="/docs/installation">Install</a>
              </nav>
            </body></html>`,
            { status: 200, headers: { 'content-type': 'text/html' } },
          )
        }
        return new Response('', { status: 404 })
      }),
    )

    const result = await discoverWebDocToc({ url: 'https://react.dev/docs/isolated-page' })
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.entries.length).toBe(2)
    expect(result.value.entries[0]?.label).toBe('Intro')
  })

  describe('重定向链 SSRF 防护', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => {
          const u = String(input)
          if (u === 'https://start.example/go') {
            return new Response('', { status: 302, headers: { location: 'https://final.example/page' } })
          }
          if (u === 'https://final.example/page') {
            return new Response('<article><h1>Final</h1></article>', {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' },
            })
          }
          if (u === 'https://start.example/evil') {
            return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
          }
          if (u === 'https://loop.example/') {
            return new Response('', { status: 302, headers: { location: 'https://loop.example/' } })
          }
          return new Response('not found', { status: 404 })
        }),
      )
    })

    it('跟随站外 302 并返回终点 HTML', async () => {
      const result = await fetchWebDocPage({ url: 'https://start.example/go' })
      expect(isOk(result)).toBe(true)
      if (!isOk(result)) return
      expect(result.value.html).toContain('Final')
    })

    it('302 跳内网地址被拦截', async () => {
      const result = await fetchWebDocPage({ url: 'https://start.example/evil' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.message).toContain('内网')
    })

    it('重定向循环超过上限后失败', async () => {
      const result = await fetchWebDocPage({ url: 'https://loop.example/' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.message).toContain('重定向')
    })
  })
})


describe('mdBook static TOC discovery', () => {
  afterEach(() => vi.unstubAllGlobals())
  const page = '<!-- Book generated using mdBook --><nav id="mdbook-sidebar"><mdbook-sidebar-scrollbox></mdbook-sidebar-scrollbox><noscript><iframe src="../toc.html"></iframe></noscript></nav><main><a href="../mut.html">mut</a></main>'
  const toc = '<ol class="chapter"><li class="chapter-item"><a href="primitives.html">Primitives</a><ol class="section"><li class="chapter-item"><a href="primitives/literals.html">Literals</a></li></ol></li></ol>'
  it('fetches toc.html before considering body links, with nested links based on the index directory', async () => {
    const fetch = vi.fn(async (url: string) => new Response(url.endsWith('toc.html') ? toc : page, { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await discoverWebDocToc({ url: 'https://book.example/rust/primitives/literals.html' })
    expect(result.ok && result.value.entries).toEqual([
      { label: 'Primitives', level: 0, href: 'https://book.example/rust/primitives.html' },
      { label: 'Literals', level: 1, href: 'https://book.example/rust/primitives/literals.html' },
    ])
    expect(fetch.mock.calls.map(c => c[0])).toEqual(['https://book.example/rust/primitives/literals.html', 'https://book.example/rust/toc.html'])
  })
  it('surfaces failed index loading instead of presenting See also as chapter navigation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('toc.html') ? 'not found' : page, { status: url.endsWith('toc.html') ? 404 : 200, headers: { 'content-type': 'text/html' } })))
    const result = await discoverWebDocToc({ url: 'https://book.example/rust/primitives/literals.html' })
    expect(result.ok).toBe(false)
  })
  it('uses older inline chapter trees without making a second request', async () => {
    const fetch = vi.fn(async () => new Response(toc, { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await discoverWebDocToc({ url: 'https://book.example/rust/primitives.html' })
    expect(result.ok && result.value.entries.length).toBe(2)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('keeps redirect URL protection on index requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('toc.html') ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/toc.html' } }) : new Response(page, { headers: { 'content-type': 'text/html' } })))
    const result = await discoverWebDocToc({ url: 'https://book.example/rust/primitives/literals.html' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('内网')
  })
})
