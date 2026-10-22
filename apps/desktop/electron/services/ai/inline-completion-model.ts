import { generateText, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { InlineCompletionModelSource } from './inline-completion-service'
import { callChatGptCompletion } from './chatgpt-completion'
import { resolveInlineCompletionProvider } from './inline-completion-provider'

function isDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

/** 补全专用 provider 优先，旧 Agent 自定义供应商回退；Key 只在主进程内使用。 */
export function providerModelSource(): InlineCompletionModelSource {
  let cache: { key: string; value: { model: LanguageModel; id: string } } | null = null
  return {
    resolve: async () => {
      const resolved = await resolveInlineCompletionProvider()
      if (!resolved) return null

      if (resolved.authMode === 'chatgpt') {
        const credential = resolved.credential
        if (!credential) return null
        return {
          id: `ChatGPT · ${resolved.config.model}`,
          generate: ({ system, prompt, signal }) => callChatGptCompletion({
            credential,
            model: resolved.config.model,
            system,
            prompt,
            signal,
          }),
        }
      }

      const stored = resolved.config
      const key = `${resolved.source}\u0000${stored.baseUrl}\u0000${stored.model}\u0000${stored.apiKey}`
      if (cache?.key !== key) {
        const provider = createOpenAICompatible({
          name: stored.name || 'montree-completion',
          baseURL: stored.baseUrl.replace(/\/+$/, ''),
          apiKey: stored.apiKey || 'local',
          // DeepSeek V4 默认开启 thinking（high）；补全必须关掉，否则延迟会明显变长。
          ...(isDeepSeekEndpoint(stored.baseUrl)
            ? { transformRequestBody: (args: Record<string, unknown>) => ({ ...args, thinking: { type: 'disabled' } }) }
            : {}),
        })
        cache = { key, value: { model: provider.chatModel(stored.model), id: stored.model } }
      }
      const model = cache.value.model
      return {
        id: stored.model,
        generate: async ({ system, prompt, signal }) => {
          const result = await generateText({
            model,
            system,
            prompt,
            temperature: 0.2,
            maxOutputTokens: 160,
            abortSignal: signal,
            maxRetries: 0,
          })
          return result.text
        },
      }
    },
  }
}

/** E2E：不出网的确定性模型，按光标前最后一个词返回补全，并带两个候选。 */
export function e2eMockModelSource(): InlineCompletionModelSource {
  return {
    resolve: async () => ({
      id: 'mock-completion',
      generate: async ({ prompt }) => (/quick brown/.test(prompt)
        ? ' fox jumps over the lazy dog.<ALT> cat naps in the sun.'
        : /春眠/.test(prompt) ? '不觉晓，处处闻啼鸟。' : ' continued text.'),
    }),
  }
}
