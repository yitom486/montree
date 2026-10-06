import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebDavStorageAdapter } from './webdav-adapter'

describe('WebDavStorageAdapter', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('正确编码 Basic Auth 凭据与拼接基准地址', async () => {
    let capturedUrl = ''
    let capturedAuth = ''

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      const headers = new Headers(init?.headers)
      capturedAuth = headers.get('Authorization') ?? ''
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.jianguoyun.com/dav',
      username: 'user@test.com',
      password: 'secret_app_password',
    })

    const res = await adapter.testConnection()
    expect(res.ok).toBe(true)
    expect(capturedUrl).toBe('https://dav.jianguoyun.com/dav/')
    const expectedAuth = `Basic ${Buffer.from('user@test.com:secret_app_password').toString('base64')}`
    expect(capturedAuth).toBe(expectedAuth)
  })

  it('返回 401 时转为清晰的 UNAUTHORIZED 错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('', { status: 401, statusText: 'Unauthorized' })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.jianguoyun.com/dav/',
      username: 'user@test.com',
      password: 'wrong_password',
    })

    const res = await adapter.testConnection()
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('UNAUTHORIZED')
    }
  })

  it('ensureDir 遇到 404 时自动发送 MKCOL 创建目录', async () => {
    const calls: Array<{ method: string; url: string }> = []

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      calls.push({ method, url: u })

      if (method === 'PROPFIND') {
        // 目录不存在
        return new Response('', { status: 404 })
      }
      if (method === 'MKCOL') {
        return new Response('', { status: 201 })
      }
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.example.com/dav/',
      username: 'user',
      password: 'pwd',
    })

    const res = await adapter.ensureDir('/MontreeSync/sub')
    expect(res.ok).toBe(true)

    // 应包含对 MontreeSync/ 的 PROPFIND 和 MKCOL，以及 sub/ 的 PROPFIND 和 MKCOL
    const mkcolCalls = calls.filter((c) => c.method === 'MKCOL')
    expect(mkcolCalls).toHaveLength(2)
  })

  it('downloadFile 在 200 时返回文本，404 时返回 FILE_NOT_FOUND', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('found.json')) {
        return new Response('{"hello":"world"}', { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.example.com/dav/',
      username: 'user',
      password: 'pwd',
    })

    const okRes = await adapter.downloadFile('/MontreeSync/found.json')
    expect(okRes.ok).toBe(true)
    if (okRes.ok) {
      expect(okRes.value).toBe('{"hello":"world"}')
    }

    const notFoundRes = await adapter.downloadFile('/MontreeSync/missing.json')
    expect(notFoundRes.ok).toBe(false)
    if (!notFoundRes.ok) {
      expect(notFoundRes.error.code).toBe('FILE_NOT_FOUND')
    }
  })

  it('uploadFile 正确发送 PUT 请求', async () => {
    let capturedBody = ''
    let capturedMethod = ''

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedMethod = init?.method ?? ''
      capturedBody = String(init?.body ?? '')
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.example.com/dav/',
      username: 'user',
      password: 'pwd',
    })

    const res = await adapter.uploadFile('/MontreeSync/data.json', '{"test":123}')
    expect(res.ok).toBe(true)
    expect(capturedMethod).toBe('PUT')
    expect(capturedBody).toBe('{"test":123}')
  })

  it('statFile 正确解析 207 Multi-Status 中的 getlastmodified 时间戳', async () => {    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/MontreeSync/data.json</d:href>
    <d:propstat>
      <d:prop>
        <d:getlastmodified>Wed, 03 Sep 2026 12:00:00 GMT</d:getlastmodified>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

    globalThis.fetch = vi.fn(async () => {
      return new Response(xml, { status: 207 })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.example.com/dav/',
      username: 'user',
      password: 'pwd',
    })

    const res = await adapter.statFile('/MontreeSync/data.json')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.exists).toBe(true)
      expect(res.value.mtime).toBe(Date.parse('Wed, 03 Sep 2026 12:00:00 GMT'))
    }
  })

  it('遇到 500 会重试，恢复后成功', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) {
        return new Response('', { status: 500 })
      }
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.example.com/dav/',
      username: 'user',
      password: 'pwd',
      retryBaseDelayMs: 1,
    })

    const res = await adapter.testConnection()
    expect(res.ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('401 不重试，直接返回 UNAUTHORIZED', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return new Response('', { status: 401, statusText: 'Unauthorized' })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.example.com/dav/',
      username: 'user',
      password: 'pwd',
      retryBaseDelayMs: 1,
    })

    const res = await adapter.testConnection()
    expect(res.ok).toBe(false)
    expect(calls).toBe(1)
  })

  it('网络异常耗尽重试后返回错误（1 + 2 次调用）', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.example.com/dav/',
      username: 'user',
      password: 'pwd',
      retryBaseDelayMs: 1,
    })

    const res = await adapter.downloadFile('/MontreeSync/data.json')
    expect(res.ok).toBe(false)
    expect(calls).toBe(3)
  })

  it('黑洞网络触发单次超时并包装中文错误', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls++
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    const adapter = new WebDavStorageAdapter({
      serverUrl: 'https://dav.example.com/dav/',
      username: 'user',
      password: 'pwd',
      timeoutMs: 50,
      maxRetries: 1,
      retryBaseDelayMs: 1,
    })

    const res = await adapter.testConnection()
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.message).toContain('超时')
    }
    expect(calls).toBe(2)
  })
})
