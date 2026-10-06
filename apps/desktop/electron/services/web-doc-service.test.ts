import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@montree/contracts'
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
