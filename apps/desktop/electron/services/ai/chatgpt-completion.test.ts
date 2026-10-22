import { afterEach, describe, expect, it, vi } from 'vitest'
import { callChatGptCompletion } from './chatgpt-completion'

const credential = {
  access: 'access-token',
  refresh: 'refresh-token',
  expires: Date.now() + 60_000,
  accountId: 'acct_1',
}

const input = {
  credential,
  model: 'gpt-6-luna',
  system: 'You complete Markdown.',
  prompt: 'The quick brown<CURSOR>',
  signal: new AbortController().signal,
}

function sse(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChatGPT completion', () => {
  it('posts a streaming Codex request and reads the completed message', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(sse(
      { type: 'response.output_text.delta', delta: 'Hel' },
      { type: 'response.output_text.delta', delta: 'lo' },
      {
        type: 'response.output_item.done',
        item: { type: 'message', content: [{ type: 'output_text', text: 'Hello' }] },
      },
      { type: 'response.completed', response: { output: [] } },
    ), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(callChatGptCompletion(input)).resolves.toBe('Hello')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      'chatgpt-account-id': 'acct_1',
    })
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      store: false,
      stream: true,
      instructions: 'You complete Markdown.',
      reasoning: { effort: 'none' },
    })
  })

  it('falls back to accumulated deltas when no completed item arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(
      { type: 'response.output_text.delta', delta: ' fallback' },
    ), { status: 200, headers: { 'content-type': 'text/event-stream' } })))

    await expect(callChatGptCompletion(input)).resolves.toBe(' fallback')
  })

  it('throws on HTTP errors and failed response events', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })))
    await expect(callChatGptCompletion(input)).rejects.toThrow('400')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(
      { type: 'response.failed', response: { error: { message: 'nope' } } },
    ), { status: 200, headers: { 'content-type': 'text/event-stream' } })))
    await expect(callChatGptCompletion(input)).rejects.toThrow('nope')
  })
})
