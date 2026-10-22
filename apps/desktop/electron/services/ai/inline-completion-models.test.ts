import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }))

import { listInlineCompletionModels } from './inline-completion-models'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('inline completion model list', () => {
  it('fetches OpenAI-compatible /models and normalizes ids', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-v4-pro' },
        { id: 'deepseek-flash' },
        { id: 'deepseek-flash' },
        { name: 'local-coder' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listInlineCompletionModels({
      baseUrl: 'https://api.deepseek.com/v1/',
      apiKey: 'sk-test',
    })
    expect(result).toMatchObject({ ok: true, value: ['deepseek-flash', 'deepseek-v4-pro', 'local-coder'] })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/models')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' })
  })

  it('allows local endpoints without a key and reports HTTP errors', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const local = await listInlineCompletionModels({ baseUrl: 'http://localhost:11434/v1', apiKey: '' })
    expect(local).toMatchObject({ ok: true, value: [] })

    const remote = await listInlineCompletionModels({ baseUrl: 'https://api.example.com/v1', apiKey: '' })
    expect(remote.ok).toBe(false)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const denied = await listInlineCompletionModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'bad' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.message).toContain('401')
  })
})
