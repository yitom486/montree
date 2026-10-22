import type { ChatGptCredential } from './chatgpt-auth'
import { usableChatGptModel } from './chatgpt-auth'

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const ORIGINATOR = 'montree'

interface ChatGptCompletionInput {
  credential: ChatGptCredential
  model?: string
  system: string
  prompt: string
  signal: AbortSignal
}

function requestBody(model: string, system: string, prompt: string): Record<string, unknown> {
  return {
    model,
    store: false,
    stream: true,
    instructions: system,
    input: [{
      role: 'user',
      content: [{ type: 'input_text', text: prompt }],
    }],
    ...(model.startsWith('gpt-5') ? { text: { verbosity: 'low' } } : {}),
    ...(model.startsWith('gpt-6')
      ? { reasoning: { effort: model.includes('luna') ? 'none' : 'low' } }
      : {}),
  }
}

function textFromItem(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  const value = item as { type?: unknown; content?: unknown }
  if (value.type !== 'message' || !Array.isArray(value.content)) return ''
  return value.content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

function textFromJson(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const output = (value as { output?: unknown }).output
  if (!Array.isArray(output)) return ''
  return output.map(textFromItem).join('')
}

/**
 * Codex/ChatGPT 后端只接受 SSE（stream: true），这里只读取文本增量/完成 item；
 * 不处理工具调用，补全只应产生纯文本。
 */
export async function callChatGptCompletion(input: ChatGptCompletionInput): Promise<string> {
  const model = usableChatGptModel(input.model)
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    signal: input.signal,
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.credential.access}`,
      'chatgpt-account-id': input.credential.accountId,
      originator: ORIGINATOR,
      'OpenAI-Beta': 'responses=experimental',
    },
    body: JSON.stringify(requestBody(model, input.system, input.prompt)),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ChatGPT completion failed (${response.status}): ${body}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return textFromJson(await response.json())
  }
  if (!response.body) throw new Error('ChatGPT completion response has no body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamed = ''
  let completed = ''
  let failure: string | null = null

  const consume = (block: string): void => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data || data === '[DONE]') return
    let event: unknown
    try {
      event = JSON.parse(data)
    } catch {
      return
    }
    if (!event || typeof event !== 'object') return
    const value = event as {
      type?: unknown
      delta?: unknown
      item?: unknown
      response?: { error?: unknown; output?: unknown }
      error?: unknown
    }
    if (value.type === 'response.output_text.delta' && typeof value.delta === 'string') {
      streamed += value.delta
      return
    }
    if (value.type === 'response.output_item.done') {
      const text = textFromItem(value.item)
      if (text) completed = text
      return
    }
    if (value.type === 'response.completed' && !completed) {
      const text = textFromJson(value.response)
      if (text) completed = text
      return
    }
    if (value.type === 'response.failed' || value.type === 'error') {
      failure = JSON.stringify(value.response?.error ?? value.error ?? event)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      for (const block of blocks) consume(block)
      if (failure) break
      if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    }
    if (buffer.trim()) consume(buffer)
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (failure) throw new Error(`ChatGPT completion failed: ${failure}`)
  return completed || streamed
}
